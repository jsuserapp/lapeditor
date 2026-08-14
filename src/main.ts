import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ask, message } from "@tauri-apps/plugin-dialog";
import * as monaco from "monaco-editor/editor/editor.api.js";
import editorWorkerUrl from "monaco-editor/editor/editor.worker.js?url";
import "monaco-editor/min/vs/editor/editor.main.css";
import { applyDomI18n, listLocales, loadLocale, t } from "./i18n";
import { bindAddLanguageDialog, openAddLanguageDialog } from "./add-language";
import { bindFindWidget, closeFind, openFind, refreshFind, syncFindLocale } from "./find";
import { addFileIcon, applyToolbarIcons } from "./icons";
import { bindTooltips, setTooltip } from "./tooltip";
import { registerLanguageIds, registerTextMateLanguages, type LanguagePluginDto } from "./textmate";
import {
  applyChromeTheme,
  applyEditorTheme,
  defineEditorThemes,
  monacoThemeName,
  themeButtonIcon,
  wrapButtonIcon,
  type ThemeId,
} from "./theme";
import { HexEditor } from "./hex";
import {
  applyMdSplitRatio,
  bindMdGutter,
  bindMdScrollSync,
  clampMdSplit,
  MD_SPLIT_DEFAULT,
} from "./md-split";
import { bindWebviewZoom } from "./zoom";
import {
  base64ToBytes,
  bytesToBase64,
  concatBytes,
  INITIAL_CHUNK,
  MAX_LOADED,
  SCROLL_CHUNK,
} from "./bytesutil";

self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    return new Worker(editorWorkerUrl, { type: "module", name: label });
  },
};

type DiskStamp = {
  mtimeMs: number;
  size: number;
};

const ENCODINGS = ["ansi", "utf-8", "utf-8-bom", "utf-16be", "utf-16le"] as const;
type EncodingId = (typeof ENCODINGS)[number];
type ViewMode = "text" | "hex";

type FileBytesChunkDto = {
  data: string;
  offset: number;
  totalSize: number;
  encoding?: string | null;
};

type TabState = {
  id: string;
  title: string;
  path: string | null;
  untitledNumber: number | null;
  languageId: string;
  encoding: EncodingId;
  model: monaco.editor.ITextModel;
  viewState: monaco.editor.ICodeEditorViewState | null;
  dirty: boolean;
  diskStamp: DiskStamp | null;
  ignoredStamp: DiskStamp | null;
  viewMode: ViewMode;
  bytes: Uint8Array;
  diskSize: number;
  diskLoaded: number;
  bytesStale: boolean;
  textStale: boolean;
  byteMarkIds: string[];
  mdPreview: boolean;
};

type SessionTabDto = {
  id: string;
  title: string;
  path: string | null;
  languageId: string;
  encoding?: string | null;
  dirty: boolean;
  content: string;
  viewState: monaco.editor.ICodeEditorViewState | null;
  lastDiskMtimeMs?: number | null;
  lastDiskSize?: number | null;
  diskLoaded?: number | null;
  diskSize?: number | null;
  viewMode?: string | null;
  mdPreview?: boolean | null;
};

type SessionDto = {
  activeId: string | null;
  tabs: SessionTabDto[];
};

type AppSettings = {
  zoom: number;
  locale: string;
  theme: ThemeId;
  mdSplit?: number;
};

const PLAINTEXT = "plaintext";

function isMarkdownLanguage(languageId: string | undefined): boolean {
  return languageId === "markdown";
}

type MdPreview = {
  render(source: string, immediate?: boolean): void;
  setTheme(theme: ThemeId): void;
};

const tabBar = document.querySelector<HTMLDivElement>("#tab-bar")!;
const syntaxButton = document.querySelector<HTMLButtonElement>("#btn-syntax")!;
const syntaxLabel = document.querySelector<HTMLSpanElement>("#syntax-label")!;
const syntaxMenu = document.querySelector<HTMLDivElement>("#syntax-menu")!;
const saveMenuButton = document.querySelector<HTMLButtonElement>("#btn-save-menu")!;
const saveMenu = document.querySelector<HTMLDivElement>("#save-menu")!;
const localeButton = document.querySelector<HTMLButtonElement>("#btn-locale")!;
const localeMenu = document.querySelector<HTMLDivElement>("#locale-menu")!;
const themeButton = document.querySelector<HTMLButtonElement>("#btn-theme")!;
const statusStatsEl = document.querySelector<HTMLDivElement>("#status-stats")!;
const statusCursorEl = document.querySelector<HTMLDivElement>("#status-cursor")!;
const statusEolEl = document.querySelector<HTMLDivElement>("#status-eol")!;
const statusEncodingEl = document.querySelector<HTMLDivElement>("#status-encoding")!;
const encodingMenu = document.querySelector<HTMLDivElement>("#encoding-menu")!;
const editorHost = document.querySelector<HTMLDivElement>("#editor-host")!;
const monacoHost = document.querySelector<HTMLDivElement>("#monaco-host")!;
const hexHost = document.querySelector<HTMLDivElement>("#hex-host")!;
const hexButton = document.querySelector<HTMLButtonElement>("#btn-hex")!;
const wrapButton = document.querySelector<HTMLButtonElement>("#btn-wrap")!;
const mdHost = document.querySelector<HTMLDivElement>("#md-host")!;
const mdGutter = document.querySelector<HTMLDivElement>("#md-gutter")!;
const mdButton = document.querySelector<HTMLButtonElement>("#btn-md")!;

const tabs = new Map<string, TabState>();
let activeTabId: string | null = null;
let editor: monaco.editor.IStandaloneCodeEditor | undefined;
let wordWrapEnabled = false;
let plugins: LanguagePluginDto[] = [];
let tabSeq = 1;
let restoringSession = false;
let persistTimer: number | undefined;
let sessionFlushing = false;
let applyingExternal = false;
let windowFocused = false;
let fileChangePromptOpen = false;
let syncWatchTimer: number | undefined;
let changeQueue: Promise<void> = Promise.resolve();
const inflightChanges = new Set<string>();
const pendingRecheck = new Set<string>();
const debounceChangeTimers = new Map<string, number>();
let currentTheme: ThemeId = "dark";
let currentLocaleId = "en";
let uiLocales: { id: string; name: string }[] = [];
let hexEditor: HexEditor | undefined;
let mdPreview: MdPreview | undefined;
let mdPreviewLoading: Promise<MdPreview> | null = null;
let mdSplitRatio = MD_SPLIT_DEFAULT;
let syncMdScrollFromEditor: (() => void) | undefined;
const loadingMore = new Set<string>();

function captureActiveViewState() {
  if (!editor || !activeTabId) {
    return;
  }
  const tab = tabs.get(activeTabId);
  if (tab) {
    tab.viewState = editor.saveViewState();
  }
}

function snapshotSession(): SessionDto {
  captureActiveViewState();
  const persisted = [...tabs.values()].filter((tab) => !isEmptyUntitled(tab));
  const activeId =
    (activeTabId && persisted.some((tab) => tab.id === activeTabId) && activeTabId) ||
    persisted[0]?.id ||
    null;
  return {
    activeId,
    tabs: persisted.map((tab) => ({
      id: tab.id,
      title: tab.title,
      path: tab.path,
      languageId: tab.languageId,
      encoding: tab.encoding,
      dirty: tab.dirty,
      content: tab.dirty ? tab.model.getValue() : "",
      viewState: tab.viewState,
      lastDiskMtimeMs: tab.diskStamp?.mtimeMs ?? null,
      lastDiskSize: tab.diskStamp?.size ?? null,
      diskLoaded: tab.diskLoaded,
      diskSize: tab.diskSize,
      viewMode: tab.viewMode,
      mdPreview: tab.mdPreview,
    })),
  };
}

