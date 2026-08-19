import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { marked } from "marked";
import markedKatex from "marked-katex-extension";
import "katex/dist/katex.min.css";
import { bytesToBase64 } from "./bytesutil";
import type { ThemeId } from "./theme";

marked.setOptions({
  gfm: true,
  breaks: true,
});

marked.use(
  markedKatex({
    throwOnError: false,
    strict: false,
    nonStandard: true,
  }),
);

marked.use({
  renderer: {
    code({ text, lang }: { text: string; lang?: string }) {
      const language = (lang ?? "").trim().split(/\s+/)[0] ?? "";
      if (language === "mermaid") {
        const el = document.createElement("pre");
        el.className = "md-mermaid";
        el.textContent = text;
        return el.outerHTML;
      }
      const pre = document.createElement("pre");
      const code = document.createElement("code");
      if (language) {
        code.className = `language-${language}`;
      }
      code.textContent = text;
      pre.appendChild(code);
      return pre.outerHTML;
    },
  },
});

export function isMarkdownLanguage(languageId: string | undefined): boolean {
  return languageId === "markdown";
}

function normalizeMathDelimiters(text: string): string {
  const chunks: string[] = [];
  const stash = (match: string) => {
    const key = `%%MATH${chunks.length}%%`;
    chunks.push(match);
    return key;
  };
  let out = text.replace(/\$\$[\s\S]+?\$\$/g, stash);
  out = out.replace(/(?<!\$)\$(?!\$)(?:\\\$|[^$\n])+?\$(?!\$)/g, stash);
  out = out.replace(/\\\[([\s\S]*?)\\\]/g, (_m, inner: string) => `$$\n${inner.trim()}\n$$`);
  out = out.replace(/\\\(([\s\S]*?)\\\)/g, (_m, inner: string) => `$${inner.trim()}$`);
  return out.replace(/%%MATH(\d+)%%/g, (_m, index: string) => chunks[Number(index)] ?? "");
}

function newlineCount(text: string): number {
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      n++;
    }
  }
  return n;
}

function injectSourceLines(html: string, startLine: number, endLine: number): string {
  const trimmed = html.trim();
  if (!trimmed.startsWith("<")) {
    return html;
  }
  return trimmed.replace(
    /^<([a-zA-Z][\w:-]*)/,
    `<$1 data-source-line="${startLine}" data-source-line-end="${endLine}"`,
  );
}

