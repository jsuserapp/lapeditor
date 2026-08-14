import * as monaco from "monaco-editor/editor/editor.api.js";
import { t } from "./i18n";
import { setTooltip } from "./tooltip";

const MATCH_LIMIT = 19999;
const WORD_SEPARATORS = "`~!@#$%^&*()-=+[{]}\\|;:'\",.<>/?";

const ICON_CHEVRON_RIGHT = `<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M6.2 3.2a.7.7 0 0 1 1 .04l4.5 4.8a.7.7 0 0 1 0 .92l-4.5 4.8a.7.7 0 1 1-1.04-.92L10.2 8 6.16 4.16a.7.7 0 0 1 .04-1z"/></svg>`;
const ICON_CHEVRON_DOWN = `<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M3.2 6.2a.7.7 0 0 1 1.04-.04L8 10.2l3.76-4.04a.7.7 0 1 1 1.04.92l-4.3 4.6a.7.7 0 0 1-1.04 0l-4.3-4.6a.7.7 0 0 1 .04-1z"/></svg>`;
const ICON_UP = `<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8.35 3.15a.5.5 0 0 0-.7 0l-4.5 4.5a.5.5 0 1 0 .7.7L7.5 4.71V12.5a.5.5 0 0 0 1 0V4.71l3.65 3.64a.5.5 0 1 0 .7-.7z"/></svg>`;
const ICON_DOWN = `<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M7.65 12.85a.5.5 0 0 0 .7 0l4.5-4.5a.5.5 0 0 0-.7-.7L8.5 11.29V3.5a.5.5 0 0 0-1 0v7.79L3.85 7.65a.5.5 0 1 0-.7.7z"/></svg>`;
const ICON_SELECTION = `<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M2 3.5h12v1H2zm0 4h7v1H2zm0 4h12v1H2z"/><rect x="10.2" y="6.2" width="3.6" height="3.6" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>`;
const ICON_CLOSE = `<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M4.22 4.22a.75.75 0 0 1 1.06 0L8 6.94l2.72-2.72a.75.75 0 1 1 1.06 1.06L9.06 8l2.72 2.72a.75.75 0 1 1-1.06 1.06L8 9.06l-2.72 2.72a.75.75 0 0 1-1.06-1.06L6.94 8 4.22 5.28a.75.75 0 0 1 0-1.06z"/></svg>`;
const ICON_REPLACE = `<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M3.5 3.5h4v1h-4zm0 3h3v1h-3zM9.2 2.8v3.4h1.6L8 9.2 5.2 6.2h1.6V2.8z"/><rect x="3" y="10" width="5" height="4" rx=".6" fill="none" stroke="currentColor" stroke-width="1.1"/></svg>`;
const ICON_REPLACE_ALL = `<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M9.2 2.8v3.4h1.6L8 9.2 5.2 6.2h1.6V2.8z"/><rect x="2.2" y="10" width="4.4" height="3.4" rx=".5" fill="none" stroke="currentColor" stroke-width="1.1"/><rect x="5.6" y="11.2" width="4.4" height="3.4" rx=".5" fill="none" stroke="currentColor" stroke-width="1.1"/></svg>`;

export type FindWidgetHost = {
  getEditor: () => monaco.editor.IStandaloneCodeEditor | undefined;
  isHexView: () => boolean;
  onLayout?: () => void;
};

const widget = () => document.querySelector<HTMLDivElement>("#find-widget")!;
const findInput = () => document.querySelector<HTMLInputElement>("#find-input")!;
const replaceInput = () => document.querySelector<HTMLInputElement>("#replace-input")!;
const matchesEl = () => document.querySelector<HTMLSpanElement>("#find-matches")!;
const toggleReplaceBtn = () => document.querySelector<HTMLButtonElement>("#find-toggle-replace")!;
const optCase = () => document.querySelector<HTMLButtonElement>("#find-opt-case")!;
const optWord = () => document.querySelector<HTMLButtonElement>("#find-opt-word")!;
const optRegex = () => document.querySelector<HTMLButtonElement>("#find-opt-regex")!;
const optPreserve = () => document.querySelector<HTMLButtonElement>("#find-opt-preserve")!;
const inSelectionBtn = () => document.querySelector<HTMLButtonElement>("#find-in-selection")!;
const prevBtn = () => document.querySelector<HTMLButtonElement>("#find-prev")!;
const nextBtn = () => document.querySelector<HTMLButtonElement>("#find-next")!;
const replaceBtn = () => document.querySelector<HTMLButtonElement>("#find-replace")!;
const replaceAllBtn = () => document.querySelector<HTMLButtonElement>("#find-replace-all")!;
const closeBtn = () => document.querySelector<HTMLButtonElement>("#find-close")!;
const findWrap = () => findInput().closest(".find-input-wrap")!;