async function persistSession() {
  if (restoringSession) {
    return;
  }
  try {
    await invoke("save_session", { session: snapshotSession() });
  } catch (err) {
    console.warn("failed to persist session", err);
  }
}

function schedulePersistSession() {
  if (restoringSession) {
    return;
  }
  if (persistTimer !== undefined) {
    clearTimeout(persistTimer);
  }
  persistTimer = setTimeout(() => {
    persistTimer = undefined;
    void persistSession();
  }, 400);
}

function layoutEditor() {
  if (hexEditor && !hexHost.hidden) {
    hexEditor.layout();
  }
  if (!editor || monacoHost.hidden) {
    return;
  }
  editor.layout({
    width: monacoHost.clientWidth,
    height: monacoHost.clientHeight,
  });
}

function bindWindowStateSave() {
  const win = getCurrentWindow();
  let timer: number | undefined;

  const schedule = () => {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = undefined;
      void invoke("save_window_state").catch((err) => {
        console.warn("failed to save window state", err);
      });
    }, 1000);
  };

  void win.onMoved(schedule);
  void win.onResized(schedule);
}

function basename(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || path;
}

function dirname(path: string): string {
  const idx = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  if (idx < 0) {
    return "";
  }
  const parent = path.slice(0, idx);
  if (/^[a-zA-Z]:$/.test(parent)) {
    return `${parent}\\`;
  }
  return parent;
}

function defaultSaveName(tab: TabState): string {
  if (tab.path) {
    return basename(tab.path);
  }
  return tab.title.endsWith(".txt") ? tab.title : `${tab.title}.txt`;
}

function isEmptyUntitled(tab: TabState): boolean {
  return !tab.path && tab.model.getValue() === "" && tab.bytes.length === 0 && !tab.dirty;
}

function tabFullyLoaded(tab: TabState): boolean {
  return !tab.path || tab.diskLoaded >= tab.diskSize;
}

async function decodeBytes(bytes: Uint8Array, encoding: EncodingId): Promise<string> {
  if (bytes.length === 0) {
    return "";
  }
  return invoke<string>("decode_bytes", { data: bytesToBase64(bytes), encoding });
}

async function encodeText(text: string, encoding: EncodingId): Promise<Uint8Array> {
  const data = await invoke<string>("encode_bytes", { text, encoding });
  return base64ToBytes(data);
}

async function syncBytesFromText(tab: TabState) {
  if (!tab.bytesStale) {
    return;
  }
  tab.bytes = await encodeText(tab.model.getValue(), tab.encoding);
  tab.bytesStale = false;
}

async function syncTextFromBytes(tab: TabState) {
  if (!tab.textStale) {
    return;
  }
  const text = await decodeBytes(tab.bytes, tab.encoding);
  await applyModelText(tab, text);
  tab.textStale = false;
}

function syncHexButton() {
  const tab = activeTabId ? tabs.get(activeTabId) : undefined;
  const hex = tab?.viewMode === "hex";
  hexButton.classList.toggle("active", hex);
  hexButton.setAttribute("aria-pressed", hex ? "true" : "false");
  setTooltip(hexButton, t("toolbar.hexTitle"));
  syncWrapButton();
  syncMdPreviewButton();
}

function syncWrapButton() {
  const tab = activeTabId ? tabs.get(activeTabId) : undefined;
  const hex = tab?.viewMode === "hex";
  wrapButton.classList.toggle("active", wordWrapEnabled && !hex);
  wrapButton.setAttribute("aria-pressed", wordWrapEnabled ? "true" : "false");
  wrapButton.disabled = !!hex || !tab;
  const label = wordWrapEnabled ? t("toolbar.wrapOn") : t("toolbar.wrapOff");
  setTooltip(wrapButton, label);
  wrapButton.setAttribute("aria-label", label);
}

function tabShowsMdPreview(tab: TabState): boolean {
  return tab.mdPreview && isMarkdownLanguage(tab.languageId) && tab.viewMode !== "hex";
}

async function ensureMdPreview(): Promise<MdPreview> {
  if (mdPreview) {
    return mdPreview;
  }
  if (!mdPreviewLoading) {
    mdPreviewLoading = import("./markdown").then((mod) => {
      const preview = new mod.MarkdownPreview(mdHost);
      preview.setTheme(currentTheme);
      mdPreview = preview;
      return preview;
    });
  }
  return mdPreviewLoading;
}

function applyMdPreview(tab: TabState | undefined) {
  const on = !!tab && tabShowsMdPreview(tab);
  editorHost.classList.toggle("md-split", on);
  mdHost.hidden = !on;
  mdGutter.hidden = !on;
  if (on && tab) {
    const source = tab.model.getValue();
    const tabId = tab.id;
    void ensureMdPreview().then((preview) => {
      const current = activeTabId ? tabs.get(activeTabId) : undefined;
      if (current?.id === tabId && tabShowsMdPreview(current)) {
        preview.render(source, true);
      }
    });
  }
}

function syncMdPreviewButton() {
  const tab = activeTabId ? tabs.get(activeTabId) : undefined;
  const markdown = isMarkdownLanguage(tab?.languageId);
  const on = !!tab && markdown && tab.mdPreview && tab.viewMode !== "hex";
  mdButton.classList.toggle("active", on);
  mdButton.setAttribute("aria-pressed", on ? "true" : "false");
  mdButton.disabled = !tab || !markdown;
  const label = on ? t("toolbar.mdOn") : t("toolbar.mdOff");
  setTooltip(mdButton, label);
  mdButton.setAttribute("aria-label", label);
}

async function toggleMdPreview() {
  const tab = activeTabId ? tabs.get(activeTabId) : undefined;
  if (!tab || !isMarkdownLanguage(tab.languageId)) {
    return;
  }
  tab.mdPreview = !tab.mdPreview;
  if (tab.mdPreview && tab.viewMode === "hex") {
    tab.viewMode = "text";
    await showTabView(tab);
  } else {
    applyMdPreview(tab);
    layoutEditor();
    syncMdPreviewButton();
  }
  schedulePersistSession();
}

function toggleWordWrap() {
  const tab = activeTabId ? tabs.get(activeTabId) : undefined;
  if (!tab || tab.viewMode === "hex" || !editor) {
    return;
  }
  wordWrapEnabled = !wordWrapEnabled;
  editor.updateOptions({ wordWrap: wordWrapEnabled ? "on" : "off" });
  syncWrapButton();
}

function fillHexLabels() {
  hexEditor?.setAddressLabel(t("hex.address"), t("hex.dump"));
}

async function showTabView(tab: TabState) {
  if (tab.viewMode === "hex") {
    await syncBytesFromText(tab);
    monacoHost.hidden = true;
    hexHost.hidden = false;
    hexEditor?.setBytes(tab.bytes, Math.max(tab.diskSize, tab.bytes.length));
    fillHexLabels();
    hexEditor?.focus();
    closeFind();
  } else {
    if (tab.textStale && hexEditor) {
      tab.bytes = hexEditor.getBytes();
    }
    await syncTextFromBytes(tab);
    hexHost.hidden = true;
    monacoHost.hidden = false;
    editor?.focus();
  }
  applyMdPreview(tab);
  syncHexButton();
  layoutEditor();
  updateStatusBar();
}

async function toggleHexView() {
  const tab = activeTabId ? tabs.get(activeTabId) : undefined;
  if (!tab) {
    return;
  }
  tab.viewMode = tab.viewMode === "hex" ? "text" : "hex";
  await showTabView(tab);
  schedulePersistSession();
}

async function loadFilePrefix(path: string, encoding?: EncodingId) {
  const chunk = await invoke<FileBytesChunkDto>("read_file_bytes", {
    path,
    offset: 0,
    length: INITIAL_CHUNK,
  });
  const bytes = base64ToBytes(chunk.data);
  const enc = encoding ?? normalizeEncoding(chunk.encoding);
  const text = await decodeBytes(bytes, enc);
  return {
    bytes,
    encoding: enc,
    text,
    diskSize: chunk.totalSize,
    diskLoaded: bytes.length,
  };
}

