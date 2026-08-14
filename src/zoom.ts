import { invoke } from "@tauri-apps/api/core";

/** Matches common browser WebView page-zoom step. */
const ZOOM_STEP = 0.1;

type ZoomHooks = {
  onZoom?: () => void;
};

/** Ctrl/Cmd + / - / 0 (including numpad), same as Chromium page zoom. */
function zoomAction(e: KeyboardEvent): "in" | "out" | "reset" | null {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) {
    return null;
  }
  const key = e.key;
  const code = e.code;
  if (key === "0" || code === "Digit0" || code === "Numpad0") {
    return "reset";
  }
  if (key === "=" || key === "+" || code === "Equal" || code === "NumpadAdd") {
    return "in";
  }
  if (key === "-" || key === "_" || code === "Minus" || code === "NumpadSubtract") {
    return "out";
  }
  return null;
}

export function bindWebviewZoom(hooks: ZoomHooks = {}) {
  const afterZoom = () => {
    requestAnimationFrame(() => {
      hooks.onZoom?.();
    });
  };

  document.addEventListener(
    "keydown",
    (e) => {
      const action = zoomAction(e);
      if (!action) {
        return;
      }
      e.preventDefault();

      void (async () => {
        try {
          if (action === "reset") {
            await invoke("set_zoom", { level: 1 });
          } else {
            await invoke("zoom_by", {
              delta: action === "in" ? ZOOM_STEP : -ZOOM_STEP,
            });
          }
          afterZoom();
        } catch (err) {
          console.error("zoom hotkey failed:", err);
        }
      })();
    },
    { capture: true },
  );

  document.addEventListener(
    "wheel",
    (e) => {
      if (!(e.ctrlKey || e.metaKey)) {
        return;
      }
      e.preventDefault();
      const delta = e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP;
      void invoke("zoom_by", { delta })
        .then(afterZoom)
        .catch((err) => {
          console.error("zoom wheel failed:", err);
        });
    },
    { passive: false, capture: true },
  );
}
