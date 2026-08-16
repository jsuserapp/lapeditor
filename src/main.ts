import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import * as monaco from "monaco-editor/editor/editor.api.js";
import editorWorkerUrl from "monaco-editor/editor/editor.worker.js?url";
import "monaco-editor/editor/contrib/folding/browser/folding.js";
import "monaco-editor/editor/contrib/contextmenu/browser/contextmenu.js";
import "monaco-editor/editor/contrib/clipboard/browser/clipboard.js";
import { isIMenuItem, MenuId, MenuRegistry } from "monaco-editor/platform/actions/common/actions.js";
import { CommandsRegistry } from "monaco-editor/platform/commands/common/commands.js";
import { ContextKeyExpr } from "monaco-editor/platform/contextkey/common/contextkey.js";
import "monaco-editor/min/vs/editor/editor.main.css";
import { applyDomI18n, listLocales, loadLocale, t } from "./i18n";
import { bindAddLanguageDialog, openAddLanguageDialog } from "./add-language";
import { bindConfirmDialog, confirmDialog } from "./confirm";
import { bindNameDialog } from "./name-dialog";
import { bindTitlebar, syncTitlebarLocale } from "./titlebar";
import {
  formatText,
  languageHasFormatter,
  loadFormatterConfig,
  monacoIndentOptions,
  normalizeIndent,
  type FormatIndent,
  type FormatterCommandInfo,
} from "./format";
import { bindFormatDialogs, openFormatOptionsDialog } from "./format-ui";
import { bindFindWidget, closeFind, openFind, refreshFind, syncFindLocale } from "./find";
import { addFileIcon, applyToolbarIcons, copyIcon, cutIcon, pasteIcon } from "./icons";
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
import { bindExplorer, type ExplorerApi } from "./explorer";
import { bindSearch, type SearchApi, type SearchExcludeSettings, type SearchHit } from "./search";
import {
  bindSettings,
  DEFAULT_FONT_FAMILY,
  DEFAULT_FONT_SIZE,
  type SettingsApi,
} from "./settings";
import { emptyHexHistory, HexEditor, type HexHistory } from "./hex";
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
  savedVersionId: number;
  diskStamp: DiskStamp | null;
  ignoredStamp: DiskStamp | null;
  viewMode: ViewMode;
  bytes: Uint8Array;
  diskSize: number;
  diskLoaded: number;
  bytesStale: boolean;
  textStale: boolean;
  byteMarkIds: string[];
  mdView: MdView;
  hexHistory: HexHistory;
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
  mdView?: string | null;
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
  explorerOpen?: boolean;
  explorerWidth?: number;
  workspaceFolder?: string | null;
  fontFamily?: string;
  fontSize?: number;
  searchExclude?: SearchExcludeSettings | null;
};

const PLAINTEXT = "plaintext";

type MdView = "off" | "split" | "reader";

function isMarkdownLanguage(languageId: string | undefined): boolean {
  return languageId === "markdown";
}

function parseMdView(value: string | boolean | null | undefined): MdView {
  if (value === "split" || value === "reader") {
    return value;
  }
  return value === true ? "split" : "off";
}

type MdPreview = {
  render(source: string, immediate?: boolean): void;
  setTheme(theme: ThemeId): void;
};

const tabBar = document.querySelector<HTMLDivElement>("#tab-bar")!;
const syntaxButton = document.querySelector<HTMLButtonElement>("#btn-syntax")!;
const syntaxLabel = document.querySelector<HTMLSpanElement>("#syntax-label")!;
const syntaxMenu = document.querySelector<HTMLDivElement>("#syntax-menu")!;
const saveButton = document.querySelector<HTMLButtonElement>("#btn-save")!;
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
const pasteButton = document.querySelector<HTMLButtonElement>("#btn-paste")!;
const copyButton = document.querySelector<HTMLButtonElement>("#btn-copy")!;
const cutButton = document.querySelector<HTMLButtonElement>("#btn-cut")!;
const undoButton = document.querySelector<HTMLButtonElement>("#btn-undo")!;
const redoButton = document.querySelector<HTMLButtonElement>("#btn-redo")!;
const formatButton = document.querySelector<HTMLButtonElement>("#btn-format")!;
const formatOptionsButton = document.querySelector<HTMLButtonElement>("#btn-format-options")!;
const mdHost = document.querySelector<HTMLDivElement>("#md-host")!;
const mdGutter = document.querySelector<HTMLDivElement>("#md-gutter")!;
const mdButton = document.querySelector<HTMLButtonElement>("#btn-md")!;
const readButton = document.querySelector<HTMLButtonElement>("#btn-read")!;

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
let explorer: ExplorerApi | undefined;
let searchUi: SearchApi | undefined;
let settingsUi: SettingsApi | undefined;
let formatIndent: FormatIndent = "2";
let formatterCommands: FormatterCommandInfo[] = [];
let canFormatKey: monaco.editor.IContextKey<boolean> | undefined;
let hasSelectionKey: monaco.editor.IContextKey<boolean> | undefined;
let canPasteKey: monaco.editor.IContextKey<boolean> | undefined;
let editorContextMenu: monaco.IDisposable | undefined;
let clipboardMenuPatched = false;
let contextMenuIconObserver: MutationObserver | undefined;
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
      mdPreview: tab.mdView !== "off",
      mdView: tab.mdView === "off" ? null : tab.mdView,
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
  syncFormatButton();
  syncEditActions();
}

