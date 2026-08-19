import { invoke } from "@tauri-apps/api/core";
import { ChevronLeft, ChevronRight, Minus, Plus } from "lucide";
import {
  getDocument,
  GlobalWorkerOptions,
  TextLayer,
  type PDFDocumentProxy,
  type PDFPageProxy,
  type RenderTask,
} from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { base64ToBytes, concatBytes, INITIAL_CHUNK } from "./bytesutil";
import { t } from "./i18n";
import { setTooltip } from "./tooltip";
import { setUiIcon } from "./ui-icon";

GlobalWorkerOptions.workerSrc = pdfWorker;

export const PDF_LANGUAGE = "pdf";
export const MAX_PDF_BYTES = 80 * 1024 * 1024;

type FileBytesChunkDto = {
  data: string;
  offset: number;
  totalSize: number;
};

const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3];
const OVERSCAN = 2;

export function isPdfPath(path: string | null | undefined): boolean {
  return !!path && /\.pdf$/i.test(path);
}

export function clampPdfZoom(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 1;
  }
  return Math.min(3, Math.max(0.5, value));
}

export function nearestPdfZoom(value: number): number {
  const zoom = clampPdfZoom(value);
  let best = ZOOM_STEPS[0];
  let dist = Math.abs(zoom - best);
  for (const step of ZOOM_STEPS) {
    const d = Math.abs(zoom - step);
    if (d < dist) {
      best = step;
      dist = d;
    }
  }
  return best;
}

async function readWholeFile(path: string): Promise<Uint8Array> {
  const first = await invoke<FileBytesChunkDto>("read_file_bytes", {
    path,
    offset: 0,
    length: INITIAL_CHUNK,
  });
  if (first.totalSize > MAX_PDF_BYTES) {
    throw new Error("too-large");
  }
  let data = base64ToBytes(first.data);
  while (data.length < first.totalSize) {
    const chunk = await invoke<FileBytesChunkDto>("read_file_bytes", {
      path,
      offset: data.length,
      length: INITIAL_CHUNK,
    });
    const more = base64ToBytes(chunk.data);
    if (!more.length) {
      break;
    }
    data = concatBytes(data, more);
  }
  return data;
}

type PageSlot = {
  el: HTMLDivElement;
  width: number;
  height: number;
  canvas: HTMLCanvasElement | null;
  textEl: HTMLDivElement | null;
  task: RenderTask | null;
  textLayer: TextLayer | null;
};

export type PdfViewerState = {
  page: number;
  scale: number;
};

export class PdfViewer {
  private readonly scrollEl: HTMLDivElement;
  private readonly pagesEl: HTMLDivElement;
  private readonly errorEl: HTMLDivElement;
  private readonly pageInput: HTMLInputElement;
  private readonly pageCountEl: HTMLSpanElement;
  private readonly zoomLabel: HTMLSpanElement;
  private readonly prevBtn: HTMLButtonElement;
  private readonly nextBtn: HTMLButtonElement;
  private readonly zoomOutBtn: HTMLButtonElement;
  private readonly zoomInBtn: HTMLButtonElement;
  private pdf: PDFDocumentProxy | null = null;
  private path: string | null = null;
  private gen = 0;
  private zoom = 1;
  private currentPage = 1;
  private slots: PageSlot[] = [];
  private fitWidth = 1;
  private onChange: (() => void) | null = null;
  private scrolling = false;

  constructor(host: HTMLElement) {
    this.scrollEl = host.querySelector("#pdf-scroll")!;
    this.pagesEl = host.querySelector("#pdf-pages")!;
    this.errorEl = host.querySelector("#pdf-error")!;
    this.pageInput = host.querySelector("#pdf-page")!;
    this.pageCountEl = host.querySelector("#pdf-page-count")!;
    this.zoomLabel = host.querySelector("#pdf-zoom-label")!;
    this.prevBtn = host.querySelector("#pdf-prev")!;
    this.nextBtn = host.querySelector("#pdf-next")!;
    this.zoomOutBtn = host.querySelector("#pdf-zoom-out")!;
    this.zoomInBtn = host.querySelector("#pdf-zoom-in")!;

    setUiIcon(this.prevBtn, ChevronLeft, { size: 16 });
    setUiIcon(this.nextBtn, ChevronRight, { size: 16 });
    setUiIcon(this.zoomOutBtn, Minus, { size: 16 });
    setUiIcon(this.zoomInBtn, Plus, { size: 16 });

    this.prevBtn.addEventListener("click", () => this.goToPage(this.currentPage - 1));
    this.nextBtn.addEventListener("click", () => this.goToPage(this.currentPage + 1));
    this.zoomOutBtn.addEventListener("click", () => this.nudgeZoom(-1));
    this.zoomInBtn.addEventListener("click", () => this.nudgeZoom(1));
    this.pageInput.addEventListener("change", () => {
      this.goToPage(Number(this.pageInput.value));
    });
    this.scrollEl.addEventListener("scroll", () => this.onScroll(), { passive: true });
    this.syncLocale();
  }

