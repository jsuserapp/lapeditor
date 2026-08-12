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
  grammarJson: string;
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
  // Monaco theme rules match by prefix; prefer the most specific scope.
  return scopes[scopes.length - 1] ?? scopes[0] ?? "";
}

export async function registerTextMateLanguages(
  monaco: typeof Monaco,
  plugins: LanguagePluginDto[],
): Promise<void> {
  const wasmUrl = new URL("vscode-oniguruma/release/onig.wasm", import.meta.url);
  const wasmBytes = await fetch(wasmUrl).then((r) => {
    if (!r.ok) {
      throw new Error(`Failed to load onig.wasm: ${r.status}`);
    }
    return r.arrayBuffer();
  });
  await loadWASM(wasmBytes);

  const grammarByScope = new Map<string, string>();
  for (const plugin of plugins) {
    grammarByScope.set(plugin.scopeName, plugin.grammarJson);
  }

  const registry = new Registry({
    onigLib: Promise.resolve({
      createOnigScanner,
      createOnigString,
    }),
    loadGrammar: async (scopeName) => {
      const raw = grammarByScope.get(scopeName);
      if (!raw) {
        return null;
      }
      return parseRawGrammar(raw, `${scopeName}.json`);
    },
  });

  monaco.editor.defineTheme("lapeditor-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "comment", foreground: "6A9955" },
      { token: "string", foreground: "CE9178" },
      { token: "constant", foreground: "B5CEA8" },
      { token: "keyword", foreground: "C586C0" },
      { token: "storage", foreground: "569CD6" },
      { token: "entity.name.function", foreground: "DCDCAA" },
      { token: "entity.name.type", foreground: "4EC9B0" },
      { token: "entity.name.class", foreground: "4EC9B0" },
      { token: "entity.name.tag", foreground: "569CD6" },
      { token: "entity.other.attribute-name", foreground: "9CDCFE" },
      { token: "variable", foreground: "9CDCFE" },
      { token: "support", foreground: "4EC9B0" },
      { token: "punctuation", foreground: "D4D4D4" },
      { token: "meta.embedded", foreground: "D4D4D4" },
      { token: "markup.heading", foreground: "569CD6", fontStyle: "bold" },
      { token: "markup.bold", fontStyle: "bold" },
      { token: "markup.italic", fontStyle: "italic" },
    ],
    colors: {
      "editor.background": "#1e1e1e",
      "editor.foreground": "#d4d4d4",
    },
  });
  monaco.editor.setTheme("lapeditor-dark");

  for (const plugin of plugins) {
    const languageId = plugin.id;
    const already = monaco.languages.getLanguages().some((l) => l.id === languageId);
    if (!already) {
      monaco.languages.register({
        id: languageId,
        aliases: plugin.aliases,
        extensions: plugin.extensions,
      });
    }

    const grammar: IGrammar | null = await registry.loadGrammar(plugin.scopeName);
    if (!grammar) {
      console.warn(`Failed to load grammar for ${languageId} (${plugin.scopeName})`);
      continue;
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
}
