import type * as monaco from "monaco-editor/editor/editor.api.js";
import { t } from "./i18n";
import { setTooltip } from "./tooltip";

export const DEFAULT_FONT_FAMILY = "Cascadia Code, Consolas, 'Courier New', monospace";
export const DEFAULT_FONT_SIZE = 14;
export const FONT_SIZE_MIN = 10;
export const FONT_SIZE_MAX = 28;

const FONT_PRESETS = [
  "Cascadia Code",
  "Consolas",
  "Courier New",
  "Lucida Console",
  "JetBrains Mono",
  "Fira Code",
  "Source Code Pro",
  "Microsoft YaHei Mono",
  "monospace",
];

export function normalizeFontFamily(value: string | undefined): string {
  const trimmed = value?.trim() ?? "";
  return trimmed || DEFAULT_FONT_FAMILY;
}

export function normalizeFontSize(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_FONT_SIZE;
  }
  return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(value as number)));
}

export function applyEditorFont(
  editor: monaco.editor.IStandaloneCodeEditor | undefined,
  fontFamily: string,
  fontSize: number,
) {
  editor?.updateOptions({
    fontFamily: normalizeFontFamily(fontFamily),
    fontSize: normalizeFontSize(fontSize),
  });
}

type SettingsHost = {
  getEditor: () => monaco.editor.IStandaloneCodeEditor | undefined;
  onPersist: (patch: { fontFamily?: string; fontSize?: number }) => void;
};

export type SettingsApi = {
  setOpen: (open: boolean) => void;
  isOpen: () => boolean;
  syncLocale: () => void;
  applyFromSettings: (fontFamily?: string, fontSize?: number) => void;
};

export function bindSettings(host: SettingsHost): SettingsApi {
  const page = document.querySelector<HTMLDivElement>("#settings-host")!;
  const button = document.querySelector<HTMLButtonElement>("#btn-settings")!;
  const familyInput = document.querySelector<HTMLInputElement>("#settings-font-family")!;
  const sizeInput = document.querySelector<HTMLInputElement>("#settings-font-size")!;
  const list = document.querySelector<HTMLDataListElement>("#settings-font-list")!;

  let open = false;
  let fontFamily = DEFAULT_FONT_FAMILY;
  let fontSize = DEFAULT_FONT_SIZE;

  list.replaceChildren(
    ...FONT_PRESETS.map((name) => {
      const option = document.createElement("option");
      option.value = name;
      return option;
    }),
  );

  const syncFields = () => {
    familyInput.value = fontFamily;
    sizeInput.value = String(fontSize);
    sizeInput.min = String(FONT_SIZE_MIN);
    sizeInput.max = String(FONT_SIZE_MAX);
  };

  const apply = () => {
    applyEditorFont(host.getEditor(), fontFamily, fontSize);
    syncFields();
  };

  const setOpen = (next: boolean) => {
    open = next;
    page.hidden = !open;
    button.setAttribute("aria-pressed", open ? "true" : "false");
    if (open) {
      syncFields();
      familyInput.focus();
    }
  };

  const syncLocale = () => {
    setTooltip(button, t("settings.toggle"));
    button.setAttribute("aria-label", t("settings.toggle"));
  };

  button.addEventListener("click", () => setOpen(!open));
  familyInput.addEventListener("change", () => {
    fontFamily = normalizeFontFamily(familyInput.value);
    apply();
    host.onPersist({ fontFamily });
  });
  sizeInput.addEventListener("change", () => {
    fontSize = normalizeFontSize(Number(sizeInput.value));
    apply();
    host.onPersist({ fontSize });
  });
  page.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") {
      ev.stopPropagation();
      setOpen(false);
    }
  });

  syncLocale();
  syncFields();

  return {
    setOpen,
    isOpen: () => open,
    syncLocale,
    applyFromSettings(nextFamily, nextSize) {
      fontFamily = normalizeFontFamily(nextFamily);
      fontSize = normalizeFontSize(nextSize);
      apply();
    },
  };
}