let host: FindWidgetHost | undefined;
let decorations: monaco.editor.IEditorDecorationsCollection | undefined;
let matches: monaco.editor.FindMatch[] = [];
let current = 0;
let visible = false;
let replaceOpen = false;
let matchCase = false;
let wholeWord = false;
let useRegex = false;
let preserveCase = false;
let findInSelection = false;
let searchScope: monaco.IRange[] | null = null;
let regexInvalid = false;
let composing = false;
let findHistory: string[] = [];
let replaceHistory: string[] = [];
let findHistoryIndex = -1;
let replaceHistoryIndex = -1;

function pressed(btn: HTMLButtonElement, on: boolean) {
  btn.setAttribute("aria-pressed", on ? "true" : "false");
}

function selectionNonEmpty(sel: monaco.Selection) {
  return !sel.isEmpty();
}

function selectionMultiline(sel: monaco.Selection) {
  return sel.startLineNumber !== sel.endLineNumber;
}

function interpretRegexReplace(pattern: string, groups: string[]): string {
  let result = "";
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i];
    if (ch === "\\" && i + 1 < pattern.length) {
      const next = pattern[i + 1];
      i += 1;
      if (next === "n") {
        result += "\n";
      } else if (next === "t") {
        result += "\t";
      } else if (next === "r") {
        result += "\r";
      } else {
        result += next;
      }
      continue;
    }
    if (ch === "$" && i + 1 < pattern.length) {
      const next = pattern[i + 1];
      if (next === "$") {
        result += "$";
        i += 1;
        continue;
      }
      if (next === "&" || next === "0") {
        result += groups[0] ?? "";
        i += 1;
        continue;
      }
      if (next >= "1" && next <= "9") {
        let digits = "";
        while (i + 1 < pattern.length && pattern[i + 1] >= "0" && pattern[i + 1] <= "9") {
          digits += pattern[i + 1];
          i += 1;
        }
        result += groups[Number(digits)] ?? "";
        continue;
      }
    }
    result += ch;
  }
  return result;
}

function applyPreserveCase(matched: string, replace: string): string {
  if (!matched || !replace) {
    return replace;
  }
  if (matched === matched.toUpperCase() && matched !== matched.toLowerCase()) {
    return replace.toUpperCase();
  }
  if (matched === matched.toLowerCase() && matched !== matched.toUpperCase()) {
    return replace.toLowerCase();
  }
  const first = matched[0];
  const rest = matched.slice(1);
  if (
    first === first.toUpperCase() &&
    first !== first.toLowerCase() &&
    rest === rest.toLowerCase()
  ) {
    return replace.charAt(0).toUpperCase() + replace.slice(1).toLowerCase();
  }
  return replace;
}

function replaceTextForMatch(match: monaco.editor.FindMatch): string {
  const found = match.matches?.[0] ?? "";
  let text = replaceInput().value;
  if (useRegex) {
    text = interpretRegexReplace(text, match.matches ?? [found]);
  }
  if (preserveCase) {
    text = applyPreserveCase(found, text);
  }
  return text;
}

function pushHistory(list: string[], value: string): string[] {
  const trimmed = value;
  if (!trimmed) {
    return list;
  }
  const next = list.filter((item) => item !== trimmed);
  next.push(trimmed);
  return next.slice(-30);
}

function syncReplaceVisibility() {
  const el = widget();
  el.classList.toggle("replace-open", replaceOpen);
  toggleReplaceBtn().innerHTML = replaceOpen ? ICON_CHEVRON_DOWN : ICON_CHEVRON_RIGHT;
  toggleReplaceBtn().setAttribute("aria-expanded", replaceOpen ? "true" : "false");
  syncEditorPadding();
}

function syncEditorPadding() {
  const editor = host?.getEditor();
  if (!editor) {
    return;
  }
  const top = !visible ? 0 : replaceOpen ? 80 : 48;
  editor.updateOptions({ padding: { top } });
  host?.onLayout?.();
}

