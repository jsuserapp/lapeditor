import { t } from "./i18n";

export type NameDialogOptions = {
  title: string;
  hint?: string;
  label: string;
  confirmLabel: string;
  initial?: string;
  validate?: (name: string) => string | null;
  submit: (name: string) => Promise<void>;
};

let bound = false;
let busy = false;
let lastFocus: HTMLElement | null = null;
let pending: ((ok: boolean) => void) | null = null;
let current: NameDialogOptions | null = null;

function root() {
  return document.querySelector<HTMLDivElement>("#name-dialog")!;
}

function titleEl() {
  return document.querySelector<HTMLHeadingElement>("#name-dialog-title")!;
}

function hintEl() {
  return document.querySelector<HTMLParagraphElement>("#name-dialog-hint")!;
}

function labelEl() {
  return document.querySelector<HTMLSpanElement>("#name-dialog-label")!;
}

function inputEl() {
  return document.querySelector<HTMLInputElement>("#name-dialog-input")!;
}

function errorEl() {
  return document.querySelector<HTMLParagraphElement>("#name-dialog-error")!;
}

function cancelBtn() {
  return document.querySelector<HTMLButtonElement>("#name-dialog-cancel")!;
}

function confirmBtn() {
  return document.querySelector<HTMLButtonElement>("#name-dialog-confirm")!;
}

function setError(message: string) {
  errorEl().hidden = !message;
  errorEl().textContent = message;
}

function finish(ok: boolean) {
  const dialog = root();
  if (dialog.hidden) {
    return;
  }
  dialog.hidden = true;
  const resolve = pending;
  pending = null;
  current = null;
  busy = false;
  lastFocus?.focus();
  lastFocus = null;
  resolve?.(ok);
}

async function confirm() {
  if (!current || busy) {
    return;
  }
  const name = inputEl().value.trim();
  const local = current.validate?.(name);
  if (local) {
    setError(local);
    inputEl().focus();
    inputEl().select();
    return;
  }
  busy = true;
  confirmBtn().disabled = true;
  setError("");
  try {
    await current.submit(name);
    finish(true);
  } catch (err) {
    setError(err instanceof Error ? err.message : String(err));
    inputEl().focus();
    inputEl().select();
  } finally {
    busy = false;
    confirmBtn().disabled = false;
  }
}

function onKey(ev: KeyboardEvent) {
  if (root().hidden || !pending) {
    return;
  }
  if (ev.key === "Escape") {
    ev.preventDefault();
    ev.stopPropagation();
    finish(false);
    return;
  }
  if (ev.key === "Enter") {
    ev.preventDefault();
    ev.stopPropagation();
    void confirm();
  }
}

export function bindNameDialog() {
  if (bound) {
    return;
  }
  bound = true;
  cancelBtn().addEventListener("click", () => {
    if (!busy) {
      finish(false);
    }
  });
  confirmBtn().addEventListener("click", () => void confirm());
  window.addEventListener("keydown", onKey, true);
}

export function promptName(options: NameDialogOptions): Promise<boolean> {
  bindNameDialog();
  if (pending) {
    finish(false);
  }
  current = options;
  titleEl().textContent = options.title;
  hintEl().textContent = options.hint ?? "";
  hintEl().hidden = !options.hint;
  labelEl().textContent = options.label;
  confirmBtn().textContent = options.confirmLabel;
  cancelBtn().textContent = t("dialog.cancel");
  inputEl().value = options.initial ?? "";
  setError("");
  lastFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  root().hidden = false;
  window.setTimeout(() => {
    inputEl().focus();
    inputEl().select();
  }, 0);
  return new Promise((resolve) => {
    pending = resolve;
  });
}
