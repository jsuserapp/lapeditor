import { marked } from "marked";
import markedKatex from "marked-katex-extension";
import "katex/dist/katex.min.css";
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

export function renderMarkdown(source: string): string {
  return marked.parse(normalizeMathDelimiters(source), { async: false }) as string;
}

export function mountMarkdownHtml(host: HTMLElement, html: string) {
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
      wrap.innerHTML = svg;
      el.replaceWith(wrap);
    } catch {
      el.classList.add("md-mermaid-error");
    }
  }
}

export class MarkdownPreview {
  readonly host: HTMLElement;
  private readonly contentEl: HTMLElement;
  private lastSource: string | null = null;
  private timer: number | undefined;
  private gen = 0;
  private theme: ThemeId = "dark";

  constructor(host: HTMLElement) {
    this.host = host;
    host.classList.add("md-preview-host");
    this.contentEl = document.createElement("div");
    this.contentEl.className = "md-preview";
    host.appendChild(this.contentEl);
  }

  setTheme(theme: ThemeId) {
    this.theme = theme;
    this.lastSource = null;
  }

  render(source: string, immediate = false) {
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

  private async flush(source: string) {
    if (source === this.lastSource) {
      return;
    }
    this.lastSource = source;
    const gen = ++this.gen;
    mountMarkdownHtml(this.contentEl, renderMarkdown(source));
    await renderMermaidBlocks(this.contentEl, this.theme);
    if (gen !== this.gen) {
      return;
    }
  }

  invalidate() {
    this.lastSource = null;
  }
}
