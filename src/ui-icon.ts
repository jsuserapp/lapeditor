import { createElement, type IconNode } from "lucide";

export type UiIconOptions = {
  size?: number;
  strokeWidth?: number;
  className?: string;
};

/** Mount a Lucide icon into a host element (replaces previous children). */
export function setUiIcon(host: HTMLElement, icon: IconNode, options: UiIconOptions = {}) {
  const size = options.size ?? 16;
  const strokeWidth = options.strokeWidth ?? 1.75;
  const svg = createElement(icon, {
    width: size,
    height: size,
    "stroke-width": strokeWidth,
    "aria-hidden": "true",
    class: options.className ?? "ui-icon",
  });
  host.replaceChildren(svg);
  return svg;
}

/** Create a Lucide SVG element without mounting. */
export function createUiIcon(icon: IconNode, options: UiIconOptions = {}) {
  const size = options.size ?? 16;
  const strokeWidth = options.strokeWidth ?? 1.75;
  return createElement(icon, {
    width: size,
    height: size,
    "stroke-width": strokeWidth,
    "aria-hidden": "true",
    class: options.className ?? "ui-icon",
  });
}