async function loadMoreForTab(tab: TabState) {
  if (!tab.path || tabFullyLoaded(tab) || tab.diskLoaded >= MAX_LOADED) {
    return;
  }
  if (tab.viewMode === "text" && tab.dirty) {
    return;
  }
  if (loadingMore.has(tab.id)) {
    return;
  }
  loadingMore.add(tab.id);
  try {
    const chunk = await invoke<FileBytesChunkDto>("read_file_bytes", {
      path: tab.path,
      offset: tab.diskLoaded,
      length: SCROLL_CHUNK,
    });
    const more = base64ToBytes(chunk.data);
    tab.diskSize = chunk.totalSize;
    if (!more.length) {
      return;
    }
    tab.bytes = concatBytes(tab.bytes, more);
    tab.diskLoaded += more.length;
    if (tab.viewMode === "hex") {
      hexEditor?.setBytes(tab.bytes, Math.max(tab.diskSize, tab.bytes.length));
    } else {
      const text = await decodeBytes(tab.bytes, tab.encoding);
      await applyModelText(tab, text);
    }
    updateStatusBar();
  } catch (err) {
    console.warn("failed to load more file data", err);
  } finally {
    loadingMore.delete(tab.id);
  }
}

function parseUntitledNumber(title: string | undefined): number | null {
  if (!title) {
    return null;
  }
  const match = title.match(/(\d+)$/);
  if (!match) {
    return null;
  }
  const n = Number(match[1]);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function nextUntitledNumber(preferred?: number | null): number {
  const used = new Set<number>();
  for (const tab of tabs.values()) {
    if (tab.untitledNumber != null) {
      used.add(tab.untitledNumber);
    }
  }
  if (preferred && preferred > 0 && !used.has(preferred)) {
    return preferred;
  }
  let n = 1;
  while (used.has(n)) {
    n += 1;
  }
  return n;
}

function retitleUntitledTabs() {
  for (const tab of tabs.values()) {
    if (tab.untitledNumber != null && !tab.path) {
      tab.title = t("tab.untitled", { n: tab.untitledNumber });
    }
  }
}

function pathKey(path: string): string {
  return path.replace(/^\\\\\?\\/, "").replace(/\\/g, "/").toLowerCase();
}

function stampsEqual(a: DiskStamp | null, b: DiskStamp | null): boolean {
  return !!a && !!b && a.mtimeMs === b.mtimeMs && a.size === b.size;
}

function openPaths(): string[] {
  const seen = new Set<string>();
  const paths: string[] = [];
  for (const tab of tabs.values()) {
    if (!tab.path) {
      continue;
    }
    const key = pathKey(tab.path);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    paths.push(tab.path);
  }
  return paths;
}

async function stampTabFromDisk(tab: TabState) {
  if (!tab.path) {
    tab.diskStamp = null;
    return;
  }
  try {
    tab.diskStamp = await invoke<DiskStamp>("stat_text_file", { path: tab.path });
  } catch {
    tab.diskStamp = null;
  }
}

async function reloadTabFromDisk(tab: TabState) {
  if (!tab.path || !editor) {
    return;
  }

  let content: string;
  try {
    const file = await loadFilePrefix(tab.path);
    content = file.text;
    tab.encoding = file.encoding;
    tab.bytes = file.bytes;
    tab.diskSize = file.diskSize;
    tab.diskLoaded = file.diskLoaded;
    tab.bytesStale = false;
    tab.textStale = false;
  } catch {
    if (!tab.dirty) {
      tab.dirty = true;
      renderTabs();
    }
    console.warn(t("status.fileMissing", { name: tab.title }));
    return;
  }

  const viewState =
    tab.id === activeTabId ? editor.saveViewState() : tab.viewState;
  applyingExternal = true;
  try {
    if (tab.model.getValue() !== content) {
      tab.model.setValue(content);
    }
    tab.dirty = false;
    tab.ignoredStamp = null;
  } finally {
    applyingExternal = false;
  }
  await stampTabFromDisk(tab);
  if (viewState) {
    if (tab.id === activeTabId) {
      editor.restoreViewState(viewState);
    } else {
      tab.viewState = viewState;
    }
  }
  renderTabs();
  if (tab.id === activeTabId) {
    await showTabView(tab);
  } else {
    updateStatusForActive();
  }
  schedulePersistSession();
}

async function handleExternalChange(path: string) {
  const key = pathKey(path);
  const matches = [...tabs.values()].filter(
    (tab) => tab.path && pathKey(tab.path) === key,
  );
  if (!matches.length) {
    return;
  }

  const tabPath = matches[0].path!;
  let stat: DiskStamp | null = null;
  try {
    stat = await invoke<DiskStamp>("stat_text_file", { path: tabPath });
  } catch {
    stat = null;
  }

  for (const tab of matches) {
    if (stat && stampsEqual(stat, tab.diskStamp)) {
      continue;
    }
    if (stat && stampsEqual(stat, tab.ignoredStamp)) {
      continue;
    }

    if (!stat) {
      if (!tab.dirty) {
        tab.dirty = true;
        renderTabs();
      }
      console.warn(t("status.fileMissing", { name: tab.title }));
      continue;
    }

    if (!tab.dirty) {
      await reloadTabFromDisk(tab);
      continue;
    }

    fileChangePromptOpen = true;
    let reload = false;
    try {
      reload = await ask(t("dialog.fileChanged", { name: tab.title }), {
        title: t("dialog.fileChangedTitle"),
        kind: "warning",
        okLabel: t("dialog.loadFromDisk"),
        cancelLabel: t("dialog.keepEdits"),
      });
    } finally {
      fileChangePromptOpen = false;
      windowFocused = await getCurrentWindow().isFocused();
      if (windowFocused) {
        void syncWatchedFiles();
      } else {
        void invoke("watch_text_files", { paths: [] }).catch((err) => {
          console.warn("failed to pause file watch", err);
        });
      }
    }
    if (reload) {
      await reloadTabFromDisk(tab);
    } else {
      tab.ignoredStamp = stat;
    }
  }
}

function enqueueExternalChange(path: string) {
  const key = pathKey(path);
  if (inflightChanges.has(key)) {
    pendingRecheck.add(key);
    return;
  }
  inflightChanges.add(key);
  changeQueue = changeQueue.then(async () => {
    try {
      await handleExternalChange(path);
    } catch (err) {
      console.warn("failed to handle external file change", err);
    } finally {
      inflightChanges.delete(key);
      if (pendingRecheck.delete(key)) {
        enqueueExternalChange(path);
      }
    }
  });
}

async function checkAllOpenFiles() {
  for (const path of openPaths()) {
    await handleExternalChange(path);
  }
}

async function syncWatchedFiles() {
  const paths = windowFocused ? openPaths() : [];
  try {
    await invoke("watch_text_files", { paths });
  } catch (err) {
    console.warn("failed to watch files", err);
  }
}

function scheduleSyncWatchedFiles() {
  if (restoringSession) {
    return;
  }
  if (syncWatchTimer !== undefined) {
    clearTimeout(syncWatchTimer);
  }
  syncWatchTimer = window.setTimeout(() => {
    syncWatchTimer = undefined;
    void syncWatchedFiles();
  }, 50);
}

async function bindFileWatch() {
  const win = getCurrentWindow();
  windowFocused = await win.isFocused();

    await listen<string>("external-file-changed", (event) => {
    if (!windowFocused || sessionFlushing) {
      return;
    }
    const path = event.payload;
    const key = pathKey(path);
    const prev = debounceChangeTimers.get(key);
    if (prev !== undefined) {
      clearTimeout(prev);
    }
    debounceChangeTimers.set(
      key,
      window.setTimeout(() => {
        debounceChangeTimers.delete(key);
        enqueueExternalChange(path);
      }, 200),
    );
  });

  await win.onFocusChanged(({ payload: focused }) => {
    if (fileChangePromptOpen || sessionFlushing) {
      return;
    }
    windowFocused = focused;
    if (focused) {
      void (async () => {
        await checkAllOpenFiles();
        await syncWatchedFiles();
      })();
    } else {
      void invoke("watch_text_files", { paths: [] }).catch((err) => {
        console.warn("failed to pause file watch", err);
      });
    }
  });

  if (windowFocused) {
    await checkAllOpenFiles();
    await syncWatchedFiles();
  }
}

function languageLabel(id: string): string {
  if (id === PLAINTEXT) {
    return t("tab.plainText");
  }
  const plugin = plugins.find((p) => p.id === id);
  return plugin?.aliases[0] ?? id;
}

function fillLanguageMenu() {
  const selected = (activeTabId ? tabs.get(activeTabId)?.languageId : null) ?? PLAINTEXT;
  syntaxMenu.innerHTML = "";
  const ids = [PLAINTEXT, ...plugins.map((plugin) => plugin.id)];
  for (const id of ids) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = `popover-item${id === selected ? " active" : ""}`;
    item.role = "menuitem";
    item.dataset.languageId = id;
    item.textContent = languageLabel(id);
    syntaxMenu.appendChild(item);
  }
  const footer = document.createElement("div");
  footer.className = "popover-footer";
  const sep = document.createElement("div");
  sep.className = "popover-sep";
  sep.setAttribute("role", "separator");
  const add = document.createElement("button");
  add.type = "button";
  add.className = "popover-item";
  add.role = "menuitem";
  add.dataset.action = "add-language";
  add.textContent = t("lang.add");
  footer.append(sep, add);
  syntaxMenu.appendChild(footer);
}

