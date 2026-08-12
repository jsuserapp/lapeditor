import { invoke } from "@tauri-apps/api/core";
import * as monaco from "monaco-editor/editor/editor.api.js";
import editorWorkerUrl from "monaco-editor/editor/editor.worker.js?url";
import "monaco-editor/min/vs/editor/editor.main.css";
import { registerTextMateLanguages, type LanguagePluginDto } from "./textmate";

self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    return new Worker(editorWorkerUrl, { type: "module", name: label });
  },
};

type TabState = {
  id: string;
  title: string;
  path: string | null;
  languageId: string;
  model: monaco.editor.ITextModel;
  viewState: monaco.editor.ICodeEditorViewState | null;
  dirty: boolean;
};

const PLAINTEXT = "plaintext";

const tabBar = document.querySelector<HTMLDivElement>("#tab-bar")!;
const languageSelect = document.querySelector<HTMLSelectElement>("#language-select")!;
const statusEl = document.querySelector<HTMLDivElement>("#status")!;
const editorHost = document.querySelector<HTMLDivElement>("#editor-host")!;

const tabs = new Map<string, TabState>();
let activeTabId: string | null = null;
let editor: monaco.editor.IStandaloneCodeEditor;
let plugins: LanguagePluginDto[] = [];
let tabSeq = 1;

function setStatus(text: string) {
  statusEl.textContent = text;
}

function basename(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || path;
}

function languageLabel(id: string): string {
  if (id === PLAINTEXT) {
    return "Plain Text";
  }
  const plugin = plugins.find((p) => p.id === id);
  return plugin?.aliases[0] ?? id;
}

function fillLanguageSelect() {
  languageSelect.innerHTML = "";
  const plain = document.createElement("option");
  plain.value = PLAINTEXT;
  plain.textContent = "Plain Text";
  languageSelect.appendChild(plain);

  for (const plugin of plugins) {
    const opt = document.createElement("option");
    opt.value = plugin.id;
    opt.textContent = languageLabel(plugin.id);
    languageSelect.appendChild(opt);
  }
}

function renderTabs() {
  tabBar.innerHTML = "";
  for (const tab of tabs.values()) {
    const el = document.createElement("div");
    el.className = `tab${tab.id === activeTabId ? " active" : ""}`;
    el.dataset.tabId = tab.id;

    const title = document.createElement("span");
    title.className = "tab-title";
    title.textContent = tab.dirty ? `• ${tab.title}` : tab.title;
    if (tab.dirty) {
      title.classList.add("tab-dirty");
    }

    const close = document.createElement("button");
    close.type = "button";
    close.className = "tab-close";
    close.title = "Close";
    close.textContent = "×";
    close.addEventListener("click", (ev) => {
      ev.stopPropagation();
      void closeTab(tab.id);
    });

    el.appendChild(title);
    el.appendChild(close);
    el.addEventListener("click", () => activateTab(tab.id));
    tabBar.appendChild(el);
  }
}

function syncLanguageSelect() {
  const tab = activeTabId ? tabs.get(activeTabId) : undefined;
  languageSelect.value = tab?.languageId ?? PLAINTEXT;
}

function updateStatusForActive() {
  const tab = activeTabId ? tabs.get(activeTabId) : undefined;
  if (!tab) {
    setStatus("No file");
    return;
  }
  const path = tab.path ?? "(unsaved)";
  setStatus(`${path}  ·  ${languageLabel(tab.languageId)}`);
}

function activateTab(id: string) {
  if (activeTabId && activeTabId !== id) {
    const prev = tabs.get(activeTabId);
    if (prev) {
      prev.viewState = editor.saveViewState();
    }
  }

  const tab = tabs.get(id);
  if (!tab) {
    return;
  }

  activeTabId = id;
  editor.setModel(tab.model);
  if (tab.viewState) {
    editor.restoreViewState(tab.viewState);
  }
  editor.focus();
  renderTabs();
  syncLanguageSelect();
  updateStatusForActive();
}

function createTab(options?: {
  title?: string;
  path?: string | null;
  languageId?: string;
  content?: string;
}): TabState {
  const id = `tab-${tabSeq++}`;
  const languageId = options?.languageId ?? PLAINTEXT;
  const model = monaco.editor.createModel(options?.content ?? "", languageId);
  const tab: TabState = {
    id,
    title: options?.title ?? `Untitled-${tabSeq - 1}`,
    path: options?.path ?? null,
    languageId,
    model,
    viewState: null,
    dirty: false,
  };

  model.onDidChangeContent(() => {
    if (!tab.dirty) {
      tab.dirty = true;
      renderTabs();
      updateStatusForActive();
    }
  });

  tabs.set(id, tab);
  activateTab(id);
  return tab;
}

