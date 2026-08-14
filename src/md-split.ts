import type * as monaco from "monaco-editor/editor/editor.api.js";

export const MD_SPLIT_MIN = 0.2;
export const MD_SPLIT_MAX = 0.8;
export const MD_SPLIT_DEFAULT = 0.5;

export function clampMdSplit(ratio: number): number {
  if (!Number.isFinite(ratio)) {
    return MD_SPLIT_DEFAULT;
  }
  return Math.min(MD_SPLIT_MAX, Math.max(MD_SPLIT_MIN, ratio));
}

export function applyMdSplitRatio(host: HTMLElement, ratio: number) {
  const value = clampMdSplit(ratio);
  host.style.setProperty("--md-split-left", `${(value * 100).toFixed(3)}%`);
  return value;
}

export function bindMdGutter(options: {
  host: HTMLElement;
  gutter: HTMLElement;
  getRatio: () => number;
  setRatio: (ratio: number) => void;
  onLayout: () => void;
  onCommit: (ratio: number) => void;
}) {
  const { host, gutter } = options;
  let dragging = false;

  const onMove = (ev: MouseEvent) => {
    if (!dragging) {
      return;
    }
    const rect = host.getBoundingClientRect();
    if (rect.width <= 0) {
      return;
    }
    const ratio = applyMdSplitRatio(host, (ev.clientX - rect.left) / rect.width);
    options.setRatio(ratio);
    options.onLayout();
  };

  const onUp = () => {
    if (!dragging) {
      return;
    }
    dragging = false;
    host.classList.remove("md-splitting");
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
    options.onCommit(options.getRatio());
  };

  gutter.addEventListener("mousedown", (ev) => {
    if (ev.button !== 0 || host.hidden || !host.classList.contains("md-split")) {
      return;
    }
    ev.preventDefault();
    dragging = true;
    host.classList.add("md-splitting");
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  });
}

export function bindMdScrollSync(options: {
  getEditor: () => monaco.editor.IStandaloneCodeEditor | undefined;
  preview: HTMLElement;
  isActive: () => boolean;
}) {
  let source: "editor" | "preview" | null = null;
  let unlock: number | undefined;

  const mark = (next: "editor" | "preview") => {
    source = next;
    if (unlock !== undefined) {
      clearTimeout(unlock);
    }
    unlock = window.setTimeout(() => {
      source = null;
      unlock = undefined;
    }, 80);
  };

  const editorMax = (ed: monaco.editor.IStandaloneCodeEditor) => {
    return Math.max(0, ed.getScrollHeight() - ed.getLayoutInfo().height);
  };

  const previewMax = () => {
    return Math.max(0, options.preview.scrollHeight - options.preview.clientHeight);
  };

  const fromEditor = () => {
    if (!options.isActive() || source === "preview") {
      return;
    }
    const ed = options.getEditor();
    if (!ed) {
      return;
    }
    mark("editor");
    const max = editorMax(ed);
    const pMax = previewMax();
    options.preview.scrollTop = max <= 0 || pMax <= 0 ? 0 : (ed.getScrollTop() / max) * pMax;
  };

  const onPreviewScroll = () => {
    if (!options.isActive() || source === "editor") {
      return;
    }
    const ed = options.getEditor();
    if (!ed) {
      return;
    }
    mark("preview");
    const max = editorMax(ed);
    const pMax = previewMax();
    ed.setScrollTop(max <= 0 || pMax <= 0 ? 0 : (options.preview.scrollTop / pMax) * max);
  };

  options.preview.addEventListener("scroll", onPreviewScroll, { passive: true });

  return { fromEditor };
}