function syncSaveButton() {
  const tab = activeTabId ? tabs.get(activeTabId) : undefined;
  saveButton.disabled = !tab?.dirty;
}

function syncEditActions() {
  const tab = activeTabId ? tabs.get(activeTabId) : undefined;
  const hexReady = !!tab && tab.viewMode === "hex" && !!hexEditor;
  const textReady = !!tab && tab.viewMode !== "hex" && !!editor;
  const model = tab?.model;
  const selection = editor?.getSelection();
  const hasSelection = textReady && !!selection && !selection.isEmpty();
  const canPaste = textReady;
  pasteButton.disabled = !canPaste;
  copyButton.disabled = !hasSelection;
  cutButton.disabled = !hasSelection;
  hasSelectionKey?.set(hasSelection);
  canPasteKey?.set(canPaste);
  undoButton.disabled = hexReady ? !hexEditor?.canUndo() : !textReady || !model?.canUndo();
  redoButton.disabled = hexReady ? !hexEditor?.canRedo() : !textReady || !model?.canRedo();
  const pasteLabel = t("toolbar.pasteTitle");
  const copyLabel = t("toolbar.copyTitle");
  const cutLabel = t("toolbar.cutTitle");
  const undoLabel = t("toolbar.undoTitle");
  const redoLabel = t("toolbar.redoTitle");
  setTooltip(pasteButton, pasteLabel);
  setTooltip(copyButton, copyLabel);
  setTooltip(cutButton, cutLabel);
  setTooltip(undoButton, undoLabel);
  setTooltip(redoButton, redoLabel);
  pasteButton.setAttribute("aria-label", pasteLabel);
  copyButton.setAttribute("aria-label", copyLabel);
  cutButton.setAttribute("aria-label", cutLabel);
  undoButton.setAttribute("aria-label", undoLabel);
  redoButton.setAttribute("aria-label", redoLabel);
}

function selectedEditorText(): string | undefined {
  if (!editor) {
    return undefined;
  }
  const selection = editor.getSelection();
  if (!selection || selection.isEmpty()) {
    return undefined;
  }
  return editor.getModel()?.getValueInRange(selection);
}

async function writeClipboardText(text: string) {
  await invoke("write_clipboard", { text });
}

async function readClipboardText(): Promise<string> {
  try {
    return await invoke<string>("read_clipboard");
  } catch {
    return "";
  }
}

async function runCopy() {
  const text = selectedEditorText();
  if (text == null) {
    return;
  }
  editor?.focus();
  await writeClipboardText(text);
}

async function runCut() {
  const text = selectedEditorText();
  if (text == null || !editor) {
    return;
  }
  const selection = editor.getSelection();
  editor.focus();
  await writeClipboardText(text);
  if (selection) {
    editor.executeEdits("cut", [{ range: selection, text: "" }]);
  }
}

async function runPaste() {
  if (!editor) {
    return;
  }
  editor.focus();
  const text = await readClipboardText();
  if (!text) {
    return;
  }
  editor.trigger("keyboard", "paste", {
    text,
    pasteOnNewLine: false,
    multicursorText: null,
    mode: null,
  });
}

function triggerEditAction(handlerId: string) {
  const tab = activeTabId ? tabs.get(activeTabId) : undefined;
  if (!tab) {
    return;
  }
  if (tab.viewMode === "hex") {
    if (handlerId === "undo") {
      hexEditor?.undo();
    } else if (handlerId === "redo") {
      hexEditor?.redo();
    }
    return;
  }
  if (!editor) {
    return;
  }
  if (handlerId === "editor.action.clipboardPasteAction") {
    void runPaste();
    return;
  }
  if (handlerId === "editor.action.clipboardCopyAction") {
    void runCopy();
    return;
  }
  if (handlerId === "editor.action.clipboardCutAction") {
    void runCut();
    return;
  }
  editor.focus();
  editor.trigger("toolbar", handlerId, null);
}

function markTabClean(tab: TabState) {
  tab.savedVersionId = tab.model.getAlternativeVersionId();
  if (tab.dirty) {
    tab.dirty = false;
    renderTabs();
  }
}

function forceTabDirty(tab: TabState) {
  tab.savedVersionId = -1;
  if (!tab.dirty) {
    tab.dirty = true;
    renderTabs();
  }
}