function wrapSpacedMdDestinations(source: string): string {
  return source.replace(/!\[([^\]]*)\]\(([^)\n]+)\)/g, (full, alt: string, inner: string) => {
    const trimmed = inner.trim();
    if (trimmed.startsWith("<")) {
      return full;
    }
    if (/^\S+(?:\s+("[^"]*"|'[^']*'|\([^)]*\)))?\s*$/.test(trimmed)) {
      return full;
    }
    const withTitle = trimmed.match(/^(.*?)(\s+("[^"]*"|'[^']*'|\([^)]*\)))\s*$/);
    if (withTitle) {
      return `![${alt}](<${withTitle[1].trim()}>${withTitle[2]})`;
    }
    return `![${alt}](<${trimmed}>)`;
  });
}

function mapOutsideCode(source: string, fn: (chunk: string) => string): string {
  const parts: string[] = [];
  const re = /(```[\s\S]*?```|`[^`\n]+`)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source))) {
    parts.push(fn(source.slice(last, match.index)));
    parts.push(match[0]);
    last = match.index + match[0].length;
  }
  parts.push(fn(source.slice(last)));
  return parts.join("");
}

function joinPath(base: string, rel: string): string {
  const windows = /\\/.test(base) || /^[a-zA-Z]:[\\/]/.test(rel);
  const relNorm = rel.replace(/\\/g, "/");
  if (/^[a-zA-Z]:[\\/]/.test(rel) || relNorm.startsWith("//") || rel.startsWith("\\\\")) {
    return rel;
  }
  if (relNorm.startsWith("/") && !/^[a-zA-Z]:/.test(base)) {
    return relNorm;
  }
  const parts = base.replace(/\\/g, "/").split("/").filter((p, i) => p !== "" || i === 0);
  for (const seg of relNorm.split("/")) {
    if (!seg || seg === ".") {
      continue;
    }
    if (seg === "..") {
      if (parts.length > 1 || (parts[0] && !/^[a-zA-Z]:$/.test(parts[0]))) {
        parts.pop();
      }
      continue;
    }
    parts.push(seg);
  }
  let joined = parts.join("/");
  if (windows) {
    joined = joined.replace(/\//g, "\\");
  }
  return joined;
}

function decodeHref(href: string): string {
  const trimmed = href.trim();
  try {
    return decodeURI(trimmed);
  } catch {
    return trimmed;
  }
}

function isRemoteHref(href: string): boolean {
  return /^(https?:|data:|blob:|asset:)/i.test(href);
}

function localFilePath(href: string, baseDir: string | null): string | null {
  let path = decodeHref(href);
  if (path.startsWith("file:")) {
    try {
      path = decodeURIComponent(path.replace(/^file:\/\//i, "").replace(/^\/([a-zA-Z]:)/, "$1"));
    } catch {
      path = path.replace(/^file:\/\//i, "");
    }
  }
  if (
    !/^[a-zA-Z]:[\\/]/.test(path) &&
    !path.startsWith("\\\\") &&
    !(path.startsWith("/") && !baseDir?.includes("\\"))
  ) {
    if (!baseDir) {
      return null;
    }
    path = joinPath(baseDir, path);
  }
  return path;
}

const BROKEN_IMAGE_SRC =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72" viewBox="0 0 72 72">
      <rect x="8" y="14" width="56" height="44" rx="4" fill="none" stroke="#8b8b8b" stroke-width="2"/>
      <path d="M14 52l16-18 10 12 8-8 10 14" fill="none" stroke="#8b8b8b" stroke-width="2"/>
      <circle cx="26" cy="28" r="4" fill="#8b8b8b"/>
      <path d="M16 16l40 40" stroke="#c74e39" stroke-width="2.5" stroke-linecap="round"/>
    </svg>`,
  );

export function renderMarkdown(source: string): string {
  const prepared = mapOutsideCode(source, wrapSpacedMdDestinations);
  const normalized = normalizeMathDelimiters(prepared);
  const tokens = marked.lexer(normalized);
  let line = 0;
  const parts: string[] = [];
  for (const token of tokens) {
    if (token.type === "space") {
      line += newlineCount(token.raw);
      continue;
    }
    const startLine = line + 1;
    const newlines = newlineCount(token.raw);
    const endLine =
      startLine + Math.max(0, newlines - (token.raw.endsWith("\n") ? 1 : 0));
    const html = marked.parser([token]);
    parts.push(injectSourceLines(html, startLine, Math.max(startLine, endLine)));
    line += newlines;
  }
  return parts.join("");
}

function previewSelectionText(root: HTMLElement): string {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
    return "";
  }
  const node = sel.anchorNode;
  if (!node || !root.contains(node)) {
    return "";
  }
  return sel.toString();
}

function previewHasSelection(root: HTMLElement): boolean {
  return previewSelectionText(root).length > 0;
}

function contextMenuRoot() {
  return document.querySelector<HTMLDivElement>("#md-preview-context-menu");
}

function copyMenuBtn() {
  return document.querySelector<HTMLButtonElement>("#md-ctx-copy");
}

function copyImageMenuBtn() {
  return document.querySelector<HTMLButtonElement>("#md-ctx-copy-image");
}

export function hideMdPreviewContextMenu() {
  const menu = contextMenuRoot();
  if (menu) {
    menu.hidden = true;
  }
}

function placeContextMenu(menu: HTMLElement, clientX: number, clientY: number) {
  menu.hidden = false;
  const pad = 8;
  const rect = menu.getBoundingClientRect();
  const left = Math.min(clientX, window.innerWidth - rect.width - pad);
  const top = Math.min(clientY, window.innerHeight - rect.height - pad);
  menu.style.left = `${Math.max(pad, left)}px`;
  menu.style.top = `${Math.max(pad, top)}px`;
}

function copyableImage(target: EventTarget | null, root: HTMLElement): HTMLImageElement | SVGSVGElement | null {
  if (!(target instanceof Element) || !root.contains(target)) {
    return null;
  }
  const img = target.closest("img");
  if (img && root.contains(img) && img.dataset.imgFailed !== "1") {
    return img;
  }
  const svg = target.closest("svg");
  if (svg instanceof SVGSVGElement && svg.closest(".md-mermaid-svg") && root.contains(svg)) {
    return svg;
  }
  return null;
}

