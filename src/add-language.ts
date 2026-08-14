import { invoke } from "@tauri-apps/api/core";
import type * as Monaco from "monaco-editor/editor/editor.api.js";
import { t } from "./i18n";
import { registerTextMateLanguages, type LanguagePluginDto } from "./textmate";

export type LanguageCatalogItem = {
  id: string;
  aliases: string[];
  extensions: string[];
};

type AddLanguageHost = {
  getMonaco: () => typeof Monaco;
  getPlugins: () => LanguagePluginDto[];
  onInstalled: () => void;
};

const dialog = () => document.querySelector<HTMLDivElement>("#add-language-dialog")!;
const input = () => document.querySelector<HTMLInputElement>("#add-language-input")!;
const suggest = () => document.querySelector<HTMLDivElement>("#add-language-suggest")!;
const preview = () => document.querySelector<HTMLParagraphElement>("#add-language-preview")!;
const errorEl = () => document.querySelector<HTMLParagraphElement>("#add-language-error")!;
const confirmBtn = () => document.querySelector<HTMLButtonElement>("#add-language-confirm")!;
const cancelBtn = () => document.querySelector<HTMLButtonElement>("#add-language-cancel")!;

let host: AddLanguageHost | undefined;
let catalog: LanguageCatalogItem[] = [];
let selected: LanguageCatalogItem | null = null;
let busy = false;

function displayName(item: LanguageCatalogItem) {
  return item.aliases[0] ?? item.id;
}

function matchCatalog(query: string): LanguageCatalogItem[] {
  const q = query.trim().toLowerCase();
  if (!q) {
    return catalog;
  }
  const qExt = q.startsWith(".") ? q : `.${q}`;
  return catalog.filter((item) => {
    if (item.id.toLowerCase() === q || item.id.toLowerCase().includes(q)) {
      return true;
    }
    if (item.aliases.some((alias) => alias.toLowerCase() === q || alias.toLowerCase().includes(q))) {
      return true;
    }
    return item.extensions.some((ext) => ext.toLowerCase() === q || ext.toLowerCase() === qExt);
  });
}

function resolveSelection(query: string): LanguageCatalogItem | null {
  const q = query.trim().toLowerCase();
  if (!q) {
    return null;
  }
  const matches = matchCatalog(query);
  const exactId = matches.find((item) => item.id.toLowerCase() === q);
  if (exactId) {
    return exactId;
  }
  const exactAlias = matches.find((item) => item.aliases.some((alias) => alias.toLowerCase() === q));
  if (exactAlias) {
    return exactAlias;
  }
  const qExt = q.startsWith(".") ? q : `.${q}`;
  const exactExt = matches.filter((item) =>
    item.extensions.some((ext) => ext.toLowerCase() === q || ext.toLowerCase() === qExt),
  );
  if (exactExt.length === 1) {
    return exactExt[0] ?? null;
  }
  return matches.length === 1 ? (matches[0] ?? null) : null;
}

function setError(message: string) {
  errorEl().hidden = !message;
  errorEl().textContent = message;
}

function formatInstallError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const msg = raw.replace(/^(Error:\s*)+/i, "");
  if (/No grammar provided for/i.test(msg) || /Failed to load grammar/i.test(msg)) {
    return t("lang.addGrammarMissing");
  }
  return msg;
}

function renderPreview() {
  if (!selected) {
    preview().textContent = "";
    confirmBtn().disabled = true;
    return;
  }
  const exts = selected.extensions.join(" ");
  preview().textContent = t("lang.addPreview", {
    name: displayName(selected),
    id: selected.id,
    extensions: exts,
  });
  confirmBtn().disabled = busy;
}

function renderSuggest(query: string) {
  const items = matchCatalog(query).slice(0, 12);
  suggest().replaceChildren();
  if (items.length === 0) {
    suggest().hidden = true;
    return;
  }
  for (const item of items) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `modal-suggest-item${selected?.id === item.id ? " active" : ""}`;
    btn.textContent = `${displayName(item)}  ${item.extensions.join(" ")}`;
    btn.addEventListener("mousedown", (ev) => ev.preventDefault());
    btn.addEventListener("click", () => {
      selected = item;
      input().value = displayName(item);
      suggest().hidden = true;
      setError("");
      renderPreview();
    });
    suggest().appendChild(btn);
  }
  suggest().hidden = false;
}

