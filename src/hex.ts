import { dumpChars, padHex } from "./bytesutil";

export const HEX_ROW_BYTES = 16;
const ROW_HEIGHT = 22;
const OVERSCAN = 12;
const MAX_SPACER = 20_000_000;
const MAX_HISTORY = 200;

export type HexChangeKind = "edit" | "select" | "scroll";

export type HexCaret = {
  offset: number;
  nibble: number;
  selEnd: number;
};

export type HexPatch = {
  offset: number;
  before: Uint8Array;
  after: Uint8Array;
  caretBefore: HexCaret;
  caretAfter: HexCaret;
};

export type HexHistory = {
  undo: HexPatch[];
  redo: HexPatch[];
};

export function emptyHexHistory(): HexHistory {
  return { undo: [], redo: [] };
}

export type HexEditorOptions = {
  onChange?: (kind: HexChangeKind) => void;
  onNeedMore?: () => void;
};

export class HexEditor {
  readonly el: HTMLDivElement;
  private headerEl: HTMLDivElement;
  private scrollEl: HTMLDivElement;
  private spacerEl: HTMLDivElement;
  private rowsEl: HTMLDivElement;
  private bytes = new Uint8Array(0);
  private totalSize = 0;
  private offset = 0;
  private nibble = 0;
  private selEnd = 0;
  private dragging = false;
  private firstRow = 0;
  private visibleRows = 0;
  private undoStack: HexPatch[] = [];
  private redoStack: HexPatch[] = [];
  private options: HexEditorOptions;

  constructor(host: HTMLDivElement, options: HexEditorOptions = {}) {
    this.options = options;
    this.el = host;
    this.el.classList.add("hex-editor");
    this.el.tabIndex = 0;

    this.headerEl = document.createElement("div");
    this.headerEl.className = "hex-header";
    this.el.appendChild(this.headerEl);

    this.scrollEl = document.createElement("div");
    this.scrollEl.className = "hex-scroll";
    this.el.appendChild(this.scrollEl);

    this.spacerEl = document.createElement("div");
    this.spacerEl.className = "hex-spacer";
    this.scrollEl.appendChild(this.spacerEl);

    this.rowsEl = document.createElement("div");
    this.rowsEl.className = "hex-rows";
    this.scrollEl.appendChild(this.rowsEl);

    this.scrollEl.addEventListener("scroll", () => {
      this.render();
      this.maybeNeedMore();
      this.options.onChange?.("scroll");
    });
    this.el.addEventListener("keydown", (ev) => this.onKey(ev));
    this.rowsEl.addEventListener("mousedown", (ev) => this.onMouseDown(ev));
    window.addEventListener("mousemove", (ev) => this.onMouseMove(ev));
    window.addEventListener("mouseup", () => {
      this.dragging = false;
    });
    this.el.addEventListener("mousedown", () => this.el.focus());
  }

  setBytes(bytes: Uint8Array, totalSize: number, keepCaret = true) {
    const prev = this.offset;
    this.bytes = bytes;
    this.totalSize = Math.max(totalSize, bytes.length);
    this.undoStack = [];
    this.redoStack = [];
    if (!keepCaret) {
      this.offset = 0;
      this.nibble = 0;
      this.selEnd = 0;
    } else {
      this.offset = Math.min(prev, Math.max(0, bytes.length - 1));
      this.selEnd = this.offset;
    }
    this.render(true);
  }

  getHistory(): HexHistory {
    return { undo: this.undoStack, redo: this.redoStack };
  }