function syncButtons() {
  const hasQuery = findInput().value.length > 0;
  const hasMatches = matches.length > 0 && !regexInvalid;
  prevBtn().disabled = !hasMatches;
  nextBtn().disabled = !hasMatches;
  replaceBtn().disabled = !hasMatches;
  replaceAllBtn().disabled = !hasMatches || !hasQuery;
  pressed(optCase(), matchCase);
  pressed(optWord(), wholeWord);
  pressed(optRegex(), useRegex);
  pressed(optPreserve(), preserveCase);
  pressed(inSelectionBtn(), findInSelection);
}

function syncMatchLabel() {
  const el = matchesEl();
  const query = findInput().value;
  el.classList.toggle("no-results", false);
  if (!query) {
    el.textContent = "";
    return;
  }
  if (regexInvalid) {
    el.textContent = t("find.invalidRegex");
    el.classList.add("no-results");
    return;
  }
  if (matches.length === 0) {
    el.textContent = t("find.noResults");
    el.classList.add("no-results");
    return;
  }
  el.textContent = t("find.matchIndex", {
    current: current + 1,
    total: matches.length,
  });
}

function applyDecorations(editor: monaco.editor.IStandaloneCodeEditor) {
  if (!decorations) {
    decorations = editor.createDecorationsCollection();
  }
  const items: monaco.editor.IModelDeltaDecoration[] = matches.map((match, index) => ({
    range: match.range,
    options: {
      description: index === current ? "lap-find-current" : "lap-find-match",
      className: index === current ? "lap-find-current" : "lap-find-match",
      stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
      overviewRuler: {
        color: index === current ? "#A8AC94" : "#EA5C00",
        position: monaco.editor.OverviewRulerLane.Center,
      },
    },
  }));
  decorations.set(items);
}

function clearDecorations() {
  decorations?.clear();
}

function captureSearchScope(editor: monaco.editor.IStandaloneCodeEditor): monaco.IRange[] | null {
  const selections = editor.getSelections()?.filter(selectionNonEmpty) ?? [];
  if (selections.length === 0) {
    return null;
  }
  return selections.map((sel) => ({
    startLineNumber: sel.startLineNumber,
    startColumn: sel.startColumn,
    endLineNumber: sel.endLineNumber,
    endColumn: sel.endColumn,
  }));
}

function indexAfterPosition(position: monaco.IPosition | null): number {
  if (!position || matches.length === 0) {
    return 0;
  }
  const containing = matches.findIndex((match) => match.range.containsPosition(position));
  if (containing >= 0) {
    return containing;
  }
  const next = matches.findIndex((match) => {
    const start = match.range.getStartPosition();
    return (
      start.lineNumber > position.lineNumber ||
      (start.lineNumber === position.lineNumber && start.column >= position.column)
    );
  });
  return next >= 0 ? next : 0;
}

function revealCurrent(editor: monaco.editor.IStandaloneCodeEditor) {
  const match = matches[current];
  if (!match) {
    return;
  }
  editor.setSelection(match.range);
  editor.revealRangeInCenterIfOutsideViewport(match.range);
}

export function searchMatches(options?: { reveal?: boolean }) {
  const editor = host?.getEditor();
  const model = editor?.getModel();
  const reveal = options?.reveal ?? false;
  regexInvalid = false;
  findWrap().classList.remove("invalid");
  matches = [];
  current = 0;

  if (!editor || !model || !visible) {
    clearDecorations();
    syncButtons();
    syncMatchLabel();
    return;
  }

  const query = findInput().value;
  if (!query) {
    clearDecorations();
    syncButtons();
    syncMatchLabel();
    return;
  }

  if (useRegex) {
    try {
      new RegExp(query);
    } catch {
      regexInvalid = true;
      findWrap().classList.add("invalid");
      clearDecorations();
      syncButtons();
      syncMatchLabel();
      return;
    }
  }

  try {
    if (findInSelection && searchScope && searchScope.length > 0) {
      matches = model.findMatches(
        query,
        searchScope,
        useRegex,
        matchCase,
        wholeWord ? WORD_SEPARATORS : null,
        true,
        MATCH_LIMIT,
      );
    } else {
      matches = model.findMatches(
        query,
        true,
        useRegex,
        matchCase,
        wholeWord ? WORD_SEPARATORS : null,
        true,
        MATCH_LIMIT,
      );
    }
  } catch {
    regexInvalid = true;
    findWrap().classList.add("invalid");
    matches = [];
  }

  if (matches.length > 0) {
    current = indexAfterPosition(editor.getPosition());
  }
  applyDecorations(editor);
  if (reveal && matches.length > 0) {
    revealCurrent(editor);
  }
  syncButtons();
  syncMatchLabel();
}