async function closeTab(id: string) {
  const tab = tabs.get(id);
  if (!tab) {
    return;
  }

  if (tab.dirty) {
    const ok = window.confirm(`Discard changes to "${tab.title}"?`);
    if (!ok) {
      return;
    }
  }

  tab.model.dispose();
  tabs.delete(id);

  if (activeTabId === id) {
    activeTabId = null;
    const next = tabs.keys().next().value as string | undefined;
    if (next) {
      activateTab(next);
    } else {
      editor.setModel(null);
      createTab();
    }
  } else {
    renderTabs();
  }
}

async function openFile() {
  const path = await invoke<string | null>("pick_open_file");
  if (!path) {
    return;
  }

  const content = await invoke<string>("read_text_file", { path });
  const languageId =
    (await invoke<string | null>("language_id_for_path", { path })) ?? PLAINTEXT;

  createTab({
    title: basename(path),
    path,
    languageId,
    content,
  });
}

async function saveActive() {
  const tab = activeTabId ? tabs.get(activeTabId) : undefined;
  if (!tab) {
    return;
  }

  let path = tab.path;
  if (!path) {
    path = await invoke<string | null>("pick_save_file", {
      defaultName: tab.title.endsWith(".txt") ? tab.title : `${tab.title}.txt`,
    });
    if (!path) {
      return;
    }
    tab.path = path;
    tab.title = basename(path);

    const detected = await invoke<string | null>("language_id_for_path", { path });
    if (detected && detected !== tab.languageId) {
      tab.languageId = detected;
      monaco.editor.setModelLanguage(tab.model, detected);
      syncLanguageSelect();
    }
  }

  await invoke("write_text_file", {
    path,
    contents: tab.model.getValue(),
  });
  tab.dirty = false;
  renderTabs();
  updateStatusForActive();
}

function setActiveLanguage(languageId: string) {
  const tab = activeTabId ? tabs.get(activeTabId) : undefined;
  if (!tab) {
    return;
  }
  tab.languageId = languageId;
  monaco.editor.setModelLanguage(tab.model, languageId);
  updateStatusForActive();
}

function bindUi() {
  document.querySelector("#btn-new")!.addEventListener("click", () => createTab());
  document.querySelector("#btn-open")!.addEventListener("click", () => void openFile());
  document.querySelector("#btn-save")!.addEventListener("click", () => void saveActive());
  document.querySelector("#btn-find")!.addEventListener("click", () => {
    editor.getAction("actions.find")?.run();
  });
  languageSelect.addEventListener("change", () => setActiveLanguage(languageSelect.value));

  window.addEventListener("keydown", (ev) => {
    const mod = ev.ctrlKey || ev.metaKey;
    if (!mod) {
      return;
    }
    const key = ev.key.toLowerCase();
    if (key === "n") {
      ev.preventDefault();
      createTab();
    } else if (key === "o") {
      ev.preventDefault();
      void openFile();
    } else if (key === "s") {
      ev.preventDefault();
      void saveActive();
    }
  });
}

async function main() {
  setStatus("Loading language plugins…");
  plugins = await invoke<LanguagePluginDto[]>("list_language_plugins");
  await registerTextMateLanguages(monaco, plugins);
  fillLanguageSelect();

  editor = monaco.editor.create(editorHost, {
    value: "",
    language: PLAINTEXT,
    theme: "lapeditor-dark",
    automaticLayout: true,
    fontSize: 14,
    fontFamily: "Cascadia Code, Consolas, 'Courier New', monospace",
    minimap: { enabled: false },
    wordWrap: "on",
    find: {
      seedSearchStringFromSelection: "selection",
      autoFindInSelection: "multiline",
    },
  });

  bindUi();
  createTab({
    title: "Untitled-1",
    content: [
      "// Lapeditor",
      "// Open a .js / .py / .rs / .json / .md file, or pick a language above.",
      "// Find & Replace: Ctrl+F / Ctrl+H",
      "",
      "function hello(name) {",
      '  return `Hello, ${name}!`;',
      "}",
      "",
    ].join("\n"),
    languageId: "javascript",
  });

  setStatus(`Ready · ${plugins.length} language plugin(s)`);
}

main().catch((err) => {
  console.error(err);
  setStatus(`Failed to start: ${String(err)}`);
});
