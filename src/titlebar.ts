import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { t } from "./i18n";
import { setTooltip } from "./tooltip";

const MIN_ICON = `<svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="square"><path d="M2.5 6h7"/></svg>`;
const MAX_ICON = `<svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1"><rect x="2.5" y="2.5" width="7" height="7"/></svg>`;
const RESTORE_ICON = `<svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1"><path d="M4 3.5h4.5V8"/><rect x="2.5" y="4.5" width="5.5" height="5.5"/></svg>`;
const CLOSE_ICON = `<svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="square"><path d="M3 3l6 6M9 3L3 9"/></svg>`;

let custom = false;

function controls(): HTMLDivElement | null {
  return document.querySelector("#window-controls");
}

function maxButton(): HTMLButtonElement | null {
  return document.querySelector("#win-max");
}

async function syncMaximizeState() {
  const btn = maxButton();
  if (!btn || !custom) {
    return;
  }
  const maximized = await getCurrentWindow().isMaximized();
  btn.innerHTML = maximized ? RESTORE_ICON : MAX_ICON;
  const label = maximized ? t("window.restore") : t("window.maximize");
  setTooltip(btn, label);
  btn.setAttribute("aria-label", label);
}

export function syncTitlebarLocale() {
  if (!custom) {
    return;
  }
  const min = document.querySelector<HTMLButtonElement>("#win-min");
  const close = document.querySelector<HTMLButtonElement>("#win-close");
  if (min) {
    setTooltip(min, t("window.minimize"));
    min.setAttribute("aria-label", t("window.minimize"));
  }
  if (close) {
    setTooltip(close, t("window.close"));
    close.setAttribute("aria-label", t("window.close"));
  }
  void syncMaximizeState();
}

export async function bindTitlebar() {
  custom = await invoke<boolean>("uses_custom_titlebar");
  const el = controls();
  if (!custom || !el) {
    return;
  }
  document.documentElement.dataset.titlebar = "custom";
  document.querySelector(".toolbar")?.setAttribute("data-tauri-drag-region", "");
  el.hidden = false;

  const win = getCurrentWindow();
  const min = document.querySelector<HTMLButtonElement>("#win-min")!;
  const max = document.querySelector<HTMLButtonElement>("#win-max")!;
  const close = document.querySelector<HTMLButtonElement>("#win-close")!;
  min.innerHTML = MIN_ICON;
  close.innerHTML = CLOSE_ICON;
  min.addEventListener("click", () => {
    void win.minimize();
  });
  max.addEventListener("click", () => {
    void win.toggleMaximize();
  });
  close.addEventListener("click", () => {
    void win.close();
  });
  void win.onResized(() => {
    void syncMaximizeState();
  });
  syncTitlebarLocale();
}