function moveMatch(delta: number) {
  const editor = host?.getEditor();
  if (!editor || matches.length === 0) {
    searchMatches({ reveal: true });
    return;
  }
  current = (current + delta + matches.length) % matches.length;
  applyDecorations(editor);
  revealCurrent(editor);
  syncMatchLabel();
  findHistory = pushHistory(findHistory, findInput().value);
  findHistoryIndex = findHistory.length;
}

function replaceOne() {
  const editor = host?.getEditor();
  const model = editor?.getModel();
  if (!editor || !model || matches.length === 0) {
    return;
  }
  const match = matches[current];
  const text = replaceTextForMatch(match);
  editor.pushUndoStop();
  editor.executeEdits("find-replace", [
    { range: match.range, text, forceMoveMarkers: true },
  ]);
  editor.pushUndoStop();
  replaceHistory = pushHistory(replaceHistory, replaceInput().value);
  findHistory = pushHistory(findHistory, findInput().value);
  searchMatches({ reveal: true });
}

function replaceAll() {
  const editor = host?.getEditor();
  const model = editor?.getModel();
  if (!editor || !model || matches.length === 0) {
    return;
  }
  const edits = [...matches].reverse().map((match) => ({
    range: match.range,
    text: replaceTextForMatch(match),
    forceMoveMarkers: true,
  }));
  editor.pushUndoStop();
  editor.executeEdits("find-replace-all", edits);
  editor.pushUndoStop();
  replaceHistory = pushHistory(replaceHistory, replaceInput().value);
  findHistory = pushHistory(findHistory, findInput().value);
  searchMatches({ reveal: false });
}

function selectAllMatches() {
  const editor = host?.getEditor();
  if (!editor || matches.length === 0) {
    return;
  }
  editor.setSelections(
    matches.map((match) => ({
      selectionStartLineNumber: match.range.startLineNumber,
      selectionStartColumn: match.range.startColumn,
      positionLineNumber: match.range.endLineNumber,
      positionColumn: match.range.endColumn,
    })),
  );
}

function seedFromSelection(editor: monaco.editor.IStandaloneCodeEditor) {
  const sel = editor.getSelection();
  if (!sel || sel.isEmpty() || selectionMultiline(sel)) {
    return;
  }
  const model = editor.getModel();
  if (!model) {
    return;
  }
  findInput().value = model.getValueInRange(sel);
}

function maybeAutoFindInSelection(editor: monaco.editor.IStandaloneCodeEditor) {
  const sel = editor.getSelection();
  if (!sel || !selectionMultiline(sel)) {
    return;
  }
  const scope = captureSearchScope(editor);
  if (!scope) {
    return;
  }
  findInSelection = true;
  searchScope = scope;
}

export function closeFind() {
  if (!visible) {
    return;
  }
  visible = false;
  widget().hidden = true;
  clearDecorations();
  syncEditorPadding();
  host?.getEditor()?.focus();
}

export function openFind(options?: { replace?: boolean }) {
  if (host?.isHexView()) {
    return;
  }
  const editor = host?.getEditor();
  if (!editor) {
    return;
  }
  const wantReplace = options?.replace ?? false;
  const alreadyOpen = visible;
  if (wantReplace) {
    replaceOpen = true;
  }
  if (!alreadyOpen) {
    maybeAutoFindInSelection(editor);
    if (!findInSelection) {
      seedFromSelection(editor);
    }
  } else if (!findInSelection) {
    seedFromSelection(editor);
  }
  visible = true;
  widget().hidden = false;
  syncReplaceVisibility();
  searchMatches({ reveal: true });
  syncFindLocale();
  const target = wantReplace && alreadyOpen ? replaceInput() : findInput();
  target.focus();
  target.select();
}

export function refreshFind(options?: { reveal?: boolean }) {
  if (!visible) {
    return;
  }
  if (host?.isHexView()) {
    closeFind();
    return;
  }
  searchMatches({ reveal: options?.reveal ?? false });
}