  setHistory(history: HexHistory) {
    this.undoStack = history.undo;
    this.redoStack = history.redo;
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  undo(): boolean {
    return this.applyHistory("undo");
  }

  redo(): boolean {
    return this.applyHistory("redo");
  }

  getBytes(): Uint8Array {
    return this.bytes;
  }

  getOffset(): number {
    return this.offset;
  }

  getSelection(): { start: number; end: number } {
    const start = Math.min(this.offset, this.selEnd);
    const end = Math.max(this.offset, this.selEnd);
    return { start, end: Math.max(end, start) };
  }

  layout() {
    this.render();
  }

  focus() {
    this.el.focus();
  }

  setAddressLabel(label: string, dumpLabel: string) {
    this.headerEl.replaceChildren();
    const addr = document.createElement("div");
    addr.className = "hex-addr";
    addr.textContent = label;
    this.headerEl.appendChild(addr);
    for (let i = 0; i < HEX_ROW_BYTES; i++) {
      const cell = document.createElement("div");
      cell.className = "hex-byte hex-colhead";
      cell.textContent = i.toString(16);
      this.headerEl.appendChild(cell);
    }
    const dump = document.createElement("div");
    dump.className = "hex-dump-head";
    dump.textContent = dumpLabel;
    this.headerEl.appendChild(dump);
  }

  private rowCount(): number {
    return Math.max(1, Math.ceil(Math.max(this.bytes.length, 1) / HEX_ROW_BYTES));
  }

  private spacerHeight(rows: number): number {
    return Math.min(rows * ROW_HEIGHT, MAX_SPACER);
  }

  private rowFromScroll(rows: number): number {
    const height = this.spacerHeight(rows);
    if (height <= this.scrollEl.clientHeight) {
      return 0;
    }
    const ratio = this.scrollEl.scrollTop / (height - this.scrollEl.clientHeight);
    return Math.max(0, Math.min(rows - 1, Math.floor(ratio * rows)));
  }

  private maybeNeedMore() {
    const rows = this.rowCount();
    const lastVisible = this.firstRow + this.visibleRows + OVERSCAN;
    if (lastVisible >= rows - 2 && this.bytes.length < this.totalSize) {
      this.options.onNeedMore?.();
    }
  }

  render(force = false) {
    const rows = this.rowCount();
    const height = this.spacerHeight(rows);
    this.spacerEl.style.height = `${height}px`;
    const viewH = Math.max(this.scrollEl.clientHeight, ROW_HEIGHT);
    this.visibleRows = Math.ceil(viewH / ROW_HEIGHT) + OVERSCAN * 2;
    let first = this.rowFromScroll(rows);
    first = Math.max(0, first - OVERSCAN);
    const maxFirst = Math.max(0, rows - this.visibleRows);
    first = Math.min(first, maxFirst);
    if (!force && first === this.firstRow && this.rowsEl.childElementCount) {
      this.updateSelectionClasses();
      return;
    }
    this.firstRow = first;
    const top = (first / Math.max(rows, 1)) * height;
    this.rowsEl.style.transform = `translateY(${top}px)`;

    const frag = document.createDocumentFragment();
    const last = Math.min(rows, first + this.visibleRows);
    for (let row = first; row < last; row++) {
      frag.appendChild(this.buildRow(row));
    }
    this.rowsEl.replaceChildren(frag);
  }

  private buildRow(row: number): HTMLDivElement {
    const el = document.createElement("div");
    el.className = "hex-row";
    const addrOff = row * HEX_ROW_BYTES;
    const addr = document.createElement("div");
    addr.className = "hex-addr";
    addr.textContent = padHex(addrOff, 8);
    el.appendChild(addr);

    const sliceEnd = Math.min(this.bytes.length, addrOff + HEX_ROW_BYTES);
    const slice = this.bytes.subarray(addrOff, sliceEnd);
    const dump = dumpChars(slice);

    for (let col = 0; col < HEX_ROW_BYTES; col++) {
      const off = addrOff + col;
      const cell = document.createElement("div");
      cell.className = "hex-byte";
      cell.dataset.offset = String(off);
      if (off < this.bytes.length) {
        cell.textContent = padHex(this.bytes[off], 2);
        if (this.isSelected(off)) {
          cell.classList.add("selected");
        }
        if (off === this.offset) {
          cell.classList.add("caret");
        }
      }
      el.appendChild(cell);
    }

    const dumpWrap = document.createElement("div");
    dumpWrap.className = "hex-dump";
    for (let col = 0; col < HEX_ROW_BYTES; col++) {
      const off = addrOff + col;
      const cell = document.createElement("span");
      cell.className = "hex-dump-cell";
      cell.dataset.offset = String(off);
      cell.textContent = off < this.bytes.length ? dump[col] ?? "." : "";
      if (off < this.bytes.length && this.isSelected(off)) {
        cell.classList.add("selected");
      }
      dumpWrap.appendChild(cell);
    }
    el.appendChild(dumpWrap);
    return el;
  }

  private isSelected(offset: number): boolean {
    const a = Math.min(this.offset, this.selEnd);
    const b = Math.max(this.offset, this.selEnd);
    return offset >= a && offset <= b;
  }

  private updateSelectionClasses() {
    for (const cell of this.rowsEl.querySelectorAll(".hex-byte, .hex-dump-cell")) {
      const off = Number((cell as HTMLElement).dataset.offset);
      cell.classList.toggle("selected", this.isSelected(off));
      cell.classList.toggle("caret", cell.classList.contains("hex-byte") && off === this.offset);
    }
  }

  private offsetFromEvent(ev: MouseEvent): number | null {
    const target = (ev.target as HTMLElement).closest<HTMLElement>("[data-offset]");
    if (!target) {
      return null;
    }
    const off = Number(target.dataset.offset);
    if (!Number.isFinite(off) || off < 0 || off >= this.bytes.length) {
      return null;
    }
    return off;
  }

  private onMouseDown(ev: MouseEvent) {
    const off = this.offsetFromEvent(ev);
    if (off == null) {
      return;
    }
    ev.preventDefault();
    this.el.focus();
    this.offset = off;
    this.nibble = 0;
    this.selEnd = ev.shiftKey ? this.selEnd : off;
    this.dragging = true;
    this.updateSelectionClasses();
    this.options.onChange?.("select");
  }

  private onMouseMove(ev: MouseEvent) {
    if (!this.dragging) {
      return;
    }
    const off = this.offsetFromEvent(ev);
    if (off == null) {
      return;
    }
    this.offset = off;
    this.updateSelectionClasses();
    this.options.onChange?.("select");
  }

  private clampOffset(value: number): number {
    if (this.bytes.length === 0) {
      return 0;
    }
    return Math.max(0, Math.min(this.bytes.length - 1, value));
  }

  private moveCaret(next: number, extend: boolean) {
    this.offset = this.clampOffset(next);
    this.nibble = 0;
    if (!extend) {
      this.selEnd = this.offset;
    }
    this.ensureVisible();
    this.updateSelectionClasses();
    this.options.onChange?.("select");
  }

  private ensureVisible() {
    const row = Math.floor(this.offset / HEX_ROW_BYTES);
    const rows = this.rowCount();
    const height = this.spacerHeight(rows);
    const y = (row / Math.max(rows, 1)) * height;
    const viewTop = this.scrollEl.scrollTop;
    const viewBot = viewTop + this.scrollEl.clientHeight;
    if (y < viewTop) {
      this.scrollEl.scrollTop = y;
    } else if (y + ROW_HEIGHT > viewBot) {
      this.scrollEl.scrollTop = y + ROW_HEIGHT - this.scrollEl.clientHeight;
    }
  }

  private snapshotCaret(): HexCaret {
    return { offset: this.offset, nibble: this.nibble, selEnd: this.selEnd };
  }

  private restoreCaret(caret: HexCaret) {
    this.offset = this.clampOffset(caret.offset);
    this.nibble = caret.nibble === 1 ? 1 : 0;
    this.selEnd = this.clampOffset(caret.selEnd);
  }

  private writeSlice(offset: number, data: Uint8Array) {
    if (!data.length || offset < 0 || offset >= this.bytes.length) {
      return;
    }
    const next = this.bytes.slice();
    const end = Math.min(offset + data.length, next.length);
    next.set(data.subarray(0, end - offset), offset);
    this.bytes = next;
  }

  private pushPatch(patch: HexPatch, coalesce: boolean) {
    const last = this.undoStack[this.undoStack.length - 1];
    if (
      coalesce &&
      last &&
      last.offset === patch.offset &&
      last.after.length === patch.after.length
    ) {
      last.after = patch.after;
      last.caretAfter = patch.caretAfter;
    } else {
      this.undoStack.push(patch);
      if (this.undoStack.length > MAX_HISTORY) {
        this.undoStack.shift();
      }
    }
    this.redoStack = [];
  }

  private applyHistory(direction: "undo" | "redo"): boolean {
    const from = direction === "undo" ? this.undoStack : this.redoStack;
    const to = direction === "undo" ? this.redoStack : this.undoStack;
    const patch = from.pop();
    if (!patch) {
      return false;
    }
    this.writeSlice(patch.offset, direction === "undo" ? patch.before : patch.after);
    this.restoreCaret(direction === "undo" ? patch.caretBefore : patch.caretAfter);
    to.push(patch);
    this.ensureVisible();
    this.render(true);
    this.options.onChange?.("edit");
    return true;
  }

  private commitEdit(offset: number, before: Uint8Array, caretBefore: HexCaret, coalesce = false) {
    this.pushPatch(
      {
        offset,
        before,
        after: this.bytes.slice(offset, offset + before.length),
        caretBefore,
        caretAfter: this.snapshotCaret(),
      },
      coalesce,
    );
    this.render(true);
    this.options.onChange?.("edit");
  }

  private writeNibble(nibbleValue: number) {
    if (this.bytes.length === 0) {
      return;
    }
    const caretBefore = this.snapshotCaret();
    const startOffset = this.offset;
    const startNibble = this.nibble;
    const before = this.bytes.slice(startOffset, startOffset + 1);
    const next = this.bytes.slice();
    const cur = next[startOffset];
    if (this.nibble === 0) {
      next[startOffset] = (nibbleValue << 4) | (cur & 0x0f);
      this.nibble = 1;
    } else {
      next[startOffset] = (cur & 0xf0) | nibbleValue;
      this.nibble = 0;
      this.offset = this.clampOffset(this.offset + 1);
      this.selEnd = this.offset;
    }
    this.bytes = next;
    this.commitEdit(startOffset, before, caretBefore, startNibble === 1);
  }

  private writeUtf8Char(ch: string) {
    const encoded = new TextEncoder().encode(ch);
    if (!encoded.length) {
      return;
    }
    const room = this.bytes.length - this.offset;
    if (room <= 0) {
      return;
    }
    const caretBefore = this.snapshotCaret();
    const startOffset = this.offset;
    const written = encoded.subarray(0, Math.min(encoded.length, room));
    const before = this.bytes.slice(startOffset, startOffset + written.length);
    const next = this.bytes.slice();
    next.set(written, startOffset);
    this.bytes = next;
    this.offset = this.clampOffset(this.offset + written.length);
    this.nibble = 0;
    this.selEnd = this.offset;
    this.commitEdit(startOffset, before, caretBefore);
  }

  private onKey(ev: KeyboardEvent) {
    if (ev.ctrlKey || ev.metaKey) {
      const key = ev.key.toLowerCase();
      if (key === "z" || key === "y") {
        ev.preventDefault();
        ev.stopPropagation();
        if (key === "y" || ev.shiftKey) {
          this.redo();
        } else {
          this.undo();
        }
      }
      return;
    }
    if (ev.altKey) {
      return;
    }
    const extend = ev.shiftKey;
    if (ev.key === "ArrowLeft") {
      ev.preventDefault();
      this.moveCaret(this.offset - 1, extend);
      return;
    }
    if (ev.key === "ArrowRight") {
      ev.preventDefault();
      this.moveCaret(this.offset + 1, extend);
      return;
    }
    if (ev.key === "ArrowUp") {
      ev.preventDefault();
      this.moveCaret(this.offset - HEX_ROW_BYTES, extend);
      return;
    }
    if (ev.key === "ArrowDown") {
      ev.preventDefault();
      this.moveCaret(this.offset + HEX_ROW_BYTES, extend);
      return;
    }
    if (ev.key === "PageUp") {
      ev.preventDefault();
      this.moveCaret(this.offset - HEX_ROW_BYTES * 16, extend);
      return;
    }
    if (ev.key === "PageDown") {
      ev.preventDefault();
      this.moveCaret(this.offset + HEX_ROW_BYTES * 16, extend);
      return;
    }
    if (ev.key === "Home") {
      ev.preventDefault();
      this.moveCaret(Math.floor(this.offset / HEX_ROW_BYTES) * HEX_ROW_BYTES, extend);
      return;
    }
    if (ev.key === "End") {
      ev.preventDefault();
      this.moveCaret(
        Math.min(this.bytes.length - 1, Math.floor(this.offset / HEX_ROW_BYTES) * HEX_ROW_BYTES + 15),
        extend,
      );
      return;
    }
    const hex = ev.key.match(/^[0-9a-fA-F]$/);
    if (hex) {
      ev.preventDefault();
      this.writeNibble(parseInt(ev.key, 16));
      return;
    }
    if (ev.key.length === 1) {
      ev.preventDefault();
      this.writeUtf8Char(ev.key);
    }
  }
}
