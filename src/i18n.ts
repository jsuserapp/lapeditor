import { invoke } from "@tauri-apps/api/core";
import { setTooltip } from "./tooltip";

export type LocaleInfo = {
  id: string;
  name: string;
};

export type LocaleFile = {
  id: string;
  name: string;
  strings: Record<string, string>;
};

let current: LocaleFile = {
  id: "en",
  name: "English",
  strings: {},
};

export function t(key: string, vars?: Record<string, string | number>): string {
  let text = current.strings[key] ?? key;
  if (vars) {
    for (const [name, value] of Object.entries(vars)) {
      text = text.replace(new RegExp(`\\{${name}\\}`, "g"), String(value));
    }
  }
  return text;
}

export function applyDomI18n() {
  document.documentElement.lang = current.id === "zh" ? "zh-CN" : current.id;
  for (const el of document.querySelectorAll<HTMLElement>("[data-i18n]")) {
    const key = el.dataset.i18n;
    if (key) {
      el.textContent = t(key);
    }
  }
  for (const el of document.querySelectorAll<HTMLElement>("[data-i18n-title]")) {
    const key = el.dataset.i18nTitle;
    if (key) {
      setTooltip(el, t(key));
    }
  }
  for (const el of document.querySelectorAll<HTMLInputElement>("[data-i18n-placeholder]")) {
    const key = el.dataset.i18nPlaceholder;
    if (key) {
      el.placeholder = t(key);
    }
  }
  for (const el of document.querySelectorAll<HTMLElement>("[data-i18n-aria]")) {
    const key = el.dataset.i18nAria;
    if (key) {
      el.setAttribute("aria-label", t(key));
    }
  }
}

export async function loadLocale(id: string): Promise<LocaleFile> {
  current = await invoke<LocaleFile>("load_ui_locale", { id });
  applyDomI18n();
  return current;
}

export async function listLocales(): Promise<LocaleInfo[]> {
  return invoke<LocaleInfo[]>("list_ui_locales");
}