export function syncFindLocale() {
  widget().setAttribute("aria-label", t("find.title"));
  findInput().placeholder = t("find.placeholder");
  replaceInput().placeholder = t("find.replacePlaceholder");
  setTooltip(toggleReplaceBtn(), t("find.toggleReplace"));
  setTooltip(optCase(), t("find.matchCase"));
  setTooltip(optWord(), t("find.wholeWord"));
  setTooltip(optRegex(), t("find.regex"));
  setTooltip(optPreserve(), t("find.preserveCase"));
  setTooltip(prevBtn(), t("find.prev"));
  setTooltip(nextBtn(), t("find.next"));
  setTooltip(inSelectionBtn(), t("find.inSelection"));
  setTooltip(closeBtn(), t("find.close"));
  setTooltip(replaceBtn(), t("find.replace"));
  setTooltip(replaceAllBtn(), t("find.replaceAll"));
  syncMatchLabel();
}

function cycleHistory(
  input: HTMLInputElement,
  list: string[],
  index: number,
  direction: -1 | 1,
): number {
  if (list.length === 0) {
    return index;
  }
  let next = index;
  if (next < 0) {
    next = list.length;
  }
  next += direction;
  if (next < 0) {
    next = 0;
  }
  if (next >= list.length) {
    next = list.length;
    input.value = "";
    return next;
  }
  input.value = list[next] ?? "";
  return next;
}

function unbindMonacoFind() {
  const addRules = monaco.editor.addKeybindingRules;
  if (typeof addRules !== "function") {
    return;
  }
  const ctrl = monaco.KeyMod.CtrlCmd;
  addRules([
    { keybinding: ctrl | monaco.KeyCode.KeyF, command: "-actions.find" },
    { keybinding: ctrl | monaco.KeyCode.KeyH, command: "-editor.action.startFindReplaceAction" },
    { keybinding: monaco.KeyCode.F3, command: "-editor.action.nextMatchFindAction" },
    { keybinding: monaco.KeyMod.Shift | monaco.KeyCode.F3, command: "-editor.action.previousMatchFindAction" },
    { keybinding: ctrl | monaco.KeyCode.F3, command: "-editor.action.nextSelectionMatchFindAction" },
    {
      keybinding: ctrl | monaco.KeyMod.Shift | monaco.KeyCode.F3,
      command: "-editor.action.previousSelectionMatchFindAction",
    },
  ]);
}

function onGlobalKey(ev: KeyboardEvent) {
  const mod = ev.ctrlKey || ev.metaKey;
  const key = ev.key.length === 1 ? ev.key.toLowerCase() : ev.key;

  if (mod && !ev.altKey && key === "f" && !ev.shiftKey) {
    ev.preventDefault();
    openFind({ replace: false });
    return;
  }
  if (mod && !ev.altKey && key === "h" && !ev.shiftKey) {
    ev.preventDefault();
    openFind({ replace: true });
    return;
  }
  if (ev.key === "F3") {
    ev.preventDefault();
    if (!visible) {
      openFind({ replace: replaceOpen });
      return;
    }
    moveMatch(ev.shiftKey ? -1 : 1);
    return;
  }

  if (!visible) {
    return;
  }

  if (ev.key === "Escape") {
    ev.preventDefault();
    ev.stopPropagation();
    closeFind();
    return;
  }

  if (ev.altKey && !mod) {
    const k = ev.key.toLowerCase();
    if (k === "c") {
      ev.preventDefault();
      matchCase = !matchCase;
      searchMatches({ reveal: true });
      syncButtons();
    } else if (k === "w") {
      ev.preventDefault();
      wholeWord = !wholeWord;
      searchMatches({ reveal: true });
      syncButtons();
    } else if (k === "r") {
      ev.preventDefault();
      useRegex = !useRegex;
      searchMatches({ reveal: true });
      syncButtons();
    } else if (k === "p") {
      ev.preventDefault();
      preserveCase = !preserveCase;
      syncButtons();
    } else if (k === "l") {
      ev.preventDefault();
      toggleFindInSelection();
    }
    return;
  }

  if (ev.altKey && mod && ev.key === "Enter") {
    ev.preventDefault();
    replaceAll();
  } else if (ev.altKey && ev.key === "Enter") {
    ev.preventDefault();
    selectAllMatches();
  }
}

function toggleFindInSelection() {
  const editor = host?.getEditor();
  if (!editor) {
    return;
  }
  if (findInSelection) {
    findInSelection = false;
    searchScope = null;
  } else {
    const scope = captureSearchScope(editor);
    if (!scope) {
      return;
    }
    findInSelection = true;
    searchScope = scope;
  }
  searchMatches({ reveal: true });
  syncButtons();
}