function syncTabDirtyFromModel(tab: TabState) {
  const dirty = tab.model.getAlternativeVersionId() !== tab.savedVersionId;
  if (tab.dirty === dirty) {
    return;
  }
  tab.dirty = dirty;
  renderTabs();
  updateStatusForActive();
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

function tabMdView(tab: TabState): MdView {
  if (!isMarkdownLanguage(tab.languageId) || tab.viewMode === "hex") {
    return "off";
  }
  return tab.mdView;
}

function tabShowsMdPreview(tab: TabState): boolean {
  return tabMdView(tab) !== "off";
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
  const view = tab ? tabMdView(tab) : "off";
  const split = view === "split";
  const reader = view === "reader";
  editorHost.classList.toggle("md-split", split);
  editorHost.classList.toggle("md-reader", reader);
  mdHost.hidden = view === "off";
  mdGutter.hidden = !split;
  if (tab?.viewMode !== "hex") {
    monacoHost.hidden = reader;
  }
  if (view !== "off" && tab) {
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

function syncMdViewButton(
  button: HTMLButtonElement,
  on: boolean,
  disabled: boolean,
  onKey: string,
  offKey: string,
) {
  button.classList.toggle("active", on);
  button.setAttribute("aria-pressed", on ? "true" : "false");
  button.disabled = disabled;
  const label = on ? t(onKey) : t(offKey);
  setTooltip(button, label);
  button.setAttribute("aria-label", label);
}

function syncMdPreviewButton() {
  const tab = activeTabId ? tabs.get(activeTabId) : undefined;
  const markdown = isMarkdownLanguage(tab?.languageId);
  const view = tab && markdown ? tabMdView(tab) : "off";
  const disabled = !tab || !markdown;
  syncMdViewButton(mdButton, view === "split", disabled, "toolbar.mdOn", "toolbar.mdOff");
  syncMdViewButton(readButton, view === "reader", disabled, "toolbar.readOn", "toolbar.readOff");
}

async function setMdView(next: Exclude<MdView, "off">) {
  const tab = activeTabId ? tabs.get(activeTabId) : undefined;
  if (!tab || !isMarkdownLanguage(tab.languageId)) {
    return;
  }
  tab.mdView = tab.mdView === next ? "off" : next;
  if (tab.mdView !== "off" && tab.viewMode === "hex") {
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

function applyHexBuffer(tab: TabState, keepCaret = true) {
  hexEditor?.setBytes(tab.bytes, Math.max(tab.diskSize, tab.bytes.length), keepCaret);
  hexEditor?.setHistory(tab.hexHistory);
}

function captureHexState(tab: TabState) {
  if (!hexEditor) {
    return;
  }
  tab.bytes = hexEditor.getBytes();
  tab.hexHistory = hexEditor.getHistory();
}

async function showTabView(tab: TabState) {
  if (tab.viewMode === "hex") {
    await syncBytesFromText(tab);
    monacoHost.hidden = true;
    hexHost.hidden = false;
    applyHexBuffer(tab);
    fillHexLabels();
    hexEditor?.focus();
    closeFind();
  } else {
    if (tab.textStale && hexEditor) {
      captureHexState(tab);
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
      applyHexBuffer(tab);
    } else {
      const text = await decodeBytes(tab.bytes, tab.encoding);
      await applyModelText(tab, text, "clean");
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
    tab.hexHistory = emptyHexHistory();
  } catch {
    forceTabDirty(tab);
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
    markTabClean(tab);
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
      forceTabDirty(tab);
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
      reload =
        (await confirmDialog({
          title: t("dialog.fileChangedTitle"),
          message: t("dialog.fileChanged", { name: tab.title }),
          kind: "warning",
          buttons: [
            { id: "reload", label: t("dialog.loadFromDisk"), role: "primary" },
            { id: "keep", label: t("dialog.keepEdits") },
          ],
          defaultId: "reload",
          cancelId: "keep",
        })) === "reload";
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
  const sep = document.createElement("div");
  sep.className = "popover-sep";
  sep.setAttribute("role", "separator");
  const add = document.createElement("button");
  add.type = "button";
  add.className = "popover-item";
  add.role = "menuitem";
  add.dataset.action = "add-language";
  add.textContent = t("lang.add");
  syntaxMenu.append(sep, add);
}

function canFormatActive() {
  const tab = activeTabId ? tabs.get(activeTabId) : undefined;
  if (!tab || tab.viewMode === "hex") {
    return false;
  }
  return languageHasFormatter(tab.languageId, formatterCommands);
}

function syncFormatButton() {
  const enabled = canFormatActive();
  formatButton.disabled = !enabled;
  canFormatKey?.set(enabled);
  setTooltip(formatButton, t("toolbar.formatTitle"));
  setTooltip(formatOptionsButton, t("toolbar.formatOptionsTitle"));
}

function decorateContextMenuIcons(root: ParentNode) {
  const icons = [
    { label: t("editor.context.cut"), src: cutIcon },
    { label: t("editor.context.copy"), src: copyIcon },
    { label: t("editor.context.paste"), src: pasteIcon },
  ];
  for (const label of root.querySelectorAll<HTMLElement>(".monaco-menu .action-label")) {
    const name = label.getAttribute("aria-label") ?? label.textContent?.trim() ?? "";
    const icon = icons.find((item) => item.label === name);
    if (!icon || label.querySelector(".lap-menu-icon")) {
      continue;
    }
    const img = document.createElement("img");
    img.className = "lap-menu-icon";
    img.src = icon.src;
    img.alt = "";
    label.prepend(img);
  }
}

function bindContextMenuIcons() {
  if (contextMenuIconObserver) {
    return;
  }
  contextMenuIconObserver = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (!(node instanceof HTMLElement)) {
          continue;
        }
        if (node.matches(".monaco-menu, .context-view, .monaco-menu-container")) {
          decorateContextMenuIcons(node);
          continue;
        }
        const menu = node.querySelector(".monaco-menu");
        if (menu) {
          decorateContextMenuIcons(menu);
        }
      }
    }
  });
  contextMenuIconObserver.observe(document.body, { childList: true, subtree: true });
}

function hideDefaultClipboardMenuItems() {
  if (clipboardMenuPatched) {
    return;
  }
  clipboardMenuPatched = true;
  const original = MenuRegistry.getMenuItems.bind(MenuRegistry);
  MenuRegistry.getMenuItems = (id: unknown) => {
    const items = original(id);
    if (id !== MenuId.EditorContext) {
      return items;
    }
    return items.filter((item: unknown) => {
      if (isIMenuItem(item) && !item.command.icon) {
        const commandId = item.command.id;
        if (
          commandId === "editor.action.clipboardCutAction" ||
          commandId === "editor.action.clipboardCopyAction" ||
          commandId === "editor.action.clipboardPasteAction"
        ) {
          return false;
        }
      }
      if (item && typeof item === "object" && "submenu" in item) {
        const submenu = (item as { submenu?: unknown }).submenu;
        if (submenu === MenuId.EditorContextCopy || submenu === MenuId.EditorContextShare) {
          return false;
        }
      }
      return true;
    });
  };
}

function registerEditorContextMenu() {
  if (!editor) {
    return;
  }
  hideDefaultClipboardMenuItems();
  bindContextMenuIcons();
  editorContextMenu?.dispose();
  canFormatKey = editor.createContextKey("lapeditor.canFormat", canFormatActive());
  hasSelectionKey = editor.createContextKey("lapeditor.hasSelection", false);
  canPasteKey = editor.createContextKey("lapeditor.canPaste", false);
  syncEditActions();

  const store: monaco.IDisposable[] = [];
  const clipboardItems = [
    {
      id: "lapeditor.cut",
      key: "editor.context.cut",
      icon: "lap-cut",
      order: 1,
      precondition: ContextKeyExpr.has("lapeditor.hasSelection"),
      run: () => void runCut(),
    },
    {
      id: "lapeditor.copy",
      key: "editor.context.copy",
      icon: "lap-copy",
      order: 2,
      precondition: ContextKeyExpr.has("lapeditor.hasSelection"),
      run: () => void runCopy(),
    },
    {
      id: "lapeditor.paste",
      key: "editor.context.paste",
      icon: "lap-paste",
      order: 3,
      precondition: ContextKeyExpr.has("lapeditor.canPaste"),
      run: () => void runPaste(),
    },
  ];
  for (const item of clipboardItems) {
    store.push(CommandsRegistry.registerCommand(item.id, item.run));
    store.push(
      MenuRegistry.appendMenuItem(MenuId.EditorContext, {
        command: {
          id: item.id,
          title: t(item.key),
          icon: { id: item.icon },
          precondition: item.precondition,
        },
        group: "9_cutcopypaste",
        order: item.order,
      }),
    );
  }

  store.push(
    CommandsRegistry.registerCommand("lapeditor.format", () => {
      void formatActive();
    }),
  );
  store.push(
    MenuRegistry.appendMenuItem(MenuId.EditorContext, {
      command: {
        id: "lapeditor.format",
        title: t("editor.context.format"),
        precondition: ContextKeyExpr.has("lapeditor.canFormat"),
      },
      group: "a_format",
      order: 1,
    }),
  );

  const foldingItems = [
    { id: "lapeditor.fold", key: "editor.context.fold", command: "editor.fold", order: 1 },
    { id: "lapeditor.foldAll", key: "editor.context.foldAll", command: "editor.foldAll", order: 2 },
    { id: "lapeditor.unfoldAll", key: "editor.context.unfoldAll", command: "editor.unfoldAll", order: 3 },
  ];
  for (const item of foldingItems) {
    store.push(
      editor.addAction({
        id: item.id,
        label: t(item.key),
        contextMenuGroupId: "b_folding",
        contextMenuOrder: item.order,
        run: (ed) => {
          ed.trigger("contextmenu", item.command, null);
        },
      }),
    );
  }

  editorContextMenu = {
    dispose() {
      for (const item of store) {
        item.dispose();
      }
    },
  };
}

async function refreshFormatterCommands() {
  try {
    const formatConfig = await loadFormatterConfig();
    formatterCommands = formatConfig.commands;
    syncFormatButton();
  } catch (err) {
    console.warn("failed to load formatter config", err);
  }
}

function applyFormatIndent(indent: FormatIndent) {
  formatIndent = indent;
  editor?.updateOptions(monacoIndentOptions(indent));
}

async function formatActive() {
  const tab = activeTabId ? tabs.get(activeTabId) : undefined;
  if (!tab || !editor || tab.viewMode === "hex") {
    return;
  }
  if (!canFormatActive()) {
    await confirmDialog({
      title: t("format.document"),
      message: t("format.unsupported", { language: languageLabel(tab.languageId) }),
      kind: "info",
      buttons: [{ id: "ok", label: t("dialog.ok"), role: "primary" }],
      defaultId: "ok",
      cancelId: "ok",
    });
    return;
  }
  try {
    const current = tab.model.getValue();
    const formatted = await formatText(tab.languageId, current, { indent: formatIndent });
    if (formatted === current) {
      return;
    }
    editor.executeEdits("format", [
      {
        range: tab.model.getFullModelRange(),
        text: formatted,
      },
    ]);
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    const text = /no formatter/i.test(raw)
      ? t("format.unsupported", { language: languageLabel(tab.languageId) })
      : t("format.failed", { error: raw.replace(/^(Error:\s*)+/i, "") });
    await confirmDialog({
      title: t("format.document"),
      message: text,
      kind: "error",
      buttons: [{ id: "ok", label: t("dialog.ok"), role: "primary" }],
      defaultId: "ok",
      cancelId: "ok",
    });
  }
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

async function applyModelText(
  tab: TabState,
  content: string,
  version: "clean" | "preserve" | "dirty" = "preserve",
) {
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
  if (version === "clean") {
    markTabClean(tab);
  } else if (version === "dirty") {
    forceTabDirty(tab);
  } else if (tab.dirty) {
    tab.savedVersionId = -1;
  } else {
    tab.savedVersionId = tab.model.getAlternativeVersionId();
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
    tab.hexHistory = emptyHexHistory();
    const text = await decodeBytes(tab.bytes, encoding);
    await applyModelText(tab, text, "dirty");
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
  const light = currentTheme === "light";
  themeButton.innerHTML = themeButtonIcon();
  themeButton.classList.toggle("active", light);
  themeButton.setAttribute("aria-pressed", light ? "true" : "false");
  const label = t("theme.light");
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

function relativeToWorkspace(path: string, workspace: string | null): string | null {
  if (!workspace) {
    return null;
  }
  const normPath = path.replace(/\\/g, "/");
  const normRoot = workspace.replace(/\\/g, "/").replace(/\/+$/, "");
  if (normPath.toLowerCase() === normRoot.toLowerCase()) {
    return basename(path);
  }
  if (normPath.toLowerCase().startsWith(normRoot.toLowerCase() + "/")) {
    return normPath.slice(normRoot.length + 1).replace(/\//g, path.includes("\\") ? "\\" : "/");
  }
  return null;
}

const tabContextMenu = document.querySelector<HTMLDivElement>("#tab-context-menu")!;
const tabCtxFullPath = document.querySelector<HTMLButtonElement>("#tab-ctx-full-path")!;
const tabCtxRelPath = document.querySelector<HTMLButtonElement>("#tab-ctx-rel-path")!;
const tabCtxFileName = document.querySelector<HTMLButtonElement>("#tab-ctx-file-name")!;
const tabCtxClose = document.querySelector<HTMLButtonElement>("#tab-ctx-close")!;
let tabContextTabId: string | null = null;

function hideTabContextMenu() {
  tabContextMenu.hidden = true;
  tabContextTabId = null;
}

function showTabContextMenu(tab: TabState, clientX: number, clientY: number) {
  tabContextTabId = tab.id;
  const hasPath = !!tab.path;
  const rel = hasPath ? relativeToWorkspace(tab.path!, explorer?.getWorkspace() ?? null) : null;
  tabCtxFullPath.disabled = !hasPath;
  tabCtxRelPath.disabled = !rel;
  tabCtxFileName.disabled = !hasPath;
  tabCtxClose.disabled = false;

  tabContextMenu.hidden = false;
  const pad = 8;
  const rect = tabContextMenu.getBoundingClientRect();
  const left = Math.min(clientX, window.innerWidth - rect.width - pad);
  const top = Math.min(clientY, window.innerHeight - rect.height - pad);
  tabContextMenu.style.left = `${Math.max(pad, left)}px`;
  tabContextMenu.style.top = `${Math.max(pad, top)}px`;
}

function bindTabContextMenu() {
  tabCtxFullPath.addEventListener("click", () => {
    const tab = tabContextTabId ? tabs.get(tabContextTabId) : undefined;
    hideTabContextMenu();
    if (tab?.path) {
      void writeClipboardText(tab.path);
    }
  });
  tabCtxRelPath.addEventListener("click", () => {
    const tab = tabContextTabId ? tabs.get(tabContextTabId) : undefined;
    hideTabContextMenu();
    if (!tab?.path) {
      return;
    }
    const rel = relativeToWorkspace(tab.path, explorer?.getWorkspace() ?? null);
    if (rel) {
      void writeClipboardText(rel);
    }
  });
  tabCtxFileName.addEventListener("click", () => {
    const tab = tabContextTabId ? tabs.get(tabContextTabId) : undefined;
    hideTabContextMenu();
    if (tab?.path) {
      void writeClipboardText(basename(tab.path));
    }
  });
  tabCtxClose.addEventListener("click", () => {
    const id = tabContextTabId;
    hideTabContextMenu();
    if (id) {
      void closeTab(id);
    }
  });
  document.addEventListener("pointerdown", (ev) => {
    if (tabContextMenu.hidden) {
      return;
    }
    const target = ev.target;
    if (target instanceof Node && tabContextMenu.contains(target)) {
      return;
    }
    hideTabContextMenu();
  });
  window.addEventListener("blur", () => hideTabContextMenu());
  window.addEventListener("resize", () => hideTabContextMenu());
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
    el.addEventListener("contextmenu", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      activateTab(tab.id);
      showTabContextMenu(tab, ev.clientX, ev.clientY);
    });
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
  syncSaveButton();
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
        captureHexState(prev);
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
  settingsUi?.setOpen(false);
  explorer?.revealPath(tab.path);
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
  mdView?: MdView;
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
    savedVersionId: 0,
    diskStamp: null,
    ignoredStamp: null,
    viewMode: options?.viewMode === "hex" ? "hex" : "text",
    bytes: options?.bytes ?? new Uint8Array(0),
    diskSize: options?.diskSize ?? options?.bytes?.length ?? 0,
    diskLoaded: options?.diskLoaded ?? options?.bytes?.length ?? 0,
    bytesStale: !options?.bytes,
    textStale: false,
    byteMarkIds: [],
    mdView: options?.mdView && isMarkdownLanguage(languageId) ? options.mdView : "off",
    hexHistory: emptyHexHistory(),
  };

  if (tab.dirty) {
    tab.savedVersionId = -1;
  } else {
    tab.savedVersionId = tab.model.getAlternativeVersionId();
  }

  model.onDidChangeContent(() => {
    if (restoringSession || applyingExternal) {
      return;
    }
    syncTabDirtyFromModel(tab);
    tab.bytesStale = true;
    tab.textStale = false;
    tab.hexHistory = emptyHexHistory();
    refreshByteMarkDecorations(tab);
    updateStatusBar();
    if (tab.id === activeTabId) {
      syncEditActions();
    }
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

function pathIsRemoved(tabPath: string, removed: string, isDir: boolean) {
  const tabKey = pathKey(tabPath);
  const removedKey = pathKey(removed);
  return isDir ? tabKey === removedKey || tabKey.startsWith(`${removedKey}/`) : tabKey === removedKey;
}

function forgetDeletedExplorerPath(removed: string, isDir: boolean) {
  const affected = [...tabs.values()].filter((tab) => tab.path && pathIsRemoved(tab.path, removed, isDir));
  for (const tab of affected) {
    if (tab.dirty) {
      tab.path = null;
      tab.untitledNumber = nextUntitledNumber();
      tab.title = t("tab.untitled", { n: tab.untitledNumber });
      tab.diskStamp = null;
      tab.ignoredStamp = null;
    } else {
      disposeTab(tab.id);
    }
  }
  if (affected.length) {
    renderTabs();
    updateStatusForActive();
    schedulePersistSession();
    scheduleSyncWatchedFiles();
  }
}

function disposeTab(id: string) {
  const tab = tabs.get(id);
  if (!tab) {
    return;
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
  }
}

async function closeTab(id: string) {
  const tab = tabs.get(id);
  if (!tab) {
    return;
  }

  if (tab.path && tab.dirty) {
    fileChangePromptOpen = true;
    let result: string;
    try {
      result = await confirmDialog({
        title: t("dialog.closeDirtyTitle"),
        message: t("dialog.closeDirty", { name: tab.title }),
        kind: "warning",
        buttons: [
          { id: "save", label: t("dialog.save"), role: "primary" },
          { id: "discard", label: t("dialog.discard"), role: "danger" },
          { id: "cancel", label: t("dialog.cancel") },
        ],
        defaultId: "save",
        cancelId: "cancel",
      });
    } finally {
      fileChangePromptOpen = false;
      windowFocused = await getCurrentWindow().isFocused();
      if (windowFocused) {
        void syncWatchedFiles();
      }
    }
    if (result === "cancel") {
      return;
    }
    if (result === "save") {
      const saved = await saveTab(tab);
      if (!saved) {
        return;
      }
    }
  }

  disposeTab(id);
  if (activeTabId !== id) {
    renderTabs();
  }
  schedulePersistSession();
  scheduleSyncWatchedFiles();
}

async function openPath(path: string, reveal?: { line: number; column: number; endColumn?: number }) {
  const existing = [...tabs.values()].find(
    (tab) => tab.path && pathKey(tab.path) === pathKey(path),
  );
  if (existing) {
    activateTab(existing.id);
    if (reveal && existing.viewMode === "hex") {
      existing.viewMode = "text";
      await showTabView(existing);
    }
  } else {
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

  if (!reveal || !editor) {
    return;
  }
  const line = Math.max(1, reveal.line);
  const column = Math.max(1, reveal.column);
  const endColumn = Math.max(column, reveal.endColumn ?? column);
  // Wait a frame so the model/view is ready after activate/create.
  requestAnimationFrame(() => {
    if (!editor) {
      return;
    }
    editor.revealPositionInCenter({ lineNumber: line, column });
    editor.setSelection({
      startLineNumber: line,
      startColumn: column,
      endLineNumber: line,
      endColumn,
    });
    editor.focus();
  });
}

async function openSearchHit(hit: SearchHit) {
  await openPath(hit.path, {
    line: hit.line,
    column: hit.column,
    endColumn: hit.endColumn,
  });
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
  markTabClean(tab);
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
  if (!isMarkdownLanguage(languageId) && tab.mdView !== "off") {
    tab.mdView = "off";
  }
  applyMdPreview(tab);
  layoutEditor();
  syncLanguageSelect();
  syncMdPreviewButton();
  syncFormatButton();
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
        mdView: parseMdView(row.item.mdView ?? row.item.mdPreview),
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
  bindConfirmDialog();
  bindNameDialog();
  document.querySelector("#btn-new")!.addEventListener("click", () => createTab());
  document.querySelector("#btn-open")!.addEventListener("click", () => void openFile());
  saveButton.addEventListener("click", () => {
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
  pasteButton.addEventListener("click", () => {
    triggerEditAction("editor.action.clipboardPasteAction");
  });
  copyButton.addEventListener("click", () => {
    triggerEditAction("editor.action.clipboardCopyAction");
  });
  cutButton.addEventListener("click", () => {
    triggerEditAction("editor.action.clipboardCutAction");
  });
  undoButton.addEventListener("click", () => {
    triggerEditAction("undo");
  });
  redoButton.addEventListener("click", () => {
    triggerEditAction("redo");
  });
  wrapButton.addEventListener("click", () => toggleWordWrap());
  formatButton.addEventListener("click", () => void formatActive());
  formatOptionsButton.addEventListener("click", () => void openFormatOptionsDialog());
  mdButton.addEventListener("click", () => void setMdView("split"));
  readButton.addEventListener("click", () => void setMdView("reader"));
  syntaxButton.addEventListener("click", (ev) => {
    ev.stopPropagation();
    setSyntaxMenuOpen(syntaxMenu.hidden);
  });
  syntaxMenu.addEventListener("click", (ev) => {
    ev.stopPropagation();
    const action = (ev.target as HTMLElement).closest<HTMLButtonElement>("[data-action]")?.dataset.action;
    if (action === "add-language") {
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
      syncEditActions();
      syncFindLocale();
      explorer?.syncLocale();
      searchUi?.syncLocale();
      settingsUi?.syncLocale();
      syncTitlebarLocale();
      registerEditorContextMenu();
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
    hideTabContextMenu();
  });
  window.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") {
      setLocaleMenuOpen(false);
      setSyntaxMenuOpen(false);
      setSaveMenuOpen(false);
      setEncodingMenuOpen(false);
      hideTabContextMenu();
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
    bindFormatDialogs({
      getLanguageIds: () => {
        const ids = new Set(["c", "cpp", "go", "python", "rust", ...plugins.map((plugin) => plugin.id)]);
        return [...ids].sort();
      },
      languageLabel,
      currentLanguageId: () => {
        const tab = activeTabId ? tabs.get(activeTabId) : undefined;
        return tab?.languageId ?? PLAINTEXT;
      },
      onIndentChange: applyFormatIndent,
      onFormatterChange: () => {
        void refreshFormatterCommands();
      },
    });
  } catch (err) {
    console.warn("failed to bind format dialogs", err);
  }
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
    } else if (key === "b") {
      ev.preventDefault();
      explorer?.toggle();
    } else if (key === "f" && ev.shiftKey) {
      ev.preventDefault();
      searchUi?.focus();
    } else if (key === "z" || key === "y") {
      const tab = activeTabId ? tabs.get(activeTabId) : undefined;
      if (tab?.viewMode !== "hex") {
        return;
      }
      ev.preventDefault();
      if (key === "y" || ev.shiftKey) {
        hexEditor?.redo();
      } else {
        hexEditor?.undo();
      }
    }
  });
  window.addEventListener("keydown", (ev) => {
    if (ev.altKey && ev.shiftKey && ev.key.toLowerCase() === "f" && !ev.ctrlKey && !ev.metaKey) {
      ev.preventDefault();
      void formatActive();
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

function disableReleaseContextMenu() {
  if (!import.meta.env.PROD) {
    return;
  }
  document.addEventListener("contextmenu", (event) => {
    const target = event.target;
    if (
      target instanceof Element &&
      (target.closest(".monaco-editor") ||
        target.closest(".tab") ||
        target.closest("#tab-context-menu"))
    ) {
      return;
    }
    event.preventDefault();
  });
}

async function main() {
  disableReleaseContextMenu();
  bindTabContextMenu();
  applyToolbarIcons();
  const titlebarPromise = bindTitlebar();
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
  await titlebarPromise;
  syncTitlebarLocale();
  bindTooltips();
  syncLocaleButton();
  wrapButton.innerHTML = wrapButtonIcon();
  settingsUi = bindSettings({
    getEditor: () => editor,
    onPersist: (patch) => {
      void invoke("update_settings", patch).catch((err) => {
        console.warn("failed to save editor settings", err);
      });
    },
  });
  settingsUi.applyFromSettings(
    settings.fontFamily ?? DEFAULT_FONT_FAMILY,
    settings.fontSize ?? DEFAULT_FONT_SIZE,
  );
  explorer = bindExplorer({
    onOpenFile: (path) => {
      void openPath(path);
    },
    onPathsRemoved: forgetDeletedExplorerPath,
    onLayout: layoutEditor,
    onPersist: (patch) => {
      void invoke("update_settings", patch).catch((err) => {
        console.warn("failed to save explorer settings", err);
      });
    },
    onWorkspaceChange: (path) => {
      searchUi?.setWorkspace(path);
    },
  });
  searchUi = bindSearch({
    explorer: () => explorer,
    getWorkspace: () => explorer?.getWorkspace() ?? null,
    onOpenHit: (hit) => {
      void openSearchHit(hit);
    },
    onPersistExclude: (settings) => {
      void invoke("update_settings", { searchExclude: settings }).catch((err) => {
        console.warn("failed to save search exclude settings", err);
      });
    },
  });
  searchUi.applyExcludeSettings(settings.searchExclude);
  void explorer.applyInitial(
    settings.explorerOpen !== false,
    settings.explorerWidth ?? 240,
    settings.workspaceFolder ?? null,
  );
  searchUi.setWorkspace(settings.workspaceFolder ?? null);
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
      return !!tab && tabMdView(tab) === "split";
    },
  }).fromEditor;
  syncHexButton();

  plugins = await pluginsPromise;
  registerLanguageIds(monaco, plugins);
  defineEditorThemes(monaco);
  fillLanguageMenu();
  syncLanguageSelect();
  try {
    const formatConfig = await loadFormatterConfig();
    formatIndent = normalizeIndent(formatConfig.indent);
    formatterCommands = formatConfig.commands;
    syncFormatButton();
  } catch (err) {
    console.warn("failed to load formatter config", err);
  }

  editor = monaco.editor.create(monacoHost, {
    value: "",
    language: PLAINTEXT,
    theme: monacoThemeName(currentTheme),
    automaticLayout: false,
    fontSize: settings.fontSize ?? DEFAULT_FONT_SIZE,
    fontFamily: settings.fontFamily ?? DEFAULT_FONT_FAMILY,
    minimap: { enabled: false },
    wordWrap: "off",
    folding: true,
    foldingStrategy: "indentation",
    showFoldingControls: "mouseover",
    contextmenu: true,
    useShadowDOM: false,
    scrollbar: {
      verticalScrollbarSize: 8,
      horizontalScrollbarSize: 8,
      arrowSize: 0,
      verticalHasArrows: false,
      horizontalHasArrows: false,
    },
    bracketPairColorization: { enabled: true },
    ...monacoIndentOptions(formatIndent),
    find: {
      seedSearchStringFromSelection: "never",
      addExtraSpaceOnTop: false,
    },
  });
  registerEditorContextMenu();
  settingsUi?.applyFromSettings(
    settings.fontFamily ?? DEFAULT_FONT_FAMILY,
    settings.fontSize ?? DEFAULT_FONT_SIZE,
  );
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
        captureHexState(tab);
        tab.textStale = true;
        tab.bytesStale = false;
        forceTabDirty(tab);
        schedulePersistSession();
        syncEditActions();
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
  editor.onDidChangeCursorSelection(() => syncEditActions());
  editor.onDidFocusEditorText(() => syncEditActions());
  editor.onDidBlurEditorText(() => syncEditActions());
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