function fillLocaleMenu(locales: { id: string; name: string }[], selectedId: string) {
  uiLocales = locales;
  currentLocaleId = selectedId;
  localeMenu.innerHTML = "";
  for (const locale of locales) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = `popover-item${locale.id === selectedId ? " active" : ""}`;
    item.role = "menuitem";
    item.dataset.localeId = locale.id;
    item.textContent = locale.name;
    localeMenu.appendChild(item);
  }
}

function normalizeEncoding(value: string | null | undefined): EncodingId {
  const id = (value ?? "utf-8").trim().toLowerCase();
  return (ENCODINGS as readonly string[]).includes(id) ? (id as EncodingId) : "utf-8";
}

function encodingStatusLabel(id: EncodingId): string {
  switch (id) {
    case "ansi":
      return t("status.encoding.ansi");
    case "utf-8-bom":
      return t("status.encoding.utf8bom");
    case "utf-16be":
      return t("status.encoding.utf16be");
    case "utf-16le":
      return t("status.encoding.utf16le");
    default:
      return t("status.encoding.utf8");
  }
}

const ENCODING_MENU_ITEMS: { id: EncodingId; useKey: string; convertKey: string }[] = [
  { id: "ansi", useKey: "encoding.useAnsi", convertKey: "encoding.convertAnsi" },
  { id: "utf-8", useKey: "encoding.useUtf8", convertKey: "encoding.convertUtf8" },
  { id: "utf-8-bom", useKey: "encoding.useUtf8bom", convertKey: "encoding.convertUtf8bom" },
  { id: "utf-16be", useKey: "encoding.useUtf16be", convertKey: "encoding.convertUtf16be" },
  { id: "utf-16le", useKey: "encoding.useUtf16le", convertKey: "encoding.convertUtf16le" },
];

function appendEncodingItem(id: EncodingId, label: string, action: "use" | "convert", checked: boolean) {
  const item = document.createElement("button");
  item.type = "button";
  item.className = `popover-item${checked ? " checked" : ""}`;
  item.role = "menuitem";
  item.dataset.encodingId = id;
  item.dataset.encodingAction = action;

  const mark = document.createElement("span");
  mark.className = "encoding-item-mark";
  mark.setAttribute("aria-hidden", "true");

  const text = document.createElement("span");
  text.className = "encoding-item-label";
  text.textContent = label;

  item.append(mark, text);
  encodingMenu.appendChild(item);
}

function fillEncodingMenu() {
  const tab = activeTabId ? tabs.get(activeTabId) : undefined;
  const current = tab?.encoding ?? "utf-8";
  encodingMenu.innerHTML = "";
  for (const item of ENCODING_MENU_ITEMS) {
    appendEncodingItem(item.id, t(item.useKey), "use", item.id === current);
  }
  const sep = document.createElement("div");
  sep.className = "popover-sep";
  sep.setAttribute("role", "separator");
  encodingMenu.appendChild(sep);
  for (const item of ENCODING_MENU_ITEMS) {
    appendEncodingItem(item.id, t(item.convertKey), "convert", false);
  }
}

function setEncodingMenuOpen(open: boolean) {
  if (open) {
    fillEncodingMenu();
    localeMenu.hidden = true;
    localeButton.setAttribute("aria-expanded", "false");
    syntaxMenu.hidden = true;
    syntaxButton.setAttribute("aria-expanded", "false");
    saveMenu.hidden = true;
    saveMenuButton.setAttribute("aria-expanded", "false");
  }
  encodingMenu.hidden = !open;
  statusEncodingEl.setAttribute("aria-expanded", open ? "true" : "false");
}

async function applyModelText(tab: TabState, content: string) {
  const viewState =
    tab.id === activeTabId ? editor?.saveViewState() ?? tab.viewState : tab.viewState;
  applyingExternal = true;
  try {
    if (tab.model.getValue() !== content) {
      tab.model.setValue(content);
    }
  } finally {
    applyingExternal = false;
  }
  if (viewState) {
    if (tab.id === activeTabId && editor) {
      editor.restoreViewState(viewState);
    } else {
      tab.viewState = viewState;
    }
  }
  refreshByteMarkDecorations(tab);
}

function refreshByteMarkDecorations(tab: TabState) {
  const model = tab.model;
  const next: monaco.editor.IModelDeltaDecoration[] = [];
  const text = model.getValue();
  const re = /\[x[0-9A-Fa-f]{2}\]/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    const start = model.getPositionAt(match.index);
    const end = model.getPositionAt(match.index + match[0].length);
    next.push({
      range: new monaco.Range(start.lineNumber, start.column, end.lineNumber, end.column),
      options: {
        inlineClassName: "encoding-byte-mark",
        stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
      },
    });
  }
  tab.byteMarkIds = model.deltaDecorations(tab.byteMarkIds, next);
}

async function useTabEncoding(tab: TabState, encoding: EncodingId) {
  if (tab.encoding === encoding) {
    return;
  }
  try {
    if (tab.viewMode === "hex" && hexEditor) {
      tab.bytes = hexEditor.getBytes();
      tab.bytesStale = false;
    } else {
      await syncBytesFromText(tab);
    }
    tab.encoding = encoding;
    const text = await decodeBytes(tab.bytes, encoding);
    await applyModelText(tab, text);
    tab.textStale = false;
    tab.bytesStale = false;
  } catch (err) {
    console.warn("failed to apply encoding", err);
    return;
  }
  if (tab.viewMode === "hex") {
    await showTabView(tab);
  }
  renderTabs();
  updateStatusBar();
  schedulePersistSession();
}

