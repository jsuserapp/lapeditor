import { invoke } from "@tauri-apps/api/core";
import * as monaco from "monaco-editor/editor/editor.api.js";
import { Bold, Code, Heading2, ImagePlus, Italic, Link, List, SquareSigma, X } from "lucide";
import { t } from "./i18n";
import { setTooltip } from "./tooltip";
import { setUiIcon } from "./ui-icon";

export type MdEditHost = {
  getEditor: () => monaco.editor.IStandaloneCodeEditor | undefined;
  isMarkdownEditing: () => boolean;
  ensureSaved: () => Promise<string | null>;
};

let host: MdEditHost | null = null;

function editor(): monaco.editor.IStandaloneCodeEditor | undefined {
  return host?.getEditor();
}

function selectedText(ed: monaco.editor.IStandaloneCodeEditor): string {
  const sel = ed.getSelection();
  if (!sel) {
    return "";
  }
  return ed.getModel()?.getValueInRange(sel) ?? "";
}

function mdDest(path: string): string {
  const norm = path.replace(/\\/g, "/");
  return /[\s()[\]]/.test(norm) ? `<${norm}>` : norm;
}

function insertAtCursor(ed: monaco.editor.IStandaloneCodeEditor, text: string, selectInner?: { start: number; end: number }) {
  const sel = ed.getSelection() ?? new monaco.Selection(1, 1, 1, 1);
  const start = monaco.Range.lift(sel).getStartPosition();
  ed.pushUndoStop();
  ed.executeEdits("md-edit", [{ range: sel, text, forceMoveMarkers: true }]);
  if (selectInner) {
    const model = ed.getModel()!;
    const origin = model.getOffsetAt(start);
    const begin = model.getPositionAt(origin + selectInner.start);
    const end = model.getPositionAt(origin + selectInner.end);
    ed.setSelection(monaco.Selection.fromPositions(begin, end));
  }
  ed.pushUndoStop();
  ed.focus();
}

function wrapInline(left: string, right: string, placeholder: string) {
  const ed = editor();
  if (!ed || !host?.isMarkdownEditing()) {
    return;
  }
  const sel = ed.getSelection();
  if (!sel) {
    return;
  }
  const text = selectedText(ed);
  const wrapped = text.startsWith(left) && text.endsWith(right) && text.length >= left.length + right.length;
  if (wrapped) {
    const inner = text.slice(left.length, text.length - right.length);
    insertAtCursor(ed, inner);
    return;
  }
  const inner = text || placeholder;
  const next = `${left}${inner}${right}`;
  insertAtCursor(ed, next, text ? undefined : { start: left.length, end: left.length + inner.length });
}

