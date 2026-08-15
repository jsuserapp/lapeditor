import { invoke } from "@tauri-apps/api/core";

export type FormatIndent = "2" | "4" | "tab";

export type FormatterCommandInfo = {
  id: string;
  program: string;
  args: string[];
  source: "user" | "plugin" | "default" | string;
  available: boolean;
};

export type FormatterConfigDto = {
  indent: FormatIndent | string;
  commands: FormatterCommandInfo[];
};

const BUILTIN_PARSERS: Record<string, string> = {
  javascript: "babel",
  javascriptreact: "babel",
  typescript: "typescript",
  typescriptreact: "typescript",
  json: "json",
  jsonc: "json",
  css: "css",
  scss: "scss",
  less: "less",
  html: "html",
  markdown: "markdown",
};

export const BUILTIN_LANGUAGE_IDS = Object.keys(BUILTIN_PARSERS);

export function isBuiltinFormatterLanguage(languageId: string): boolean {
  return languageId in BUILTIN_PARSERS;
}

export function languageHasFormatter(
  languageId: string,
  commands: FormatterCommandInfo[],
): boolean {
  if (isBuiltinFormatterLanguage(languageId)) {
    return true;
  }
  return commands.some((item) => item.id === languageId && item.available);
}

export function normalizeIndent(indent: string | undefined): FormatIndent {
  if (indent === "4" || indent === "tab") {
    return indent;
  }
  return "2";
}

export function monacoIndentOptions(indent: FormatIndent): {
  tabSize: number;
  insertSpaces: boolean;
} {
  if (indent === "tab") {
    return { tabSize: 4, insertSpaces: false };
  }
  return { tabSize: Number(indent), insertSpaces: true };
}

export async function loadFormatterConfig(): Promise<FormatterConfigDto> {
  return invoke<FormatterConfigDto>("get_formatter_config");
}

export async function saveFormatIndent(indent: FormatIndent): Promise<void> {
  await invoke("save_format_indent", { indent });
}

export async function saveFormatterCommand(
  languageId: string,
  program: string,
  args: string[],
): Promise<void> {
  await invoke("save_formatter_command", { languageId, program, args });
}

export async function removeFormatterCommand(languageId: string): Promise<void> {
  await invoke("remove_formatter_command", { languageId });
}

async function formatBuiltin(languageId: string, text: string, indent: FormatIndent): Promise<string> {
  const parser = BUILTIN_PARSERS[languageId];
  if (!parser) {
    throw new Error(`no builtin formatter for ${languageId}`);
  }
  const prettier = await import("prettier/standalone");
  const plugins = await loadPrettierPlugins(parser);
  return prettier.format(text, {
    parser,
    plugins,
    tabWidth: indent === "tab" ? 4 : Number(indent),
    useTabs: indent === "tab",
    endOfLine: "auto",
  });
}

async function loadPrettierPlugins(parser: string) {
  const plugin = async (loader: () => Promise<{ default?: unknown }>) => {
    const mod = await loader();
    return mod.default ?? mod;
  };
  const plugins = [
    await plugin(() => import("prettier/plugins/estree")),
    await plugin(() => import("prettier/plugins/babel")),
  ];
  if (parser === "typescript") {
    plugins.push(await plugin(() => import("prettier/plugins/typescript")));
  } else if (parser === "html") {
    plugins.push(await plugin(() => import("prettier/plugins/html")));
  } else if (parser === "css" || parser === "scss" || parser === "less") {
    plugins.push(await plugin(() => import("prettier/plugins/postcss")));
  } else if (parser === "markdown") {
    plugins.push(await plugin(() => import("prettier/plugins/markdown")));
  }
  return plugins as [];
}

export async function formatText(
  languageId: string,
  text: string,
  options?: { indent?: FormatIndent; forceCommand?: boolean },
): Promise<string> {
  const config = await loadFormatterConfig();
  const indent = normalizeIndent(options?.indent ?? config.indent);
  const hasCommand = config.commands.some((item) => item.id === languageId && item.source === "user");
  if (!options?.forceCommand && isBuiltinFormatterLanguage(languageId) && !hasCommand) {
    return formatBuiltin(languageId, text, indent);
  }
  return invoke<string>("format_with_command", { languageId, text });
}
