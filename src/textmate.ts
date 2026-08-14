import type * as Monaco from "monaco-editor/editor/editor.api.js";
import {
  INITIAL,
  Registry,
  parseRawGrammar,
  type IGrammar,
  type StateStack,
} from "vscode-textmate";
import { createOnigScanner, createOnigString, loadWASM } from "vscode-oniguruma";

export type LanguagePluginDto = {
  id: string;
  aliases: string[];
  extensions: string[];
  scopeName: string;
  grammarJson?: string;
};

type RegisterOptions = {
  resetRegistry?: boolean;
};

class StackState implements Monaco.languages.IState {
  constructor(public readonly ruleStack: StateStack | null) {}

  clone(): StackState {
    return new StackState(this.ruleStack);
  }

  equals(other: Monaco.languages.IState): boolean {
    if (!(other instanceof StackState)) {
      return false;
    }
    if (this.ruleStack === other.ruleStack) {
      return true;
    }
    if (!this.ruleStack || !other.ruleStack) {
      return this.ruleStack === other.ruleStack;
    }
    return this.ruleStack.equals(other.ruleStack);
  }
}

function scopeToToken(scopes: string[]): string {
  if (scopes.length === 0) {
    return "";
  }
  return scopes[scopes.length - 1] ?? scopes[0] ?? "";
}

const grammarByScope = new Map<string, string>();

type OnigGlobal = typeof globalThis & { __lapeditorOnig?: Promise<void> };

function ensureOnig(): Promise<void> {
  const g = globalThis as OnigGlobal;
  if (!g.__lapeditorOnig) {
    g.__lapeditorOnig = (async () => {
      const wasmUrl = new URL("vscode-oniguruma/release/onig.wasm", import.meta.url);
      const wasmBytes = await fetch(wasmUrl).then((r) => {
        if (!r.ok) {
          throw new Error(`Failed to load onig.wasm: ${r.status}`);
        }
        return r.arrayBuffer();
      });
      await loadWASM(wasmBytes);
    })();
  }
  return g.__lapeditorOnig;
}

let registry: Registry | null = null;

async function ensureRegistry(): Promise<Registry> {
  await ensureOnig();
  if (!registry) {
    registry = new Registry({
      onigLib: Promise.resolve({
        createOnigScanner,
        createOnigString,
      }),
      loadGrammar: async (scopeName) => {
        const raw = grammarByScope.get(scopeName);
        if (raw) {
          return parseRawGrammar(raw, `${scopeName}.json`);
        }
        // vscode-textmate caches a missing scope forever. Markdown and others
        // include scopes like source.c at load time; a dummy keeps that miss
        // from blocking a later install of the real grammar (after reset).
        return parseRawGrammar(
          JSON.stringify({ scopeName, patterns: [] }),
          `${scopeName}.json`,
        );
      },
    });
  }
  return registry;
}

export function registerLanguageIds(
  monaco: typeof Monaco,
  plugins: LanguagePluginDto[],
): void {
  const existing = new Set(monaco.languages.getLanguages().map((l) => l.id));
  for (const plugin of plugins) {
    if (existing.has(plugin.id)) {
      continue;
    }
    monaco.languages.register({
      id: plugin.id,
      aliases: plugin.aliases,
      extensions: plugin.extensions,
    });
    existing.add(plugin.id);
  }
}

export async function registerTextMateLanguage(
  monaco: typeof Monaco,
  plugin: LanguagePluginDto,
  options?: RegisterOptions,
): Promise<void> {
  if (!plugin.grammarJson) {
    return;
  }
  grammarByScope.set(plugin.scopeName, plugin.grammarJson);
  if (options?.resetRegistry) {
    registry = null;
  }
  const tm = await ensureRegistry();

  const languageId = plugin.id;
  const already = monaco.languages.getLanguages().some((l) => l.id === languageId);
  if (!already) {
    monaco.languages.register({
      id: languageId,
      aliases: plugin.aliases,
      extensions: plugin.extensions,
    });
  }

  const grammar: IGrammar | null = await tm.loadGrammar(plugin.scopeName);
  if (!grammar) {
    console.warn(`Failed to load grammar for ${languageId} (${plugin.scopeName})`);
    return;
  }

  monaco.languages.setTokensProvider(languageId, {
    getInitialState: () => new StackState(INITIAL),
    tokenize(line: string, state: Monaco.languages.IState) {
      const stack = state instanceof StackState ? state.ruleStack : INITIAL;
      const result = grammar.tokenizeLine(line, stack);
      return {
        endState: new StackState(result.ruleStack),
        tokens: result.tokens.map((token) => ({
          startIndex: token.startIndex,
          scopes: scopeToToken(token.scopes),
        })),
      };
    },
  });
}

export async function registerTextMateLanguages(
  monaco: typeof Monaco,
  plugins: LanguagePluginDto[],
  options?: RegisterOptions,
): Promise<void> {
  if (options?.resetRegistry) {
    registry = null;
  }
  for (const plugin of plugins) {
    if (plugin.grammarJson) {
      grammarByScope.set(plugin.scopeName, plugin.grammarJson);
    }
  }
  for (const plugin of plugins) {
    await registerTextMateLanguage(monaco, plugin);
  }
}