function toggleLinePrefix(prefix: string, heading = false) {
  const ed = editor();
  const model = ed?.getModel();
  if (!ed || !model || !host?.isMarkdownEditing()) {
    return;
  }
  const sel = ed.getSelection() ?? new monaco.Selection(1, 1, 1, 1);
  const from = Math.min(sel.startLineNumber, sel.endLineNumber);
  const to = Math.max(sel.startLineNumber, sel.endLineNumber);
  const edits: monaco.editor.IIdentifiedSingleEditOperation[] = [];
  for (let line = from; line <= to; line++) {
    const content = model.getLineContent(line);
    const range = new monaco.Range(line, 1, line, model.getLineMaxColumn(line));
    if (heading && /^#{1,6}\s+/.test(content)) {
      if (content.startsWith(prefix)) {
        edits.push({ range, text: content.replace(/^#{1,6}\s+/, "") });
      } else {
        edits.push({ range, text: content.replace(/^#{1,6}\s+/, prefix) });
      }
    } else if (content.startsWith(prefix)) {
      edits.push({ range, text: content.slice(prefix.length) });
    } else {
      edits.push({ range, text: prefix + content });
    }
  }
  ed.pushUndoStop();
  ed.executeEdits("md-edit", edits);
  ed.pushUndoStop();
  ed.focus();
}

function wrapCode() {
  const ed = editor();
  if (!ed || !host?.isMarkdownEditing()) {
    return;
  }
  const text = selectedText(ed);
  if (text.includes("\n")) {
    const inner = text || t("md.placeholder.code");
    const body = `\`\`\`\n${inner}\n\`\`\``;
    insertAtCursor(ed, body, text ? undefined : { start: 4, end: 4 + inner.length });
    return;
  }
  wrapInline("`", "`", t("md.placeholder.code"));
}

export function mdBold() {
  wrapInline("**", "**", t("md.placeholder.bold"));
}

export function mdItalic() {
  wrapInline("*", "*", t("md.placeholder.italic"));
}

export function mdHeading() {
  toggleLinePrefix("## ", true);
}

export function mdList() {
  toggleLinePrefix("- ");
}

export function mdCode() {
  wrapCode();
}

function dialogRoot() {
  return document.querySelector<HTMLDivElement>("#md-insert-dialog")!;
}

function field1() {
  return document.querySelector<HTMLInputElement>("#md-insert-field1")!;
}

function field2() {
  return document.querySelector<HTMLInputElement>("#md-insert-field2")!;
}

function field1Label() {
  return document.querySelector<HTMLSpanElement>("#md-insert-label1")!;
}

function field2Wrap() {
  return document.querySelector<HTMLLabelElement>("#md-insert-field2-wrap")!;
}

function field2Label() {
  return document.querySelector<HTMLSpanElement>("#md-insert-label2")!;
}

function radiosWrap() {
  return document.querySelector<HTMLDivElement>("#md-insert-radios")!;
}

let dialogPending: ((ok: boolean) => void) | null = null;

function hideInsertDialog(ok: boolean) {
  const root = dialogRoot();
  if (root.hidden) {
    return;
  }
  root.hidden = true;
  const resolve = dialogPending;
  dialogPending = null;
  resolve?.(ok);
}

function bindInsertDialog() {
  document.querySelector("#md-insert-cancel")?.addEventListener("click", () => hideInsertDialog(false));
  document.querySelector("#md-insert-confirm")?.addEventListener("click", () => hideInsertDialog(true));
  dialogRoot().querySelector(".modal")?.addEventListener("click", (ev) => ev.stopPropagation());
  window.addEventListener(
    "keydown",
    (ev) => {
      if (dialogRoot().hidden) {
        return;
      }
      if (ev.key === "Escape") {
        ev.preventDefault();
        hideInsertDialog(false);
      } else if (ev.key === "Enter") {
        ev.preventDefault();
        hideInsertDialog(true);
      }
    },
    true,
  );
}

function openInsertDialog(options: {
  title: string;
  label1: string;
  value1: string;
  label2?: string;
  value2?: string;
  radios?: boolean;
}): Promise<boolean> {
  document.querySelector("#md-insert-title")!.textContent = options.title;
  field1Label().textContent = options.label1;
  field1().value = options.value1;
  const has2 = options.label2 != null;
  field2Wrap().hidden = !has2;
  if (has2) {
    field2Label().textContent = options.label2!;
    field2().value = options.value2 ?? "";
  }
  radiosWrap().hidden = !options.radios;
  if (options.radios) {
    const inline = document.querySelector<HTMLInputElement>("#md-formula-inline")!;
    inline.checked = true;
  }
  dialogRoot().hidden = false;
  window.setTimeout(() => {
    field1().focus();
    field1().select();
  }, 0);
  return new Promise((resolve) => {
    if (dialogPending) {
      dialogPending(false);
    }
    dialogPending = resolve;
  });
}

export async function mdLink() {
  const ed = editor();
  if (!ed || !host?.isMarkdownEditing()) {
    return;
  }
  const selected = selectedText(ed);
  const ok = await openInsertDialog({
    title: t("md.linkTitle"),
    label1: t("md.linkText"),
    value1: selected || t("md.placeholder.link"),
    label2: t("md.linkUrl"),
    value2: "https://",
  });
  if (!ok) {
    ed.focus();
    return;
  }
  const text = field1().value.trim() || t("md.placeholder.link");
  const url = field2().value.trim() || "https://";
  insertAtCursor(ed, `[${text}](${mdDest(url)})`);
}

export async function mdFormula() {
  const ed = editor();
  if (!ed || !host?.isMarkdownEditing()) {
    return;
  }
  const selected = selectedText(ed);
  const ok = await openInsertDialog({
    title: t("md.formulaTitle"),
    label1: t("md.formulaLabel"),
    value1: selected || "E = mc^2",
    radios: true,
  });
  if (!ok) {
    ed.focus();
    return;
  }
  const latex = field1().value.trim() || "E = mc^2";
  const block = document.querySelector<HTMLInputElement>("#md-formula-block")?.checked;
  if (block) {
    insertAtCursor(ed, `$$\n${latex}\n$$`);
  } else {
    insertAtCursor(ed, `$${latex}$`);
  }
}

function imageTimestampStem(): string {
  const d = new Date();
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}${p(d.getMilliseconds(), 3)}`;
}

function imageMarkup(rel: string, alt: string): string {
  return `![${alt}](${mdDest(rel)})`;
}

async function insertImageMarkup(rel: string, alt: string) {
  const ed = editor();
  if (!ed) {
    return;
  }
  insertAtCursor(ed, imageMarkup(rel, alt));
}

export async function mdImage() {
  if (!host?.isMarkdownEditing()) {
    return;
  }
  const path = await host.ensureSaved();
  if (!path || !host.isMarkdownEditing()) {
    editor()?.focus();
    return;
  }
  const source = await invoke<string | null>("pick_open_file", {
    title: t("md.imagePick"),
    imageOnly: true,
  });
  if (!source) {
    editor()?.focus();
    return;
  }
  try {
    const rel = await invoke<string>("import_markdown_image", {
      markdownPath: path,
      sourcePath: source,
    });
    const alt = source.replace(/\\/g, "/").split("/").pop()?.replace(/\.[^.]+$/, "") || t("md.placeholder.image");
    await insertImageMarkup(rel, alt);
  } catch (err) {
    console.warn("failed to import markdown image", err);
    editor()?.focus();
  }
}

export async function mdPasteImageIfAny(): Promise<boolean> {
  if (!host?.isMarkdownEditing()) {
    return false;
  }
  try {
    const hasImage = await invoke<boolean>("clipboard_has_image");
    if (!hasImage) {
      return false;
    }
    const path = await host.ensureSaved();
    if (!path) {
      return true;
    }
    const rel = await invoke<string | null>("save_clipboard_markdown_image", {
      markdownPath: path,
      stem: imageTimestampStem(),
    });
    if (!rel) {
      return false;
    }
    await insertImageMarkup(rel, t("md.placeholder.image"));
    return true;
  } catch (err) {
    console.warn("failed to paste markdown image", err);
    return true;
  }
}

function mdEditPanel(): HTMLDivElement | null {
  return document.querySelector<HTMLDivElement>("#md-edit-panel");
}

function setMdEditPanelExpanded(expanded: boolean) {
  const panel = mdEditPanel();
  const toggle = document.querySelector<HTMLButtonElement>("#md-edit-panel-toggle");
  const iconHost = document.querySelector<HTMLSpanElement>("#md-edit-panel-icon");
  panel?.classList.toggle("is-expanded", expanded);
  toggle?.setAttribute("aria-expanded", expanded ? "true" : "false");
  if (iconHost) {
    setUiIcon(iconHost, expanded ? X : Bold, { size: 16, strokeWidth: 2 });
  }
}

function bindToolbar() {
  const panel = mdEditPanel();
  const group = document.querySelector<HTMLDivElement>("#md-edit-group");
  if (!panel || !group) {
    return;
  }
  const toggle = document.querySelector<HTMLButtonElement>("#md-edit-panel-toggle");
  toggle?.addEventListener("click", () => {
    setMdEditPanelExpanded(!panel.classList.contains("is-expanded"));
  });
  setMdEditPanelExpanded(false);
  const buttons: Array<[string, () => void, Parameters<typeof setUiIcon>[1], string]> = [
    ["#btn-md-bold", mdBold, Bold, "md.bold"],
    ["#btn-md-italic", mdItalic, Italic, "md.italic"],
    ["#btn-md-code", mdCode, Code, "md.code"],
    ["#btn-md-heading", mdHeading, Heading2, "md.heading"],
    ["#btn-md-list", mdList, List, "md.list"],
    ["#btn-md-link", () => void mdLink(), Link, "md.link"],
    ["#btn-md-image", () => void mdImage(), ImagePlus, "md.image"],
    ["#btn-md-formula", () => void mdFormula(), SquareSigma, "md.formula"],
  ];
  for (const [sel, action, icon, titleKey] of buttons) {
    const btn = document.querySelector<HTMLButtonElement>(sel);
    if (!btn) {
      continue;
    }
    const heading = sel === "#btn-md-heading";
    const formula = sel === "#btn-md-formula";
    setUiIcon(btn, icon, {
      size: heading ? 20 : formula ? 18 : 16,
      strokeWidth: heading || formula ? 1.6 : 2,
    });
    setTooltip(btn, t(titleKey));
    btn.setAttribute("aria-label", t(titleKey));
    btn.addEventListener("click", action);
  }
}

export function syncMdEditToolbar(visible: boolean) {
  const panel = mdEditPanel();
  if (!panel) {
    return;
  }
  panel.hidden = !visible;
  if (!visible) {
    setMdEditPanelExpanded(false);
  }
}

export function syncMdEditLocale() {
  const keys: Array<[string, string]> = [
    ["#md-edit-panel-toggle", "md.tools"],
    ["#btn-md-bold", "md.bold"],
    ["#btn-md-italic", "md.italic"],
    ["#btn-md-code", "md.code"],
    ["#btn-md-heading", "md.heading"],
    ["#btn-md-list", "md.list"],
    ["#btn-md-link", "md.link"],
    ["#btn-md-image", "md.image"],
    ["#btn-md-formula", "md.formula"],
  ];
  for (const [sel, key] of keys) {
    const btn = document.querySelector<HTMLButtonElement>(sel);
    if (!btn) {
      continue;
    }
    setTooltip(btn, t(key));
    btn.setAttribute("aria-label", t(key));
  }
}

export function bindMdEdit(next: MdEditHost) {
  host = next;
  bindInsertDialog();
  bindToolbar();
}