function onQueryChange() {
  selected = resolveSelection(input().value);
  setError("");
  renderSuggest(input().value);
  renderPreview();
}

export function closeAddLanguageDialog() {
  if (dialog().hidden) {
    return;
  }
  busy = false;
  confirmBtn().disabled = false;
  dialog().hidden = true;
  suggest().hidden = true;
  setError("");
}

export async function openAddLanguageDialog() {
  if (!host) {
    return;
  }
  setError("");
  preview().textContent = "";
  input().value = "";
  selected = null;
  confirmBtn().disabled = true;
  dialog().hidden = false;
  try {
    catalog = await invoke<LanguageCatalogItem[]>("list_language_catalog");
  } catch (err) {
    catalog = [];
    setError(formatInstallError(err));
  }
  renderSuggest("");
  renderPreview();
  input().focus();
}

async function recoverInstalledLanguage() {
  if (!host) {
    return;
  }
  const plugins = host.getPlugins();
  const infos = await invoke<LanguagePluginDto[]>("list_language_plugins");
  const grammars = await invoke<Record<string, string>>("load_language_grammars");
  for (const info of infos) {
    const grammarJson = grammars[info.id];
    const existing = plugins.find((p) => p.id === info.id);
    if (existing) {
      existing.aliases = info.aliases;
      existing.extensions = info.extensions;
      existing.scopeName = info.scopeName;
      if (grammarJson) {
        existing.grammarJson = grammarJson;
      }
    } else {
      plugins.push({ ...info, grammarJson });
    }
  }
  plugins.sort((a, b) => a.id.localeCompare(b.id));
  await registerTextMateLanguages(host.getMonaco(), plugins, { resetRegistry: true });
  host.onInstalled();
  closeAddLanguageDialog();
}

async function confirmAdd() {
  if (!host || busy) {
    return;
  }
  const item = selected ?? resolveSelection(input().value);
  if (!item) {
    setError(t("lang.addUnknown"));
    return;
  }
  busy = true;
  confirmBtn().disabled = true;
  setError("");
  preview().textContent = t("lang.addDownloading", { name: displayName(item) });
  try {
    const plugin = await invoke<LanguagePluginDto>("install_language_plugin", {
      languageId: item.id,
    });
    const plugins = host.getPlugins();
    const existing = plugins.find((p) => p.id === plugin.id);
    if (existing) {
      existing.aliases = plugin.aliases;
      existing.extensions = plugin.extensions;
      existing.scopeName = plugin.scopeName;
      existing.grammarJson = plugin.grammarJson;
    } else {
      plugins.push(plugin);
    }
    plugins.sort((a, b) => a.id.localeCompare(b.id));
    await registerTextMateLanguages(host.getMonaco(), plugins, { resetRegistry: true });
    host.onInstalled();
    closeAddLanguageDialog();
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    if (/already installed/i.test(raw)) {
      try {
        await recoverInstalledLanguage();
        return;
      } catch (recoverErr) {
        setError(formatInstallError(recoverErr));
        renderPreview();
        return;
      }
    }
    setError(formatInstallError(err));
    renderPreview();
  } finally {
    busy = false;
    confirmBtn().disabled = !selected;
  }
}

export function bindAddLanguageDialog(options: AddLanguageHost) {
  host = options;
  cancelBtn().addEventListener("click", () => closeAddLanguageDialog());
  confirmBtn().addEventListener("click", () => void confirmAdd());
  dialog().addEventListener("click", (ev) => {
    if (ev.target === dialog()) {
      closeAddLanguageDialog();
    }
  });
  dialog().querySelector(".modal")?.addEventListener("click", (ev) => ev.stopPropagation());
  input().addEventListener("input", onQueryChange);
  input().addEventListener("focus", () => renderSuggest(input().value));
  input().addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      void confirmAdd();
    } else if (ev.key === "Escape") {
      ev.preventDefault();
      closeAddLanguageDialog();
    }
  });
  window.addEventListener(
    "keydown",
    (ev) => {
      if (ev.key === "Escape" && !dialog().hidden) {
        ev.preventDefault();
        ev.stopPropagation();
        closeAddLanguageDialog();
      }
    },
    true,
  );
}
