let tip: HTMLDivElement | null = null;
let current: HTMLElement | null = null;
let showTimer: number | undefined;

function ensureTip() {
  if (tip) {
    return tip;
  }
  tip = document.createElement("div");
  tip.className = "app-tooltip";
  tip.hidden = true;
  tip.setAttribute("role", "tooltip");
  document.body.appendChild(tip);
  return tip;
}

export function setTooltip(el: HTMLElement, text: string) {
  const value = text.trim();
  if (value) {
    el.dataset.tooltip = value;
  } else {
    delete el.dataset.tooltip;
  }
  el.removeAttribute("title");
}

function tooltipTarget(from: EventTarget | null): HTMLElement | null {
  if (!(from instanceof Element)) {
    return null;
  }
  return from.closest<HTMLElement>("[data-tooltip]");
}

function hideNow() {
  window.clearTimeout(showTimer);
  showTimer = undefined;
  current = null;
  if (tip) {
    tip.hidden = true;
  }
}

function positionTip(el: HTMLElement) {
  const node = ensureTip();
  const rect = el.getBoundingClientRect();
  const gap = 8;
  const tw = node.offsetWidth;
  const th = node.offsetHeight;
  let left = rect.right + gap;
  let top = rect.top + (rect.height - th) / 2;
  if (left + tw > window.innerWidth - 8) {
    left = Math.max(8, window.innerWidth - tw - 8);
  }
  if (top < 8) {
    top = 8;
  }
  if (top + th > window.innerHeight - 8) {
    top = Math.max(8, window.innerHeight - th - 8);
  }
  node.style.left = `${Math.round(left)}px`;
  node.style.top = `${Math.round(top)}px`;
}

function showFor(el: HTMLElement) {
  const text = el.dataset.tooltip?.trim();
  if (!text) {
    return;
  }
  const node = ensureTip();
  node.textContent = text;
  node.hidden = false;
  positionTip(el);
}

export function bindTooltips() {
  ensureTip();
  document.addEventListener("pointerover", (ev) => {
    const target = tooltipTarget(ev.target);
    if (!target) {
      return;
    }
    if (target === current && tip && !tip.hidden) {
      return;
    }
    current = target;
    window.clearTimeout(showTimer);
    showTimer = window.setTimeout(() => {
      if (current === target) {
        showFor(target);
      }
    }, 400);
  });
  document.addEventListener("pointerout", (ev) => {
    const leaving = tooltipTarget(ev.target);
    const entering = tooltipTarget(ev.relatedTarget);
    if (leaving && leaving === entering) {
      return;
    }
    if (leaving === current) {
      hideNow();
    }
  });
  document.addEventListener("pointerdown", hideNow);
  window.addEventListener("blur", hideNow);
  window.addEventListener("resize", hideNow);
}
