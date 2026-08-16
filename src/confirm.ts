import warnIcon from "./assets/icons/warn.png";

export type ConfirmKind = "warning" | "info" | "error";

export type ConfirmButton = {
  id: string;
  label: string;
  role?: "primary" | "danger" | "default";
};

export type ConfirmOptions = {
  title: string;
  message: string;
  kind?: ConfirmKind;
  buttons: ConfirmButton[];
  defaultId?: string;
  cancelId?: string;
};

type Pending = {
  resolve: (id: string) => void;
  cancelId: string;
};

let pending: Pending | null = null;
let lastFocus: HTMLElement | null = null;

const SVG_ICONS: Record<Exclude<ConfirmKind, "warning">, string> = {
  info: `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="12" cy="12" r="8.2"/>
  <path d="M12 11.2V16"/>
  <path d="M12 8.2h.01"/>
</svg>`,
  error: `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="12" cy="12" r="8.2"/>
  <path d="M12 8.2v5.4"/>
  <path d="M12 16.4h.01"/>
</svg>`,
};

function setConfirmIcon(kind: ConfirmKind) {
  const host = iconEl();
  if (kind === "warning") {
    const img = document.createElement("img");
    img.src = warnIcon;
    img.alt = "";
    img.width = 22;
    img.height = 22;
    img.draggable = false;
    host.replaceChildren(img);
    return;
  }
  host.innerHTML = SVG_ICONS[kind];
}

function root(): HTMLDivElement {
  return document.querySelector("#confirm-dialog")!;
}

function titleEl(): HTMLHeadingElement {
  return document.querySelector("#confirm-title")!;
}

function messageEl(): HTMLParagraphElement {
  return document.querySelector("#confirm-message")!;
}

function iconEl(): HTMLDivElement {
  return document.querySelector("#confirm-icon")!;
}

function actionsEl(): HTMLDivElement {
  return document.querySelector("#confirm-actions")!;
}

function finish(id: string) {
  const dialog = root();
  if (dialog.hidden) {
    return;
  }
  dialog.hidden = true;
  const resolve = pending?.resolve;
  pending = null;
  lastFocus?.focus();
  lastFocus = null;
  resolve?.(id);
}

function onKey(ev: KeyboardEvent) {
  if (root().hidden || !pending) {
    return;
  }
  if (ev.key === "Escape") {
    ev.preventDefault();
    ev.stopPropagation();
    finish(pending.cancelId);
    return;
  }
  if (ev.key !== "Enter") {
    return;
  }
  const target = ev.target as HTMLElement | null;
  if (target?.closest("#confirm-actions button")) {
    return;
  }
  ev.preventDefault();
  ev.stopPropagation();
  actionsEl().querySelector<HTMLButtonElement>("[data-default='true']")?.click();
}

export function bindConfirmDialog() {
  window.addEventListener("keydown", onKey, true);
}

export function confirmDialog(options: ConfirmOptions): Promise<string> {
  if (pending) {
    finish(pending.cancelId);
  }
  const kind = options.kind ?? "info";
  const cancelId =
    options.cancelId ?? options.buttons[options.buttons.length - 1]?.id ?? "cancel";
  const defaultId = options.defaultId ?? options.buttons[0]?.id;
  titleEl().textContent = options.title;
  messageEl().textContent = options.message;
  setConfirmIcon(kind);
  root().dataset.kind = kind;
  actionsEl().replaceChildren();
  lastFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  return new Promise((resolve) => {
    pending = { resolve, cancelId };
    for (const button of options.buttons) {
      const el = document.createElement("button");
      el.type = "button";
      el.textContent = button.label;
      if (button.role === "primary") {
        el.className = "modal-primary";
      } else if (button.role === "danger") {
        el.className = "modal-danger";
      }
      if (button.id === defaultId) {
        el.dataset.default = "true";
      }
      el.addEventListener("click", () => finish(button.id));
      actionsEl().appendChild(el);
    }
    root().hidden = false;
    const focus =
      actionsEl().querySelector<HTMLButtonElement>("[data-default='true']") ??
      actionsEl().querySelector("button");
    focus?.focus();
  });
}