async function writeClipboardText(text: string) {
  await invoke("write_clipboard", { text });
}

async function rasterizeToClipboard(source: HTMLImageElement | SVGSVGElement) {
  if (source instanceof HTMLImageElement && source.dataset.localPath) {
    try {
      await invoke("write_clipboard_image_file", { path: source.dataset.localPath });
      return;
    } catch (err) {
      console.warn("failed to copy image file, falling back to canvas", err);
    }
  }
  const bitmap = await rasterizeElement(source);
  await invoke("write_clipboard_image", bitmap);
}

async function rasterizeElement(source: HTMLImageElement | SVGSVGElement): Promise<{
  width: number;
  height: number;
  data: string;
}> {
  const image = source instanceof HTMLImageElement ? source : await svgToImage(source);
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  if (!width || !height) {
    throw new Error("image has no size");
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("canvas unavailable");
  }
  ctx.drawImage(image, 0, 0);
  const pixels = ctx.getImageData(0, 0, width, height).data;
  return { width, height, data: bytesToBase64(new Uint8Array(pixels)) };
}

function svgToImage(svg: SVGSVGElement): Promise<HTMLImageElement> {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const rect = svg.getBoundingClientRect();
  const scale = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round((rect.width || svg.clientWidth || 300) * scale));
  const height = Math.max(1, Math.round((rect.height || svg.clientHeight || 150) * scale));
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));
  const xml = new XMLSerializer().serializeToString(clone);
  const blob = new Blob([xml], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("failed to rasterize svg"));
    };
    img.src = url;
  });
}

export function mountMarkdownHtml(host: HTMLElement, html: string, baseDir: string | null = null) {
  host.innerHTML = html;
  for (const a of host.querySelectorAll("a[href]")) {
    const href = a.getAttribute("href") ?? "";
    if (/^\s*(javascript|data|vbscript):/i.test(href)) {
      a.removeAttribute("href");
      continue;
    }
    a.setAttribute("target", "_blank");
    a.setAttribute("rel", "noopener noreferrer");
  }
  for (const img of host.querySelectorAll("img")) {
    img.setAttribute("draggable", "false");
    const href = img.getAttribute("src") ?? "";
    if (href && !isRemoteHref(href)) {
      const path = localFilePath(href, baseDir);
      if (path) {
        img.dataset.localPath = path;
        img.src = convertFileSrc(path);
      }
    }
    img.addEventListener("error", () => {
      if (img.dataset.imgFailed === "1") {
        return;
      }
      img.dataset.imgFailed = "1";
      img.classList.add("md-img-error");
      img.src = BROKEN_IMAGE_SRC;
    });
  }
}

function mermaidTheme(theme: ThemeId): "dark" | "default" {
  return theme === "dark" ? "dark" : "default";
}

async function renderMermaidBlocks(root: HTMLElement, theme: ThemeId) {
  const nodes = [...root.querySelectorAll<HTMLElement>("pre.md-mermaid")];
  if (nodes.length === 0) {
    return;
  }
  const mermaid = (await import("mermaid")).default;
  mermaid.initialize({
    startOnLoad: false,
    theme: mermaidTheme(theme),
    securityLevel: "strict",
  });
  for (const [index, el] of nodes.entries()) {
    const source = (el.textContent ?? "").trim();
    if (!source) {
      continue;
    }
    try {
      const id = `lap-mermaid-${Date.now()}-${index}`;
      const { svg } = await mermaid.render(id, source);
      const wrap = document.createElement("div");
      wrap.className = "md-mermaid-svg";
      const start = el.getAttribute("data-source-line");
      const end = el.getAttribute("data-source-line-end");
      if (start) {
        wrap.setAttribute("data-source-line", start);
      }
      if (end) {
        wrap.setAttribute("data-source-line-end", end);
      }
      wrap.innerHTML = svg;
      el.replaceWith(wrap);
    } catch {
      el.classList.add("md-mermaid-error");
    }
  }
}