function bindWidgetKeys() {
  const onFindKey = (ev: KeyboardEvent) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      if (ev.ctrlKey || ev.metaKey) {
        replaceAll();
        return;
      }
      moveMatch(ev.shiftKey ? -1 : 1);
      findHistory = pushHistory(findHistory, findInput().value);
      findHistoryIndex = findHistory.length;
    } else if (ev.key === "ArrowUp") {
      ev.preventDefault();
      findHistoryIndex = cycleHistory(findInput(), findHistory, findHistoryIndex, -1);
      searchMatches({ reveal: true });
    } else if (ev.key === "ArrowDown") {
      ev.preventDefault();
      findHistoryIndex = cycleHistory(findInput(), findHistory, findHistoryIndex, 1);
      searchMatches({ reveal: true });
    } else if (ev.key === "Tab" && replaceOpen && !ev.shiftKey) {
      ev.preventDefault();
      replaceInput().focus();
    }
  };

  const onReplaceKey = (ev: KeyboardEvent) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      if (ev.ctrlKey || ev.metaKey || (ev.altKey && (ev.ctrlKey || ev.metaKey))) {
        replaceAll();
        return;
      }
      replaceOne();
    } else if (ev.key === "ArrowUp") {
      ev.preventDefault();
      replaceHistoryIndex = cycleHistory(replaceInput(), replaceHistory, replaceHistoryIndex, -1);
    } else if (ev.key === "ArrowDown") {
      ev.preventDefault();
      replaceHistoryIndex = cycleHistory(replaceInput(), replaceHistory, replaceHistoryIndex, 1);
    } else if (ev.key === "Tab" && ev.shiftKey) {
      ev.preventDefault();
      findInput().focus();
    }
  };

  findInput().addEventListener("keydown", onFindKey);
  replaceInput().addEventListener("keydown", onReplaceKey);
  findInput().addEventListener("compositionstart", () => {
    composing = true;
  });
  findInput().addEventListener("compositionend", () => {
    composing = false;
    searchMatches({ reveal: true });
  });
  findInput().addEventListener("input", () => {
    if (!composing) {
      searchMatches({ reveal: true });
    }
  });
}

export function bindFindWidget(options: FindWidgetHost) {
  host = options;
  toggleReplaceBtn().innerHTML = ICON_CHEVRON_RIGHT;
  prevBtn().innerHTML = ICON_UP;
  nextBtn().innerHTML = ICON_DOWN;
  inSelectionBtn().innerHTML = ICON_SELECTION;
  closeBtn().innerHTML = ICON_CLOSE;
  replaceBtn().innerHTML = ICON_REPLACE;
  replaceAllBtn().innerHTML = ICON_REPLACE_ALL;

  toggleReplaceBtn().addEventListener("click", (ev) => {
    ev.preventDefault();
    replaceOpen = !replaceOpen;
    syncReplaceVisibility();
    if (replaceOpen) {
      replaceInput().focus();
    } else {
      findInput().focus();
    }
  });
  optCase().addEventListener("click", () => {
    matchCase = !matchCase;
    searchMatches({ reveal: true });
    syncButtons();
  });
  optWord().addEventListener("click", () => {
    wholeWord = !wholeWord;
    searchMatches({ reveal: true });
    syncButtons();
  });
  optRegex().addEventListener("click", () => {
    useRegex = !useRegex;
    searchMatches({ reveal: true });
    syncButtons();
  });
  optPreserve().addEventListener("click", () => {
    preserveCase = !preserveCase;
    syncButtons();
  });
  inSelectionBtn().addEventListener("click", () => toggleFindInSelection());
  prevBtn().addEventListener("click", () => moveMatch(-1));
  nextBtn().addEventListener("click", () => moveMatch(1));
  replaceBtn().addEventListener("click", () => replaceOne());
  replaceAllBtn().addEventListener("click", () => replaceAll());
  closeBtn().addEventListener("click", () => closeFind());

  bindWidgetKeys();
  window.addEventListener("keydown", onGlobalKey, true);
  unbindMonacoFind();
  for (const btn of widget().querySelectorAll("button")) {
    btn.addEventListener("mousedown", (ev) => ev.preventDefault());
  }
  syncButtons();
  syncFindLocale();
}
