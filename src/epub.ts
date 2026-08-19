import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { unzip } from "fflate";
import { ChevronLeft, ChevronRight, Minus, Plus } from "lucide";
import { base64ToBytes, concatBytes, INITIAL_CHUNK } from "./bytesutil";
import { t } from "./i18n";
import { setTooltip } from "./tooltip";
import { setUiIcon } from "./ui-icon";

export const EPUB_LANGUAGE = "epub";
export const MAX_EPUB_BYTES = 80 * 1024 * 1024;

const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3];

type FileBytesChunkDto = {
  data: string;
  offset: number;
  totalSize: number;
};

type ZipFiles = Record<string, Uint8Array>;

type SpineItem = {
  id: string;
  href: string;
  mediaType: string;
};

export type EpubViewerState = {
  page: number;
  scale: number;
};

export function isEpubPath(path: string | null | undefined): boolean {
  return !!path && /\.epub$/i.test(path);
}

function clampZoom(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 1;
  }
  return Math.min(3, Math.max(0.5, value));
}

function nearestZoom(value: number): number {
  const zoom = clampZoom(value);
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
  if (first.totalSize > MAX_EPUB_BYTES) {
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

function unzipBytes(data: Uint8Array): Promise<ZipFiles> {
  const copy = data.byteOffset === 0 && data.byteLength === data.buffer.byteLength
    ? data
    : data.slice();
  return new Promise((resolve, reject) => {
    unzip(copy, (err, files) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(files);
    });
  });
}

function zipKey(path: string) {
  return path.replace(/\\/g, "/").replace(/^\/+/, "");
}

function zipGet(files: ZipFiles, path: string): Uint8Array | undefined {
  const key = zipKey(path);
  if (files[key]) {
    return files[key];
  }
  const lower = key.toLowerCase();
  for (const [name, bytes] of Object.entries(files)) {
    if (zipKey(name).toLowerCase() === lower) {
      return bytes;
    }
  }
  return undefined;
}

function dirnameZip(path: string) {
  const key = zipKey(path);
  const idx = key.lastIndexOf("/");
  return idx < 0 ? "" : key.slice(0, idx);
}

function joinZip(baseDir: string, rel: string) {
  const raw = rel.trim().split(/[?#]/)[0];
  if (!raw) {
    return zipKey(baseDir);
  }
  const rooted = raw.startsWith("/") ? raw.slice(1) : `${baseDir ? `${baseDir}/` : ""}${raw}`;
  const parts: string[] = [];
  for (const part of zipKey(rooted).split("/")) {
    if (!part || part === ".") {
      continue;
    }
    if (part === "..") {
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return parts.join("/");
}

function decodeUtf8(bytes: Uint8Array) {
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

function localName(el: Element) {
  return el.localName.toLowerCase();
}

function allByName(root: Document | Element, name: string): Element[] {
  return [...root.getElementsByTagName("*")].filter((el) => localName(el) === name);
}

function mimeFor(path: string, fallback = "application/octet-stream") {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    case "xhtml":
    case "html":
    case "htm":
      return "application/xhtml+xml";
    case "css":
      return "text/css";
    case "js":
      return "text/javascript";
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "svg":
      return "image/svg+xml";
    case "webp":
      return "image/webp";
    case "avif":
      return "image/avif";
    case "bmp":
      return "image/bmp";
    case "woff":
      return "font/woff";
    case "woff2":
      return "font/woff2";
    case "ttf":
      return "font/ttf";
    case "otf":
      return "font/otf";
    case "mp3":
      return "audio/mpeg";
    case "mp4":
      return "video/mp4";
    default:
      return fallback;
  }
}

function isHtmlPath(path: string) {
  return /\.(xhtml|html|htm)$/i.test(path);
}

function isSafeExternalUrl(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" || parsed.protocol === "mailto:" || parsed.protocol === "tel:";
  } catch {
    return false;
  }
}

function normalizeExternalHref(href: string) {
  const raw = href.trim();
  if (!raw) {
    return null;
  }
  const url = raw.startsWith("//") ? `https:${raw}` : raw;
  return isSafeExternalUrl(url) ? url : null;
}

async function openExternalUrl(url: string) {
  try {
    await openUrl(url);
  } catch (err) {
    console.warn("failed to open external link", err);
  }
}

function parseMarkup(text: string): Document {
  const xhtml = new DOMParser().parseFromString(text, "application/xhtml+xml");
  if (!xhtml.querySelector("parsererror")) {
    return xhtml;
  }
  return new DOMParser().parseFromString(text, "text/html");
}

function stripActiveContent(doc: Document) {
  for (const el of [...doc.getElementsByTagName("*")]) {
    const name = localName(el);
    if (
      name === "script" ||
      name === "iframe" ||
      name === "object" ||
      name === "embed" ||
      name === "form" ||
      name === "base"
    ) {
      el.remove();
      continue;
    }
    if (name === "link") {
      const rel = (el.getAttribute("rel") ?? "").toLowerCase();
      if (rel.includes("preload") || rel.includes("modulepreload") || rel.includes("prefetch")) {
        el.remove();
        continue;
      }
    }
    if (name === "meta" && (el.getAttribute("http-equiv") ?? "").toLowerCase() === "refresh") {
      el.remove();
      continue;
    }
    for (const attr of [...el.attributes]) {
      const attrName = attr.name.toLowerCase();
      if (attrName.startsWith("on") || attrName === "srcdoc" || /^(javascript|vbscript|data):/i.test(attr.value.trim())) {
        el.removeAttribute(attr.name);
      }
    }
  }
}

function themeSheet(scale: number) {
  const s = getComputedStyle(document.documentElement);
  const bg = s.getPropertyValue("--bg").trim() || "#1e1e1e";
  const text = s.getPropertyValue("--text").trim() || "#cccccc";
  const dim = s.getPropertyValue("--text-dim").trim() || "#9d9d9d";
  const accent = s.getPropertyValue("--tab-active-title").trim() || "#4fc1ff";
  const size = Math.round(18 * scale);
  return `html,body{margin:0;padding:0;background:${bg};color:${text};font: ${size}px/1.7 "Segoe UI","PingFang SC","Microsoft YaHei",serif;}
body{padding:28px 36px 64px;max-width:42rem;margin:0 auto;word-wrap:break-word;}
img,svg,video,canvas{max-width:100%;height:auto;}
a{color:${accent};cursor:pointer;text-decoration:underline;}
h1,h2,h3,h4{line-height:1.3;}
p{margin:0.8em 0;}
code,pre{font-family:Consolas,ui-monospace,monospace;}
pre{overflow:auto;}
nav,aside{color:${dim};}`;
}

function rewriteCssUrls(css: string, filePath: string, resolveUrl: (from: string, href: string) => string) {
  return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (full, _q: string, raw: string) => {
    const href = raw.trim();
    if (!href || /^(data:|https?:|blob:|#)/i.test(href)) {
      return full;
    }
    return `url("${resolveUrl(filePath, href)}")`;
  });
}

export class EpubViewer {
  private readonly frame: HTMLIFrameElement;
  private readonly errorEl: HTMLDivElement;
  private readonly pageInput: HTMLInputElement;
  private readonly pageCountEl: HTMLSpanElement;
  private readonly zoomLabel: HTMLSpanElement;
  private readonly prevBtn: HTMLButtonElement;
  private readonly nextBtn: HTMLButtonElement;
  private readonly zoomOutBtn: HTMLButtonElement;
  private readonly zoomInBtn: HTMLButtonElement;
  private path: string | null = null;
  private gen = 0;
  private zoom = 1;
  private currentPage = 1;
  private files: ZipFiles = {};
  private spine: SpineItem[] = [];
  private blobs = new Map<string, string>();
  private chapterBlob: string | null = null;
  private pendingHash = "";
  private restoringFrame = false;
  private onChange: (() => void) | null = null;

  constructor(host: HTMLElement) {
    this.frame = host.querySelector("#epub-frame")!;
    this.errorEl = host.querySelector("#epub-error")!;
    this.pageInput = host.querySelector("#epub-page")!;
    this.pageCountEl = host.querySelector("#epub-page-count")!;
    this.zoomLabel = host.querySelector("#epub-zoom-label")!;
    this.prevBtn = host.querySelector("#epub-prev")!;
    this.nextBtn = host.querySelector("#epub-next")!;
    this.zoomOutBtn = host.querySelector("#epub-zoom-out")!;
    this.zoomInBtn = host.querySelector("#epub-zoom-in")!;

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
    this.frame.addEventListener("load", () => {
      this.guardFrameLocation();
      this.bindFrame();
    });
    this.syncLocale();
  }

  setOnChange(handler: (() => void) | null) {
    this.onChange = handler;
  }

  syncLocale() {
    setTooltip(this.prevBtn, t("epub.prev"));
    setTooltip(this.nextBtn, t("epub.next"));
    setTooltip(this.zoomOutBtn, t("epub.zoomOut"));
    setTooltip(this.zoomInBtn, t("epub.zoomIn"));
    this.prevBtn.setAttribute("aria-label", t("epub.prev"));
    this.nextBtn.setAttribute("aria-label", t("epub.next"));
    this.zoomOutBtn.setAttribute("aria-label", t("epub.zoomOut"));
    this.zoomInBtn.setAttribute("aria-label", t("epub.zoomIn"));
  }

  capture(): EpubViewerState {
    return { page: this.currentPage, scale: this.zoom };
  }

  pageCount(): number {
    return this.spine.length;
  }

  async open(path: string, state?: Partial<EpubViewerState>) {
    const zoom = nearestZoom(state?.scale ?? this.zoom);
    const wantPage = Math.max(1, Math.floor(state?.page ?? this.currentPage));
    if (this.path === path && this.spine.length) {
      this.zoom = zoom;
      this.goToPage(wantPage);
      return;
    }

    const gen = ++this.gen;
    this.reset();
    this.path = path;
    this.zoom = zoom;
    this.showError(null);
    try {
      const bytes = await readWholeFile(path);
      if (gen !== this.gen) {
        return;
      }
      this.files = await unzipBytes(bytes);
      this.spine = this.parseSpine();
      if (!this.spine.length) {
        throw new Error("empty");
      }
      this.goToPage(Math.min(wantPage, this.spine.length));
    } catch (err) {
      if (gen !== this.gen) {
        return;
      }
      this.showError(
        err instanceof Error && err.message === "too-large" ? t("epub.tooLarge") : t("epub.badFile"),
      );
    }
  }

  private parseSpine(): SpineItem[] {
    const container = zipGet(this.files, "META-INF/container.xml");
    if (!container) {
      throw new Error("container");
    }
    const containerDoc = new DOMParser().parseFromString(decodeUtf8(container), "application/xml");
    const rootfile = allByName(containerDoc, "rootfile")[0];
    const opfPath = rootfile?.getAttribute("full-path");
    if (!opfPath) {
      throw new Error("opf");
    }
    const opfBytes = zipGet(this.files, opfPath);
    if (!opfBytes) {
      throw new Error("opf-missing");
    }
    const opfDir = dirnameZip(opfPath);
    const opf = new DOMParser().parseFromString(decodeUtf8(opfBytes), "application/xml");
    const items = new Map<string, SpineItem>();
    for (const item of allByName(opf, "item")) {
      const id = item.getAttribute("id") ?? "";
      const href = item.getAttribute("href") ?? "";
      if (!id || !href) {
        continue;
      }
      items.set(id, {
        id,
        href: joinZip(opfDir, href),
        mediaType: item.getAttribute("media-type") ?? mimeFor(href),
      });
    }
    const spine: SpineItem[] = [];
    for (const ref of allByName(opf, "itemref")) {
      const idref = ref.getAttribute("idref") ?? "";
      const item = items.get(idref);
      if (item && (item.mediaType.includes("html") || isHtmlPath(item.href))) {
        spine.push(item);
      }
    }
    return spine;
  }

  private blobUrl(path: string, mediaType?: string): string | null {
    const existing = this.blobs.get(path);
    if (existing) {
      return existing;
    }
    const bytes = zipGet(this.files, path);
    if (!bytes) {
      return null;
    }
    const type = mediaType ?? mimeFor(path);
    this.blobs.set(path, "");
    let payload: BlobPart = bytes;
    if (type === "text/css") {
      payload = rewriteCssUrls(decodeUtf8(bytes), path, (from, href) => {
        const target = joinZip(dirnameZip(from), href);
        if (/\.css$/i.test(target)) {
          return href;
        }
        return this.blobUrl(target) ?? href;
      });
    }
    const url = URL.createObjectURL(new Blob([payload as BlobPart], { type }));
    this.blobs.set(path, url);
    return url;
  }

  private resolveHref(from: string, href: string) {
    const [file, hash] = href.split("#");
    if (!file) {
      return { path: from, hash: hash ?? "" };
    }
    return { path: joinZip(dirnameZip(from), file), hash: hash ?? "" };
  }

  private rewriteDocument(doc: Document, chapterPath: string) {
    stripActiveContent(doc);
    const rewriteAttr = (el: Element, attr: string) => {
      const raw = el.getAttribute(attr);
      if (!raw || /^(data:|https?:|blob:|mailto:)/i.test(raw)) {
        return;
      }
      const { path, hash } = this.resolveHref(chapterPath, raw);
      if (localName(el) === "a" || localName(el) === "area") {
        return;
      }
      const url = this.blobUrl(path);
      if (url) {
        el.setAttribute(attr, hash ? `${url}#${hash}` : url);
      }
    };
    for (const el of [...doc.querySelectorAll("a, area")]) {
      el.removeAttribute("target");
      const raw =
        el.getAttribute("href") ??
        el.getAttributeNS("http://www.w3.org/1999/xlink", "href") ??
        "";
      el.removeAttribute("href");
      el.removeAttributeNS("http://www.w3.org/1999/xlink", "href");
      el.setAttribute("role", "link");
      el.setAttribute("tabindex", "0");
      if (!raw || raw === "#") {
        continue;
      }
      const external = normalizeExternalHref(raw);
      if (external) {
        el.setAttribute("data-epub-external", external);
        el.setAttribute("title", external);
        continue;
      }
      const { path, hash } = this.resolveHref(chapterPath, raw);
      if (hash) {
        el.setAttribute("data-epub-hash", hash);
      }
      if (raw.startsWith("#")) {
        continue;
      }
      el.setAttribute("data-epub-path", path);
    }
    for (const el of [...doc.querySelectorAll("[src], [href], [poster]")]) {
      if (localName(el) === "a" || localName(el) === "area") {
        continue;
      }
      if (el.hasAttribute("src")) {
        rewriteAttr(el, "src");
      }
      if (el.hasAttribute("href")) {
        rewriteAttr(el, "href");
      }
      if (el.hasAttribute("poster")) {
        rewriteAttr(el, "poster");
      }
    }
    const csp = doc.createElement("meta");
    csp.setAttribute("http-equiv", "Content-Security-Policy");
    csp.setAttribute(
      "content",
      "default-src 'none'; img-src blob: data:; style-src 'unsafe-inline' blob: data:; font-src blob: data:; media-src blob: data:; script-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none';",
    );
    const style = doc.createElement("style");
    style.textContent = themeSheet(this.zoom);
    const head = doc.head ?? doc.documentElement;
    head.prepend(style);
    head.prepend(csp);
  }

  private showChapter() {
    const item = this.spine[this.currentPage - 1];
    this.syncChrome();
    if (!item) {
      return;
    }
    const bytes = zipGet(this.files, item.href);
    if (!bytes) {
      this.showError(t("epub.badFile"));
      return;
    }
    this.showError(null);
    const doc = parseMarkup(decodeUtf8(bytes));
    this.rewriteDocument(doc, item.href);
    const html = `<!DOCTYPE html>${doc.documentElement?.outerHTML ?? ""}`;
    if (this.chapterBlob) {
      URL.revokeObjectURL(this.chapterBlob);
    }
    this.chapterBlob = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    this.frame.removeAttribute("srcdoc");
    this.frame.src = this.chapterBlob;
  }

  private scrollToHash(doc: Document, hash: string) {
    const id = decodeURIComponent(hash).trim();
    if (!id) {
      return;
    }
    const escaped = CSS.escape(id);
    const el =
      doc.getElementById(id) ||
      doc.querySelector(`[name="${escaped}"]`) ||
      doc.querySelector(`[id="${escaped}"]`);
    el?.scrollIntoView({ block: "start" });
  }

  private openInternal(path: string, hash: string) {
    const current = this.spine[this.currentPage - 1];
    const index = this.spine.findIndex((item) => item.href === path);
    if (index < 0 || index + 1 === this.currentPage || current?.href === path) {
      const doc = this.frame.contentDocument;
      if (doc && hash) {
        this.scrollToHash(doc, hash);
      }
      return;
    }
    this.pendingHash = hash;
    this.goToPage(index + 1);
  }

  private guardFrameLocation() {
    if (this.restoringFrame) {
      this.restoringFrame = false;
      return;
    }
    if (!this.chapterBlob || !this.spine.length) {
      return;
    }
    let href = "";
    try {
      href = this.frame.contentWindow?.location.href ?? "";
    } catch {
      return;
    }
    if (href === this.chapterBlob || href.startsWith(`${this.chapterBlob}#`)) {
      return;
    }
    this.restoringFrame = true;
    this.showChapter();
  }

  private bindFrame() {
    const doc = this.frame.contentDocument;
    if (!doc) {
      return;
    }
    const onNav = (ev: Event) => {
      const link = (ev.target as Element | null)?.closest?.("a, area");
      if (!(link instanceof Element)) {
        return;
      }
      ev.preventDefault();
      ev.stopPropagation();
      if ("stopImmediatePropagation" in ev) {
        ev.stopImmediatePropagation();
      }
      const external = link.getAttribute("data-epub-external");
      if (external && isSafeExternalUrl(external)) {
        void openExternalUrl(external);
        return;
      }
      const target = link.getAttribute("data-epub-path");
      const hash = link.getAttribute("data-epub-hash") ?? "";
      if (target) {
        this.openInternal(target, hash);
        return;
      }
      if (hash) {
        this.scrollToHash(doc, hash);
      }
    };
    doc.addEventListener("click", onNav, true);
    doc.addEventListener("auxclick", onNav, true);
    doc.addEventListener("keydown", (ev) => {
      const link = (ev.target as Element | null)?.closest?.("a, area");
      if (link instanceof Element && (ev.key === "Enter" || ev.key === " ")) {
        onNav(ev);
        return;
      }
      if (ev.key === "ArrowLeft") {
        ev.preventDefault();
        this.goToPage(this.currentPage - 1);
      } else if (ev.key === "ArrowRight") {
        ev.preventDefault();
        this.goToPage(this.currentPage + 1);
      }
    });
    if (this.pendingHash) {
      const hash = this.pendingHash;
      this.pendingHash = "";
      requestAnimationFrame(() => this.scrollToHash(doc, hash));
    }
  }

  private goToPage(page: number) {
    if (!this.spine.length) {
      return;
    }
    const next = Math.min(this.spine.length, Math.max(1, Math.floor(page) || 1));
    this.currentPage = next;
    this.showChapter();
    this.onChange?.();
  }

  private nudgeZoom(delta: number) {
    this.zoom = nearestZoom(this.zoom * (delta < 0 ? 0.8 : 1.25));
    this.zoom = clampZoom(this.zoom);
    this.showChapter();
    this.onChange?.();
  }

  private syncChrome() {
    const count = this.spine.length;
    this.pageCountEl.textContent = String(count);
    this.pageInput.value = String(this.currentPage);
    this.pageInput.max = String(Math.max(1, count));
    this.zoomLabel.textContent = `${Math.round(this.zoom * 100)}%`;
    this.prevBtn.disabled = this.currentPage <= 1;
    this.nextBtn.disabled = this.currentPage >= count;
  }

  private showError(message: string | null) {
    this.errorEl.hidden = !message;
    this.errorEl.textContent = message ?? "";
    this.frame.hidden = !!message;
  }

  private reset() {
    this.frame.removeAttribute("srcdoc");
    this.frame.removeAttribute("src");
    this.spine = [];
    this.files = {};
    this.pendingHash = "";
    if (this.chapterBlob) {
      URL.revokeObjectURL(this.chapterBlob);
      this.chapterBlob = null;
    }
    for (const url of this.blobs.values()) {
      URL.revokeObjectURL(url);
    }
    this.blobs.clear();
    this.path = null;
    this.currentPage = 1;
  }
}