export class MarkdownPreview {
  readonly host: HTMLElement;
  onRendered: (() => void) | null = null;
  /** Called when the user clicks a source-mapped block in the preview. */
  onSourceClick: ((line: number) => void) | null = null;
  private readonly contentEl: HTMLElement;
  private readonly scrollBeyondEl: HTMLElement;
  private lastSource: string | null = null;
  private baseDir: string | null = null;
  private timer: number | undefined;
  private gen = 0;
  private theme: ThemeId = "dark";
  private activeLine: number | null = null;
  private pointerDown: { x: number; y: number } | null = null;
  private contextImage: HTMLImageElement | SVGSVGElement | null = null;

  constructor(host: HTMLElement) {
    this.host = host;
    host.classList.add("md-preview-host");
    const shadow = document.createElement("div");
    shadow.className = "md-scroll-shadow";
    shadow.setAttribute("aria-hidden", "true");
    this.contentEl = document.createElement("div");
    this.contentEl.className = "md-preview";
    // Match Monaco scrollBeyondLastLine: extra space so the last line can sit near the top.
    this.scrollBeyondEl = document.createElement("div");
    this.scrollBeyondEl.className = "md-scroll-beyond";
    this.scrollBeyondEl.setAttribute("aria-hidden", "true");
    host.append(shadow, this.contentEl, this.scrollBeyondEl);
    host.addEventListener("scroll", () => this.syncScrollShadow(), { passive: true });
    this.contentEl.addEventListener("mousedown", (ev) => this.onContentPointerDown(ev));
    this.contentEl.addEventListener("click", (ev) => this.onContentClick(ev));
    this.contentEl.addEventListener("contextmenu", (ev) => this.onContentContextMenu(ev));
    this.bindContextMenu();
    new ResizeObserver(() => {
      this.syncScrollBeyond();
      this.syncScrollShadow();
    }).observe(host);
    this.syncScrollBeyond();
    this.syncScrollShadow();
  }

  private onContentPointerDown(ev: MouseEvent) {
    if (ev.button === 0) {
      this.pointerDown = { x: ev.clientX, y: ev.clientY };
    }
    const active = document.activeElement;
    if (active instanceof HTMLElement && active.closest(".monaco-editor")) {
      active.blur();
    }
  }

