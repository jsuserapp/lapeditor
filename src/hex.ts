import { dumpChars, padHex } from "./bytesutil";

export const HEX_ROW_BYTES = 16;
const ROW_HEIGHT = 22;
const OVERSCAN = 12;
const MAX_SPACER = 20_000_000;

export type HexChangeKind = "edit" | "select" | "scroll";

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

  private writeNibble(nibbleValue: number) {
    if (this.bytes.length === 0) {
      return;
    }
    const next = this.bytes.slice();
    const cur = next[this.offset];
    if (this.nibble === 0) {
      next[this.offset] = (nibbleValue << 4) | (cur & 0x0f);
      this.nibble = 1;
    } else {
      next[this.offset] = (cur & 0xf0) | nibbleValue;
      this.nibble = 0;
      this.offset = this.clampOffset(this.offset + 1);
      this.selEnd = this.offset;
    }
    this.bytes = next;
    this.render(true);
    this.options.onChange?.("edit");
  }

  private writeUtf8Char(ch: string) {
    const encoded = new TextEncoder().encode(ch);
    if (!encoded.length || this.offset + encoded.length > this.bytes.length) {
      if (!encoded.length) {
        return;
      }
      const room = this.bytes.length - this.offset;
      if (room <= 0) {
        return;
      }
      const next = this.bytes.slice();
      next.set(encoded.subarray(0, room), this.offset);
      this.bytes = next;
    } else {
      const next = this.bytes.slice();
      next.set(encoded, this.offset);
      this.bytes = next;
    }
    this.offset = this.clampOffset(this.offset + encoded.length);
    this.nibble = 0;
    this.selEnd = this.offset;
    this.render(true);
    this.options.onChange?.("edit");
  }

  private onKey(ev: KeyboardEvent) {
    if (ev.ctrlKey || ev.metaKey || ev.altKey) {
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