async function convertTabEncoding(tab: TabState, encoding: EncodingId) {
  if (tab.encoding === encoding) {
    return;
  }
  try {
    if (tab.viewMode === "hex" && hexEditor) {
      tab.bytes = hexEditor.getBytes();
      tab.bytesStale = false;
    } else {
      await syncBytesFromText(tab);
    }
    const data = await invoke<string>("convert_bytes", {
      data: bytesToBase64(tab.bytes),
      from: tab.encoding,
      to: encoding,
    });
    tab.bytes = base64ToBytes(data);
    tab.encoding = encoding;
    tab.bytesStale = false;
    tab.textStale = false;
    const text = await decodeBytes(tab.bytes, encoding);
    await applyModelText(tab, text);
    if (!tab.dirty) {
      tab.dirty = true;
      renderTabs();
    }
    if (tab.viewMode === "hex") {
      await showTabView(tab);
    }
  } catch (err) {
    console.warn("failed to convert encoding", err);
    return;
  }
  updateStatusBar();
  schedulePersistSession();
}

function setLocaleMenuOpen(open: boolean) {
  if (open) {
    encodingMenu.hidden = true;
    statusEncodingEl.setAttribute("aria-expanded", "false");
    syntaxMenu.hidden = true;
    syntaxButton.setAttribute("aria-expanded", "false");
    saveMenu.hidden = true;
    saveMenuButton.setAttribute("aria-expanded", "false");
  }
  localeMenu.hidden = !open;
  localeButton.setAttribute("aria-expanded", open ? "true" : "false");
}

function setSyntaxMenuOpen(open: boolean) {
  if (open) {
    fillLanguageMenu();
    encodingMenu.hidden = true;
    statusEncodingEl.setAttribute("aria-expanded", "false");
    localeMenu.hidden = true;
    localeButton.setAttribute("aria-expanded", "false");
    saveMenu.hidden = true;
    saveMenuButton.setAttribute("aria-expanded", "false");
  }
  syntaxMenu.hidden = !open;
  syntaxButton.setAttribute("aria-expanded", open ? "true" : "false");
}

function setSaveMenuOpen(open: boolean) {
  if (open) {
    encodingMenu.hidden = true;
    statusEncodingEl.setAttribute("aria-expanded", "false");
    localeMenu.hidden = true;
    localeButton.setAttribute("aria-expanded", "false");
    syntaxMenu.hidden = true;
    syntaxButton.setAttribute("aria-expanded", "false");
  }
  saveMenu.hidden = !open;
  saveMenuButton.setAttribute("aria-expanded", open ? "true" : "false");
}

function syncLocaleButton() {
  setTooltip(localeButton, t("locale.title"));
}

function syncThemeButton() {
  themeButton.innerHTML = themeButtonIcon(currentTheme);
  const label = currentTheme === "dark" ? t("theme.toLight") : t("theme.toDark");
  setTooltip(themeButton, label);
  themeButton.setAttribute("aria-label", label);
}

function applyTheme(theme: ThemeId) {
  currentTheme = theme === "light" ? "light" : "dark";
  applyChromeTheme(currentTheme);
  if (editor) {
    applyEditorTheme(monaco, currentTheme);
  }
  mdPreview?.setTheme(currentTheme);
  const tab = activeTabId ? tabs.get(activeTabId) : undefined;
  if (tab && tabShowsMdPreview(tab)) {
    void ensureMdPreview().then((preview) => {
      preview.setTheme(currentTheme);
      preview.render(tab.model.getValue(), true);
    });
  }
  syncThemeButton();
}

function renderTabs() {
  tabBar.innerHTML = "";
  for (const tab of tabs.values()) {
    const el = document.createElement("div");
    el.className = `tab${tab.id === activeTabId ? " active" : ""}`;
    el.dataset.tabId = tab.id;

    const title = document.createElement("span");
    title.className = "tab-title";
    title.textContent = tab.dirty ? `* ${tab.title}` : tab.title;

    const close = document.createElement("button");
    close.type = "button";
    close.className = "tab-close";
    setTooltip(close, t("tab.close"));
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

  const add = document.createElement("button");
  add.type = "button";
  add.className = "tab-new";
  setTooltip(add, t("toolbar.newTitle"));
  add.setAttribute("aria-label", t("toolbar.new"));
  const icon = document.createElement("img");
  icon.src = addFileIcon;
  icon.alt = "";
  add.appendChild(icon);
  add.addEventListener("click", () => createTab());
  tabBar.appendChild(add);
}

function syncLanguageSelect() {
  const tab = activeTabId ? tabs.get(activeTabId) : undefined;
  syntaxLabel.textContent = languageLabel(tab?.languageId ?? PLAINTEXT);
}

function updateStatusForActive() {
  updateStatusBar();
}

type EolKind = "crlf" | "lf" | "cr" | "mixed";

function detectEol(model: monaco.editor.ITextModel): EolKind {
  const text = model.getValue();
  let crlf = false;
  let cr = false;
  let lf = false;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === 13) {
      if (text.charCodeAt(i + 1) === 10) {
        crlf = true;
        i += 1;
      } else {
        cr = true;
      }
    } else if (code === 10) {
      lf = true;
    }
  }
  const kinds = Number(crlf) + Number(cr) + Number(lf);
  if (kinds === 0) {
    return model.getEOL() === "\r\n" ? "crlf" : "lf";
  }
  if (kinds > 1) {
    return "mixed";
  }
  if (crlf) {
    return "crlf";
  }
  if (cr) {
    return "cr";
  }
  return "lf";
}

function eolLabel(kind: EolKind): string {
  if (kind === "crlf") {
    return t("status.eol.crlf");
  }
  if (kind === "cr") {
    return t("status.eol.cr");
  }
  if (kind === "mixed") {
    return t("status.eol.mixed");
  }
  return t("status.eol.lf");
}

function toggleActiveEol() {
  const tab = activeTabId ? tabs.get(activeTabId) : undefined;
  if (!tab || tab.viewMode === "hex") {
    return;
  }
  const next =
    detectEol(tab.model) === "lf"
      ? monaco.editor.EndOfLineSequence.CRLF
      : monaco.editor.EndOfLineSequence.LF;
  tab.model.setEOL(next);
  updateStatusBar();
  schedulePersistSession();
}

function setStatusLabeledItems(
  cell: HTMLDivElement,
  items: { label: string; value: string | number }[],
) {
  cell.replaceChildren(
    ...items.map(({ label, value }) => {
      const item = document.createElement("span");
      item.className = "status-item";

      const lab = document.createElement("span");
      lab.className = "status-label";
      lab.textContent = `${label} : `;

      const val = document.createElement("span");
      val.className = "status-value";
      val.textContent = String(value);

      item.append(lab, val);
      return item;
    }),
  );
}

function updateStatusBar() {
  const tab = activeTabId ? tabs.get(activeTabId) : undefined;
  const model = tab?.model ?? editor?.getModel() ?? null;
  if (!tab || !model) {
    statusStatsEl.replaceChildren();
    statusCursorEl.replaceChildren();
    statusEolEl.textContent = "";
    statusEncodingEl.textContent = "";
    setEncodingMenuOpen(false);
    return;
  }

  if (tab.viewMode === "hex") {
    const loaded = tab.bytes.length;
    const total = Math.max(tab.diskSize, loaded);
    setStatusLabeledItems(statusStatsEl, [
      {
        label: t("status.length"),
        value: loaded === total ? loaded : `${loaded} / ${total}`,
      },
    ]);
    const offset = hexEditor?.getOffset() ?? 0;
    setStatusLabeledItems(statusCursorEl, [
      { label: t("status.offset"), value: offset.toString(16).padStart(8, "0") },
      { label: t("status.pos"), value: offset },
    ]);
    statusEolEl.textContent = "";
    statusEncodingEl.textContent = encodingStatusLabel(tab.encoding);
    return;
  }

  const length = model.getValueLength();
  const lines = model.getLineCount();
  setStatusLabeledItems(statusStatsEl, [
    { label: t("status.length"), value: length },
    { label: t("status.lines"), value: lines },
  ]);

  const position = editor?.getPosition();
  const line = position?.lineNumber ?? 1;
  const column = position?.column ?? 1;
  const pos = position ? model.getOffsetAt(position) + 1 : 1;
  setStatusLabeledItems(statusCursorEl, [
    { label: t("status.ln"), value: line },
    { label: t("status.col"), value: column },
    { label: t("status.pos"), value: pos },
  ]);

  statusEolEl.textContent = eolLabel(detectEol(model));
  statusEncodingEl.textContent = encodingStatusLabel(tab.encoding);
}