  private onContentClick(ev: MouseEvent) {
    if (!this.onSourceClick) {
      return;
    }
    const target = ev.target;
    if (!(target instanceof Element)) {
      return;
    }
    if (target.closest("a[href]")) {
      return;
    }
    if (previewHasSelection(this.contentEl)) {
      return;
    }
    const start = this.pointerDown;
    this.pointerDown = null;
    if (start && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) > 4) {
      return;
    }
    const block = target.closest<HTMLElement>("[data-source-line]");
    if (!block || !this.contentEl.contains(block)) {
      return;
    }
    const line = Number(block.getAttribute("data-source-line"));
    if (!Number.isFinite(line) || line < 1) {
      return;
    }
    this.onSourceClick(line);
  }

  private bindContextMenu() {
    const menu = contextMenuRoot();
    const copyBtn = copyMenuBtn();
    const copyImageBtn = copyImageMenuBtn();
    if (!menu || !copyBtn || !copyImageBtn) {
      return;
    }
    menu.addEventListener("mousedown", (ev) => ev.stopPropagation());
    menu.addEventListener("click", (ev) => ev.stopPropagation());
    document.addEventListener("mousedown", (ev) => {
      if (menu.hidden) {
        return;
      }
      if (ev.target instanceof Node && menu.contains(ev.target)) {
        return;
      }
      hideMdPreviewContextMenu();
    });
    window.addEventListener("blur", () => hideMdPreviewContextMenu());
    window.addEventListener("resize", () => hideMdPreviewContextMenu());
    copyBtn.addEventListener("click", () => {
      const text = previewSelectionText(this.contentEl);
      hideMdPreviewContextMenu();
      if (text) {
        void writeClipboardText(text);
      }
    });
    copyImageBtn.addEventListener("click", () => {
      const image = this.contextImage;
      hideMdPreviewContextMenu();
      this.contextImage = null;
      if (image) {
        void rasterizeToClipboard(image).catch((err) => {
          console.warn("failed to copy markdown image", err);
        });
      }
    });
    window.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") {
        hideMdPreviewContextMenu();
      }
      const mod = ev.ctrlKey || ev.metaKey;
      if (!mod || ev.altKey || ev.key.toLowerCase() !== "c") {
        return;
      }
      if (
        ev.target instanceof Element &&
        ev.target.closest("input, textarea, .monaco-editor, .find-widget")
      ) {
        return;
      }
      const text = previewSelectionText(this.contentEl);
      if (!text) {
        return;
      }
      ev.preventDefault();
      ev.stopPropagation();
      void writeClipboardText(text);
    }, true);
  }

  private onContentContextMenu(ev: MouseEvent) {
    const menu = contextMenuRoot();
    const copyBtn = copyMenuBtn();
    const copyImageBtn = copyImageMenuBtn();
    if (!menu || !copyBtn || !copyImageBtn) {
      return;
    }
    ev.preventDefault();
    ev.stopPropagation();
    const text = previewSelectionText(this.contentEl);
    const image = copyableImage(ev.target, this.contentEl);
    this.contextImage = image;
    copyBtn.hidden = false;
    copyBtn.disabled = !text;
    copyImageBtn.hidden = !image;
    placeContextMenu(menu, ev.clientX, ev.clientY);
  }

  /** Same formula as Monaco viewLayout, plus ~10 lines so preview keeps pace with the editor. */
  private syncScrollBeyond() {
    const lineHeight = this.previewLineHeight();
    const extra = Math.max(0, this.host.clientHeight - lineHeight) + lineHeight * 10;
    this.scrollBeyondEl.style.height = `${extra}px`;
  }

  private previewLineHeight(): number {
    const style = getComputedStyle(this.contentEl);
    const lh = parseFloat(style.lineHeight);
    if (Number.isFinite(lh) && lh > 0) {
      return lh;
    }
    const fontSize = parseFloat(style.fontSize);
    return (Number.isFinite(fontSize) && fontSize > 0 ? fontSize : 15) * 1.65;
  }

  private syncScrollShadow() {
    this.host.classList.toggle("scrolled", this.host.scrollTop > 0);
  }

  setTheme(theme: ThemeId) {
    this.theme = theme;
    this.lastSource = null;
  }

  render(source: string, immediate = false, baseDir: string | null = null) {
    this.baseDir = baseDir;
    if (immediate) {
      void this.flush(source);
      return;
    }
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
    }
    this.timer = window.setTimeout(() => {
      this.timer = undefined;
      void this.flush(source);
    }, 400);
  }

  /**
   * Highlight the preview block that owns `line` (1-based editor line).
   */
  highlightSourceLine(line: number | null) {
    if (previewHasSelection(this.contentEl)) {
      this.activeLine = line != null && line > 0 ? line : null;
      return;
    }
    this.activeLine = line != null && line > 0 ? line : null;
    const nodes = [
      ...this.contentEl.querySelectorAll<HTMLElement>("[data-source-line]"),
    ];
    let best: HTMLElement | null = null;
    let bestSpan = Number.POSITIVE_INFINITY;
    let nearest: HTMLElement | null = null;
    let nearestStart = -1;
    for (const el of nodes) {
      el.classList.remove("md-source-active");
      if (this.activeLine == null) {
        continue;
      }
      const start = Number(el.getAttribute("data-source-line"));
      const endRaw = Number(el.getAttribute("data-source-line-end"));
      if (!Number.isFinite(start)) {
        continue;
      }
      const end = Number.isFinite(endRaw) ? endRaw : start;
      if (start <= this.activeLine && start >= nearestStart) {
        nearest = el;
        nearestStart = start;
      }
      if (this.activeLine < start || this.activeLine > end) {
        continue;
      }
      const span = end - start;
      if (span < bestSpan) {
        bestSpan = span;
        best = el;
      }
    }
    const target = best ?? nearest;
    if (!target) {
      return;
    }
    target.classList.add("md-source-active");
  }

  private async flush(source: string) {
    const key = `${this.baseDir ?? ""}\n${source}`;
    if (key === this.lastSource) {
      this.onRendered?.();
      return;
    }
    this.lastSource = key;
    const gen = ++this.gen;
    mountMarkdownHtml(this.contentEl, renderMarkdown(source), this.baseDir);
    await renderMermaidBlocks(this.contentEl, this.theme);
    if (gen !== this.gen) {
      return;
    }
    this.syncScrollBeyond();
    this.syncScrollShadow();
    if (this.activeLine != null) {
      this.highlightSourceLine(this.activeLine);
    }
    this.onRendered?.();
  }

  invalidate() {
    this.lastSource = null;
  }
}
