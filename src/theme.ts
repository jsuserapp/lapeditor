import type * as Monaco from "monaco-editor/editor/editor.api.js";

export type ThemeId = "light" | "dark";

const SUN_ICON = `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="currentColor">
  <circle cx="12" cy="12" r="4.25"/>
  <rect x="11" y="1.6" width="2" height="3.8" rx="1" transform="rotate(0 12 12)"/>
  <rect x="11" y="1.6" width="2" height="3.8" rx="1" transform="rotate(45 12 12)"/>
  <rect x="11" y="1.6" width="2" height="3.8" rx="1" transform="rotate(90 12 12)"/>
  <rect x="11" y="1.6" width="2" height="3.8" rx="1" transform="rotate(135 12 12)"/>
  <rect x="11" y="1.6" width="2" height="3.8" rx="1" transform="rotate(180 12 12)"/>
  <rect x="11" y="1.6" width="2" height="3.8" rx="1" transform="rotate(225 12 12)"/>
  <rect x="11" y="1.6" width="2" height="3.8" rx="1" transform="rotate(270 12 12)"/>
  <rect x="11" y="1.6" width="2" height="3.8" rx="1" transform="rotate(315 12 12)"/>
</svg>`;

export function monacoThemeName(theme: ThemeId): string {
  return theme === "light" ? "lapeditor-light" : "lapeditor-dark";
}

export function defineEditorThemes(monaco: typeof Monaco) {
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
      "editorGutter.background": "#1e1e1e",
    },
  });

  monaco.editor.defineTheme("lapeditor-light", {
    base: "vs",
    inherit: true,
    rules: [
      { token: "comment", foreground: "008000" },
      { token: "string", foreground: "A31515" },
      { token: "constant", foreground: "098658" },
      { token: "keyword", foreground: "AF00DB" },
      { token: "storage", foreground: "0000FF" },
      { token: "entity.name.function", foreground: "795E26" },
      { token: "entity.name.type", foreground: "267F99" },
      { token: "entity.name.class", foreground: "267F99" },
      { token: "entity.name.tag", foreground: "800000" },
      { token: "entity.other.attribute-name", foreground: "E50000" },
      { token: "variable", foreground: "001080" },
      { token: "support", foreground: "267F99" },
      { token: "punctuation", foreground: "000000" },
      { token: "meta.embedded", foreground: "000000" },
      { token: "markup.heading", foreground: "800000", fontStyle: "bold" },
      { token: "markup.bold", fontStyle: "bold" },
      { token: "markup.italic", fontStyle: "italic" },
    ],
    colors: {
      "editor.background": "#ffffff",
      "editor.foreground": "#1e1e1e",
      "editorGutter.background": "#ffffff",
    },
  });
}

export function applyChromeTheme(theme: ThemeId) {
  document.documentElement.dataset.theme = theme;
}

export function applyEditorTheme(monaco: typeof Monaco, theme: ThemeId) {
  monaco.editor.setTheme(monacoThemeName(theme));
}

export function themeButtonIcon(): string {
  return SUN_ICON;
}

const WRAP_ICON = `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <path d="M4 7h16"/>
  <path d="M4 12h11a3 3 0 0 1 0 6H9"/>
  <path d="M11 16l-2 2 2 2"/>
</svg>`;

export function wrapButtonIcon(): string {
  return WRAP_ICON;
}