function activateTab(id: string) {
  if (!editor) {
    return;
  }
  if (activeTabId && activeTabId !== id) {
    const prev = tabs.get(activeTabId);
    if (prev) {
      prev.viewState = editor.saveViewState();
      if (prev.viewMode === "hex" && hexEditor) {
        prev.bytes = hexEditor.getBytes();
      }
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
  renderTabs();
  syncLanguageSelect();
  void showTabView(tab).then(() => refreshFind({ reveal: false }));
  schedulePersistSession();
}

function createTab(options?: {
  id?: string;
  title?: string;
  path?: string | null;
  untitledNumber?: number | null;
  languageId?: string;
  encoding?: string;
  content?: string;
  dirty?: boolean;
  viewState?: monaco.editor.ICodeEditorViewState | null;
  activate?: boolean;
  bytes?: Uint8Array;
  diskSize?: number;
  diskLoaded?: number;
  viewMode?: ViewMode;
  mdPreview?: boolean;
}): TabState {
  const id = options?.id ?? `tab-${tabSeq++}`;
  const numeric = Number(id.replace(/^tab-/, ""));
  if (Number.isFinite(numeric)) {
    tabSeq = Math.max(tabSeq, numeric + 1);
  }

  const path = options?.path ?? null;
  let untitledNumber: number | null = null;
  let title: string;
  if (path) {
    title = options?.title ?? basename(path);
  } else {
    const n = nextUntitledNumber(
      options?.untitledNumber ?? parseUntitledNumber(options?.title),
    );
    untitledNumber = n;
    title = t("tab.untitled", { n });
  }
  const languageId = options?.languageId ?? PLAINTEXT;
  const model = monaco.editor.createModel(options?.content ?? "", languageId);
  const tab: TabState = {
    id,
    title,
    path,
    untitledNumber,
    languageId,
    encoding: normalizeEncoding(options?.encoding),
    model,
    viewState: options?.viewState ?? null,
    dirty: options?.dirty ?? false,
    diskStamp: null,
    ignoredStamp: null,
    viewMode: options?.viewMode === "hex" ? "hex" : "text",
    bytes: options?.bytes ?? new Uint8Array(0),
    diskSize: options?.diskSize ?? options?.bytes?.length ?? 0,
    diskLoaded: options?.diskLoaded ?? options?.bytes?.length ?? 0,
    bytesStale: !options?.bytes,
    textStale: false,
    byteMarkIds: [],
    mdPreview: options?.mdPreview === true && isMarkdownLanguage(languageId),
  };

  model.onDidChangeContent(() => {
    if (restoringSession || applyingExternal) {
      return;
    }
    if (!tab.dirty) {
      tab.dirty = true;
      renderTabs();
      updateStatusForActive();
    }
    tab.bytesStale = true;
    tab.textStale = false;
    refreshByteMarkDecorations(tab);
    updateStatusBar();
    refreshFind({ reveal: false });
    schedulePersistSession();
    if (tab.id === activeTabId && tabShowsMdPreview(tab)) {
      void ensureMdPreview().then((preview) => {
        preview.render(tab.model.getValue());
      });
    }
  });

  tabs.set(id, tab);
  refreshByteMarkDecorations(tab);
  if (options?.activate !== false) {
    activateTab(id);
  }
  scheduleSyncWatchedFiles();
  return tab;
}

async function closeTab(id: string) {
  const tab = tabs.get(id);
  if (!tab) {
    return;
  }

  if (tab.path && tab.dirty) {
    const saveLabel = t("dialog.save");
    const discardLabel = t("dialog.discard");
    const cancelLabel = t("dialog.cancel");
    fileChangePromptOpen = true;
    let result: string;
    try {
      result = await message(t("dialog.closeDirty", { name: tab.title }), {
        title: t("dialog.closeDirtyTitle"),
        kind: "warning",
        buttons: {
          yes: saveLabel,
          no: discardLabel,
          cancel: cancelLabel,
        },
      });
    } finally {
      fileChangePromptOpen = false;
      windowFocused = await getCurrentWindow().isFocused();
      if (windowFocused) {
        void syncWatchedFiles();
      }
    }
    if (result === "Cancel" || result === cancelLabel) {
      return;
    }
    if (result === "Yes" || result === saveLabel) {
      const saved = await saveTab(tab);
      if (!saved) {
        return;
      }
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
      editor?.setModel(null);
      renderTabs();
      syncLanguageSelect();
      updateStatusForActive();
    }
  } else {
    renderTabs();
  }
  schedulePersistSession();
  scheduleSyncWatchedFiles();
}

async function openPath(path: string) {
  const file = await loadFilePrefix(path);
  const languageId =
    (await invoke<string | null>("language_id_for_path", { path })) ?? PLAINTEXT;

  const tab = createTab({
    title: basename(path),
    path,
    languageId,
    encoding: file.encoding,
    content: file.text,
    bytes: file.bytes,
    diskSize: file.diskSize,
    diskLoaded: file.diskLoaded,
  });
  await stampTabFromDisk(tab);
  schedulePersistSession();
}

async function openFile() {
  const path = await invoke<string | null>("pick_open_file", {
    title: t("dialog.openFile"),
  });
  if (!path) {
    return;
  }
  await openPath(path);
}

async function openDroppedPaths(paths: string[]) {
  const seen = new Set<string>();
  for (const path of paths) {
    const key = pathKey(path);
    if (!path || seen.has(key)) {
      continue;
    }
    seen.add(key);
    try {
      await openPath(path);
    } catch (err) {
      console.warn("failed to open dropped file", path, err);
    }
  }
}

function setFileDropping(on: boolean) {
  document.body.classList.toggle("file-dropping", on);
}

async function bindFileDrop() {
  await getCurrentWebview().onDragDropEvent((event) => {
    if (event.payload.type === "enter" || event.payload.type === "over") {
      setFileDropping(true);
      return;
    }
    setFileDropping(false);
    if (event.payload.type !== "drop") {
      return;
    }
    void openDroppedPaths(event.payload.paths);
  });

  const blockBrowserDrop = (ev: DragEvent) => {
    ev.preventDefault();
  };
  window.addEventListener("dragover", blockBrowserDrop);
  window.addEventListener("drop", blockBrowserDrop);
}

async function pickSavePath(tab: TabState, title: string): Promise<string | null> {
  return invoke<string | null>("pick_save_file", {
    defaultName: defaultSaveName(tab),
    directory: tab.path ? dirname(tab.path) : null,
    title,
  });
}

async function saveTab(tab: TabState, options?: { saveAs?: boolean }): Promise<boolean> {
  const saveAs = options?.saveAs === true;
  const previousPath = tab.path;
  let path = saveAs ? null : tab.path;
  if (!path) {
    path = await pickSavePath(tab, saveAs ? t("dialog.saveAsFile") : t("dialog.saveFile"));
    if (!path) {
      return false;
    }
    tab.path = path;
    tab.title = basename(path);
    tab.untitledNumber = null;
    tab.ignoredStamp = null;

    const detected = await invoke<string | null>("language_id_for_path", { path });
    if (detected && detected !== tab.languageId) {
      tab.languageId = detected;
      monaco.editor.setModelLanguage(tab.model, detected);
      syncLanguageSelect();
    }
  }

  if (tab.viewMode === "hex" && hexEditor) {
    tab.bytes = hexEditor.getBytes();
    tab.bytesStale = false;
  } else {
    await syncBytesFromText(tab);
  }
  const tailOffset = tabFullyLoaded(tab) ? null : tab.diskLoaded;
  const tailFrom =
    tailOffset != null && previousPath && previousPath !== path ? previousPath : null;
  const tailLen = tailOffset == null ? 0 : Math.max(0, tab.diskSize - tab.diskLoaded);
  await invoke("write_file_bytes", {
    path,
    data: bytesToBase64(tab.bytes),
    tailOffset,
    tailFrom,
  });
  tab.diskLoaded = tab.bytes.length;
  tab.diskSize = tab.bytes.length + tailLen;
  tab.bytesStale = false;
  tab.dirty = false;
  tab.ignoredStamp = null;
  await stampTabFromDisk(tab);
  renderTabs();
  updateStatusForActive();
  schedulePersistSession();
  scheduleSyncWatchedFiles();
  return true;
}

async function saveActive() {
  const tab = activeTabId ? tabs.get(activeTabId) : undefined;
  if (!tab) {
    return;
  }
  await saveTab(tab);
}

async function saveActiveAs() {
  const tab = activeTabId ? tabs.get(activeTabId) : undefined;
  if (!tab) {
    return;
  }
  await saveTab(tab, { saveAs: true });
}

function setActiveLanguage(languageId: string) {
  const tab = activeTabId ? tabs.get(activeTabId) : undefined;
  if (!tab) {
    return;
  }
  tab.languageId = languageId;
  monaco.editor.setModelLanguage(tab.model, languageId);
  if (!isMarkdownLanguage(languageId) && tab.mdPreview) {
    tab.mdPreview = false;
  }
  applyMdPreview(tab);
  layoutEditor();
  syncLanguageSelect();
  syncMdPreviewButton();
  updateStatusForActive();
  schedulePersistSession();
}

async function restoreSession(): Promise<boolean> {
  let session: SessionDto;
  try {
    session = await invoke<SessionDto>("load_session");
  } catch (err) {
    console.warn("failed to load session", err);
    return false;
  }
  if (!session.tabs?.length) {
    return false;
  }

  restoringSession = true;
  try {
    const pending = session.tabs.filter((item) => item.path || item.content);
    const loaded = await Promise.all(
      pending.map(async (item) => {
        let content = item.content;
        let encoding = item.encoding ?? undefined;
        let bytes: Uint8Array | undefined;
        let diskSize = item.diskSize ?? undefined;
        let diskLoaded = item.diskLoaded ?? undefined;
        if (!item.dirty && item.path) {
          try {
            const file = await Promise.race([
              loadFilePrefix(item.path),
              new Promise<never>((_, reject) => {
                setTimeout(() => reject(new Error("timeout")), 4000);
              }),
            ]);
            content = file.text;
            encoding = file.encoding;
            bytes = file.bytes;
            diskSize = file.diskSize;
            diskLoaded = file.diskLoaded;
          } catch {
            content = item.content;
          }
        }
        return { item, content, encoding, bytes, diskSize, diskLoaded };
      }),
    );

    const stampTabs: TabState[] = [];
    for (const row of loaded) {
      const tab = createTab({
        id: row.item.id,
        title: row.item.title,
        path: row.item.path,
        untitledNumber: row.item.path ? null : parseUntitledNumber(row.item.title),
        languageId: row.item.languageId || PLAINTEXT,
        encoding: row.encoding,
        content: row.content,
        dirty: row.item.dirty,
        viewState: row.item.viewState,
        activate: false,
        bytes: row.bytes,
        diskSize: row.diskSize,
        diskLoaded: row.diskLoaded,
        viewMode: row.item.viewMode === "hex" ? "hex" : "text",
        mdPreview: row.item.mdPreview === true,
      });
      if (row.item.path) {
        if (
          row.item.dirty &&
          row.item.lastDiskMtimeMs != null &&
          row.item.lastDiskSize != null
        ) {
          tab.diskStamp = {
            mtimeMs: row.item.lastDiskMtimeMs,
            size: row.item.lastDiskSize,
          };
        } else {
          stampTabs.push(tab);
        }
      }
    }
    await Promise.all(stampTabs.map((tab) => stampTabFromDisk(tab)));
    const active =
      (session.activeId && tabs.has(session.activeId) && session.activeId) ||
      [...tabs.keys()][0];
    if (active) {
      activateTab(active);
    }
  } finally {
    restoringSession = false;
  }
  return tabs.size > 0;
}

async function bindSessionFlush() {
  const win = getCurrentWindow();
  await win.onCloseRequested(async () => {
    if (sessionFlushing) {
      return;
    }
    sessionFlushing = true;
    windowFocused = false;
    if (persistTimer !== undefined) {
      clearTimeout(persistTimer);
      persistTimer = undefined;
    }
    await Promise.race([
      persistSession().catch((err) => {
        console.warn("failed to persist session on close", err);
      }),
      new Promise<void>((resolve) => {
        setTimeout(resolve, 800);
      }),
    ]);
  });
}

function bindUi() {
  document.querySelector("#btn-new")!.addEventListener("click", () => createTab());
  document.querySelector("#btn-open")!.addEventListener("click", () => void openFile());
  document.querySelector("#btn-save")!.addEventListener("click", () => {
    setSaveMenuOpen(false);
    void saveActive();
  });
  saveMenuButton.innerHTML = `<svg viewBox="0 0 8 6" aria-hidden="true"><path fill="currentColor" d="M0 0h8L4 6z"/></svg>`;
  saveMenuButton.addEventListener("click", (ev) => {
    ev.stopPropagation();
    setSaveMenuOpen(saveMenu.hidden);
  });
  saveMenu.addEventListener("click", (ev) => {
    ev.stopPropagation();
    const item = (ev.target as HTMLElement).closest("#btn-save-as");
    if (!item) {
      return;
    }
    setSaveMenuOpen(false);
    void saveActiveAs();
  });
  document.querySelector("#btn-find")!.addEventListener("click", () => {
    openFind();
  });
  hexButton.addEventListener("click", () => void toggleHexView());
  wrapButton.innerHTML = wrapButtonIcon();
  wrapButton.addEventListener("click", () => toggleWordWrap());
  mdButton.addEventListener("click", () => void toggleMdPreview());
  syntaxButton.addEventListener("click", (ev) => {
    ev.stopPropagation();
    setSyntaxMenuOpen(syntaxMenu.hidden);
  });
  syntaxMenu.addEventListener("click", (ev) => {
    ev.stopPropagation();
    const add = (ev.target as HTMLElement).closest<HTMLButtonElement>("[data-action='add-language']");
    if (add) {
      setSyntaxMenuOpen(false);
      void openAddLanguageDialog();
      return;
    }
    const item = (ev.target as HTMLElement).closest<HTMLButtonElement>("[data-language-id]");
    if (!item?.dataset.languageId) {
      return;
    }
    setSyntaxMenuOpen(false);
    setActiveLanguage(item.dataset.languageId);
  });
  localeButton.addEventListener("click", (ev) => {
    ev.stopPropagation();
    setLocaleMenuOpen(localeMenu.hidden);
  });
  localeMenu.addEventListener("click", (ev) => {
    ev.stopPropagation();
    const item = (ev.target as HTMLElement).closest<HTMLButtonElement>("[data-locale-id]");
    if (!item?.dataset.localeId) {
      return;
    }
    const id = item.dataset.localeId;
    setLocaleMenuOpen(false);
    if (id === currentLocaleId) {
      return;
    }
    void (async () => {
      const loaded = await loadLocale(id);
      fillLocaleMenu(uiLocales, loaded.id);
      await invoke("update_settings", { locale: loaded.id }).catch((err) => {
        console.warn("failed to save locale", err);
      });
      fillLanguageMenu();
      syncLanguageSelect();
      retitleUntitledTabs();
      renderTabs();
      updateStatusForActive();
      syncThemeButton();
      applyDomI18n();
      syncLocaleButton();
      fillHexLabels();
      syncHexButton();
      syncFindLocale();
    })();
  });
  statusEolEl.addEventListener("click", (ev) => {
    ev.stopPropagation();
    if (!activeTabId || !tabs.has(activeTabId)) {
      return;
    }
    setLocaleMenuOpen(false);
    setSyntaxMenuOpen(false);
    setSaveMenuOpen(false);
    setEncodingMenuOpen(false);
    toggleActiveEol();
  });
  statusEolEl.addEventListener("keydown", (ev) => {
    if (ev.key !== "Enter" && ev.key !== " ") {
      return;
    }
    ev.preventDefault();
    statusEolEl.click();
  });
  statusEncodingEl.addEventListener("click", (ev) => {
    ev.stopPropagation();
    if (!activeTabId || !tabs.has(activeTabId)) {
      return;
    }
    setEncodingMenuOpen(encodingMenu.hidden);
  });
  statusEncodingEl.addEventListener("keydown", (ev) => {
    if (ev.key !== "Enter" && ev.key !== " ") {
      return;
    }
    ev.preventDefault();
    statusEncodingEl.click();
  });
  encodingMenu.addEventListener("click", (ev) => {
    ev.stopPropagation();
    const item = (ev.target as HTMLElement).closest<HTMLButtonElement>("[data-encoding-id]");
    const encoding = item?.dataset.encodingId
      ? normalizeEncoding(item.dataset.encodingId)
      : null;
    const action = item?.dataset.encodingAction;
    if (!encoding || (action !== "use" && action !== "convert")) {
      return;
    }
    const tab = activeTabId ? tabs.get(activeTabId) : undefined;
    setEncodingMenuOpen(false);
    if (!tab) {
      return;
    }
    if (action === "use") {
      void useTabEncoding(tab, encoding);
    } else {
      void convertTabEncoding(tab, encoding);
    }
  });
  document.addEventListener("click", () => {
    setLocaleMenuOpen(false);
    setSyntaxMenuOpen(false);
    setSaveMenuOpen(false);
    setEncodingMenuOpen(false);
  });
  window.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") {
      setLocaleMenuOpen(false);
      setSyntaxMenuOpen(false);
      setSaveMenuOpen(false);
      setEncodingMenuOpen(false);
    }
  });
  themeButton.addEventListener("click", () => {
    const next: ThemeId = currentTheme === "dark" ? "light" : "dark";
    applyTheme(next);
    void invoke("update_settings", { theme: next }).catch((err) => {
      console.warn("failed to save theme", err);
    });
  });
  try {
    bindAddLanguageDialog({
      getMonaco: () => monaco,
      getPlugins: () => plugins,
      onInstalled: () => {
        fillLanguageMenu();
        syncLanguageSelect();
      },
    });
  } catch (err) {
    console.warn("failed to bind add-language dialog", err);
  }

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
      if (ev.shiftKey) {
        void saveActiveAs();
      } else {
        void saveActive();
      }
    }
  });
}