  setOnChange(handler: (() => void) | null) {
    this.onChange = handler;
  }

  syncLocale() {
    setTooltip(this.prevBtn, t("pdf.prev"));
    setTooltip(this.nextBtn, t("pdf.next"));
    setTooltip(this.zoomOutBtn, t("pdf.zoomOut"));
    setTooltip(this.zoomInBtn, t("pdf.zoomIn"));
    this.prevBtn.setAttribute("aria-label", t("pdf.prev"));
    this.nextBtn.setAttribute("aria-label", t("pdf.next"));
    this.zoomOutBtn.setAttribute("aria-label", t("pdf.zoomOut"));
    this.zoomInBtn.setAttribute("aria-label", t("pdf.zoomIn"));
  }

  capture(): PdfViewerState {
    return { page: this.currentPage, scale: this.zoom };
  }

  pageCount(): number {
    return this.pdf?.numPages ?? 0;
  }

  async open(path: string, state?: Partial<PdfViewerState>) {
    const zoom = nearestPdfZoom(state?.scale ?? this.zoom);
    const wantPage = Math.max(1, Math.floor(state?.page ?? this.currentPage));
    if (this.path === path && this.pdf) {
      this.zoom = zoom;
      this.layout();
      this.goToPage(wantPage);
      return;
    }

    const gen = ++this.gen;
    await this.reset();
    this.path = path;
    this.zoom = zoom;
    this.showError(null);
    try {
      const bytes = await readWholeFile(path);
      if (gen !== this.gen) {
        return;
      }
      const pdf = await getDocument({ data: bytes, disableAutoFetch: true }).promise;
      if (gen !== this.gen) {
        pdf.destroy();
        return;
      }
      this.pdf = pdf;
      await this.buildSlots(gen);
      if (gen !== this.gen) {
        return;
      }
      this.layout();
      this.goToPage(Math.min(wantPage, pdf.numPages));
    } catch (err) {
      if (gen !== this.gen) {
        return;
      }
      this.showError(err instanceof Error && err.message === "too-large" ? t("pdf.tooLarge") : t("pdf.badFile"));
    }
  }

  async close() {
    this.gen += 1;
    await this.reset();
  }

  private async reset() {
    for (const slot of this.slots) {
      slot.task?.cancel();
      slot.textLayer?.cancel();
    }
    this.slots = [];
    this.pagesEl.replaceChildren();
    const pdf = this.pdf;
    this.pdf = null;
    this.path = null;
    this.showError(null);
    await pdf?.destroy();
  }

  layout() {
    if (!this.pdf || !this.slots.length) {
      return;
    }
    const width = Math.max(120, this.scrollEl.clientWidth - 32);
    this.fitWidth = width / this.slots[0].width;
    const scale = this.fitWidth * this.zoom;
    for (const slot of this.slots) {
      slot.el.style.width = `${slot.width * scale}px`;
      slot.el.style.height = `${slot.height * scale}px`;
    }
    this.syncChrome();
    this.scheduleVisible();
  }

  goToPage(page: number) {
    const count = this.pageCount();
    if (!count) {
      return;
    }
    const next = Math.min(count, Math.max(1, Math.floor(page)));
    this.currentPage = next;
    const slot = this.slots[next - 1];
    if (slot) {
      this.scrolling = true;
      slot.el.scrollIntoView({ block: "start" });
      window.setTimeout(() => {
        this.scrolling = false;
      }, 80);
    }
    this.syncChrome();
    this.scheduleVisible();
    this.onChange?.();
  }