async function loadAndRegisterGrammars() {
  try {
    const grammars = await invoke<Record<string, string>>("load_language_grammars");
    for (const plugin of plugins) {
      const json = grammars[plugin.id];
      if (json) {
        plugin.grammarJson = json;
      }
    }
    await registerTextMateLanguages(monaco, plugins, { resetRegistry: true });
    const tab = activeTabId ? tabs.get(activeTabId) : undefined;
    if (tab && editor) {
      monaco.editor.setModelLanguage(tab.model, tab.languageId);
    }
  } catch (err) {
    console.warn("failed to register language grammars", err);
  }
}

async function main() {
  applyToolbarIcons();
  const settingsPromise = invoke<AppSettings>("get_settings");
  const localesPromise = listLocales();
  const pluginsPromise = invoke<LanguagePluginDto[]>("list_language_plugins");

  const settings = await settingsPromise;
  const locales = await localesPromise;
  const locale = await loadLocale(settings.locale || "en");
  fillLocaleMenu(locales, locale.id);
  mdSplitRatio = clampMdSplit(settings.mdSplit ?? MD_SPLIT_DEFAULT);
  applyTheme(settings.theme === "light" ? "light" : "dark");
  applyDomI18n();
  bindTooltips();
  syncLocaleButton();
  wrapButton.innerHTML = wrapButtonIcon();
  applyMdSplitRatio(editorHost, mdSplitRatio);
  bindMdGutter({
    host: editorHost,
    gutter: mdGutter,
    getRatio: () => mdSplitRatio,
    setRatio: (ratio) => {
      mdSplitRatio = ratio;
    },
    onLayout: layoutEditor,
    onCommit: (ratio) => {
      void invoke("update_settings", { mdSplit: ratio }).catch((err) => {
        console.warn("failed to save split ratio", err);
      });
    },
  });
  syncMdScrollFromEditor = bindMdScrollSync({
    getEditor: () => editor,
    preview: mdHost,
    isActive: () => {
      const tab = activeTabId ? tabs.get(activeTabId) : undefined;
      return !!tab && tabShowsMdPreview(tab);
    },
  }).fromEditor;
  syncHexButton();

  plugins = await pluginsPromise;
  registerLanguageIds(monaco, plugins);
  defineEditorThemes(monaco);
  fillLanguageMenu();
  syncLanguageSelect();

  editor = monaco.editor.create(monacoHost, {
    value: "",
    language: PLAINTEXT,
    theme: monacoThemeName(currentTheme),
    automaticLayout: false,
    fontSize: 14,
    fontFamily: "Cascadia Code, Consolas, 'Courier New', monospace",
    minimap: { enabled: false },
    wordWrap: "off",
    find: {
      seedSearchStringFromSelection: "never",
      addExtraSpaceOnTop: false,
    },
  });
  bindFindWidget({
    getEditor: () => editor,
    isHexView: () => {
      const tab = activeTabId ? tabs.get(activeTabId) : undefined;
      return tab?.viewMode === "hex";
    },
    onLayout: layoutEditor,
  });
  hexEditor = new HexEditor(hexHost, {
    onChange(kind) {
      const tab = activeTabId ? tabs.get(activeTabId) : undefined;
      if (!tab || tab.viewMode !== "hex") {
        return;
      }
      if (kind === "edit") {
        tab.bytes = hexEditor?.getBytes() ?? tab.bytes;
        tab.textStale = true;
        tab.bytesStale = false;
        if (!tab.dirty) {
          tab.dirty = true;
          renderTabs();
        }
        schedulePersistSession();
      }
      updateStatusBar();
    },
    onNeedMore() {
      const tab = activeTabId ? tabs.get(activeTabId) : undefined;
      if (tab) {
        void loadMoreForTab(tab);
      }
    },
  });
  fillHexLabels();
  layoutEditor();
  editor.onDidChangeCursorPosition(() => updateStatusBar());
  editor.onDidScrollChange(() => {
    syncMdScrollFromEditor?.();
    const tab = activeTabId ? tabs.get(activeTabId) : undefined;
    if (!tab || tab.viewMode === "hex" || tab.dirty || !editor) {
      return;
    }
    const visible = editor.getLayoutInfo().height;
    if (editor.getScrollTop() + visible > editor.getScrollHeight() - 240) {
      void loadMoreForTab(tab);
    }
  });
  new ResizeObserver(layoutEditor).observe(editorHost);
  window.addEventListener("resize", layoutEditor);
  bindWebviewZoom({ onZoom: layoutEditor });

  bindUi();
  bindWindowStateSave();
  await bindSessionFlush();

  const restored = await restoreSession();
  if (!restored) {
    createTab();
  }
  updateStatusForActive();
  layoutEditor();

  void loadAndRegisterGrammars();

  try {
    await bindFileDrop();
  } catch (err) {
    console.warn("failed to bind file drop", err);
  }
  try {
    await bindFileWatch();
  } catch (err) {
    console.warn("failed to bind file watch", err);
  }
}

main().catch((err) => {
  console.error(err);
});