  private nudgeZoom(dir: -1 | 1) {
    const idx = ZOOM_STEPS.indexOf(nearestPdfZoom(this.zoom));
    const next = ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, Math.max(0, idx + dir))];
    if (next === this.zoom) {
      return;
    }
    this.zoom = next;
    this.layout();
    this.onChange?.();
  }

  private async buildSlots(gen: number) {
    if (!this.pdf) {
      return;
    }
    this.slots = [];
    this.pagesEl.replaceChildren();
    for (let i = 1; i <= this.pdf.numPages; i++) {
      if (gen !== this.gen) {
        return;
      }
      const page = await this.pdf.getPage(i);
      const viewport = page.getViewport({ scale: 1 });
      const el = document.createElement("div");
      el.className = "pdf-page";
      el.dataset.page = String(i);
      this.pagesEl.append(el);
      this.slots.push({
        el,
        width: viewport.width,
        height: viewport.height,
        canvas: null,
        textEl: null,
        task: null,
        textLayer: null,
      });
    }
  }

  private onScroll() {
    if (this.scrolling || !this.slots.length) {
      return;
    }
    const mid = this.scrollEl.scrollTop + this.scrollEl.clientHeight * 0.35;
    let page = 1;
    for (let i = 0; i < this.slots.length; i++) {
      const top = this.slots[i].el.offsetTop;
      if (top <= mid) {
        page = i + 1;
      } else {
        break;
      }
    }
    if (page !== this.currentPage) {
      this.currentPage = page;
      this.syncChrome();
      this.onChange?.();
    }
    this.scheduleVisible();
  }

  private scheduleVisible() {
    window.requestAnimationFrame(() => {
      void this.renderVisible();
    });
  }

  private visibleRange(): { start: number; end: number } {
    const top = this.scrollEl.scrollTop;
    const bottom = top + this.scrollEl.clientHeight;
    let start = 1;
    let end = this.slots.length;
    for (let i = 0; i < this.slots.length; i++) {
      const el = this.slots[i].el;
      const elBottom = el.offsetTop + el.offsetHeight;
      if (elBottom >= top) {
        start = i + 1;
        break;
      }
    }
    for (let i = this.slots.length - 1; i >= 0; i--) {
      const el = this.slots[i].el;
      if (el.offsetTop <= bottom) {
        end = i + 1;
        break;
      }
    }
    return {
      start: Math.max(1, start - OVERSCAN),
      end: Math.min(this.slots.length, end + OVERSCAN),
    };
  }

  private async renderVisible() {
    if (!this.pdf) {
      return;
    }
    const gen = this.gen;
    const { start, end } = this.visibleRange();
    for (let i = 1; i <= this.slots.length; i++) {
      if (i < start || i > end) {
        this.dropPage(i);
      }
    }
    for (let i = start; i <= end; i++) {
      if (gen !== this.gen) {
        return;
      }
      await this.renderPage(i);
    }
  }

  private dropPage(num: number) {
    const slot = this.slots[num - 1];
    if (!slot?.canvas) {
      return;
    }
    slot.task?.cancel();
    slot.textLayer?.cancel();
    slot.task = null;
    slot.textLayer = null;
    slot.canvas = null;
    slot.textEl = null;
    slot.el.replaceChildren();
  }

  private async renderPage(num: number) {
    const slot = this.slots[num - 1];
    if (!this.pdf || !slot || slot.canvas || slot.task) {
      return;
    }
    const scale = this.fitWidth * this.zoom;
    let page: PDFPageProxy;
    try {
      page = await this.pdf.getPage(num);
    } catch {
      return;
    }
    const viewport = page.getViewport({ scale });
    const output = window.devicePixelRatio || 1;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }
    canvas.width = Math.floor(viewport.width * output);
    canvas.height = Math.floor(viewport.height * output);
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;
    const task = page.render({
      canvasContext: ctx,
      viewport,
      transform: output === 1 ? undefined : [output, 0, 0, output, 0, 0],
    });
    slot.task = task;
    try {
      await task.promise;
    } catch {
      slot.task = null;
      return;
    }
    if (slot.task !== task) {
      return;
    }
    const textEl = document.createElement("div");
    textEl.className = "pdf-text-layer";
    textEl.style.setProperty("--scale-factor", String(viewport.scale));
    const textLayer = new TextLayer({
      textContentSource: page.streamTextContent(),
      container: textEl,
      viewport,
    });
    slot.textLayer = textLayer;
    try {
      await textLayer.render();
    } catch {
      // Selection layer is optional; the page bitmap is enough to read.
    }
    slot.canvas = canvas;
    slot.textEl = textEl;
    slot.task = null;
    slot.el.replaceChildren(canvas, textEl);
  }

  private syncChrome() {
    const count = this.pageCount();
    this.pageCountEl.textContent = String(count);
    this.pageInput.max = String(Math.max(1, count));
    this.pageInput.value = String(this.currentPage);
    this.zoomLabel.textContent = `${Math.round(this.zoom * 100)}%`;
    this.prevBtn.disabled = this.currentPage <= 1;
    this.nextBtn.disabled = this.currentPage >= count;
  }

  private showError(message: string | null) {
    this.errorEl.hidden = !message;
    this.errorEl.textContent = message ?? "";
    this.pagesEl.hidden = !!message;
  }
}
