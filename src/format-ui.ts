import { confirmDialog } from "./confirm";
import { t } from "./i18n";
import {
  loadFormatterConfig,
  normalizeIndent,
  removeFormatterCommand,
  saveFormatIndent,
  saveFormatterCommand,
  type FormatIndent,
  type FormatterCommandInfo,
} from "./format";

type FormatUiHost = {
  getLanguageIds: () => string[];
  languageLabel: (id: string) => string;
  currentLanguageId: () => string;
  onIndentChange: (indent: FormatIndent) => void;
  onFormatterChange?: () => void;
};

const optionsDialog = () => document.querySelector<HTMLDivElement>("#format-options-dialog")!;
const commandForm = () => document.querySelector<HTMLDivElement>("#format-command-form")!;
const languageInput = () => document.querySelector<HTMLInputElement>("#add-formatter-language")!;
const programInput = () => document.querySelector<HTMLInputElement>("#add-formatter-program")!;
const argsInput = () => document.querySelector<HTMLInputElement>("#add-formatter-args")!;
const suggestBox = () => document.querySelector<HTMLDivElement>("#add-formatter-suggest")!;
const formTitle = () => document.querySelector<HTMLHeadingElement>("#format-command-form-title")!;

let host: FormatUiHost | undefined;
let editingLanguage: string | null = null;

function setDialogError(message: string) {
  const el = optionsDialog().querySelector<HTMLParagraphElement>(".modal-error")!;
  el.hidden = !message;
  el.textContent = message;
}

function closeDialog() {
  hideCommandForm();
  optionsDialog().hidden = true;
}

export function closeFormatDialogs() {
  closeDialog();
}

function hideCommandForm() {
  commandForm().hidden = true;
  suggestBox().hidden = true;
  editingLanguage = null;
  setDialogError("");
}

function showCommandForm(item?: FormatterCommandInfo) {
  editingLanguage = item?.id ?? null;
  formTitle().textContent = item ? t("format.editTitle") : t("format.addTitle");
  languageInput().value =
    item?.id ?? (host?.currentLanguageId() === "plaintext" ? "" : (host?.currentLanguageId() ?? ""));
  languageInput().readOnly = !!item;
  programInput().value = item?.program ?? "";
  argsInput().value = item?.args.join(" ") ?? "";
  setDialogError("");
  renderLanguageSuggest(languageInput().value);
  commandForm().hidden = false;
  (item ? programInput() : languageInput()).focus();
}

function renderCommandList(commands: FormatterCommandInfo[]) {
  const list = optionsDialog().querySelector<HTMLDivElement>("#format-command-list")!;
  list.replaceChildren();
  if (commands.length === 0) {
    const empty = document.createElement("p");
    empty.className = "modal-preview";
    empty.textContent = t("format.noCommands");
    list.appendChild(empty);
    return;
  }
  for (const item of commands) {
    const row = document.createElement("div");
    row.className = "format-command-row";
    const name = document.createElement("strong");
    name.textContent = host?.languageLabel(item.id) ?? item.id;
    const spec = document.createElement("span");
    spec.textContent = [item.program, ...item.args].join(" ");
    const status = document.createElement("span");
    status.className = item.available ? "format-ok" : "format-miss";
    status.textContent = item.available ? t("format.available") : t("format.missing");
    const actions = document.createElement("div");
    actions.className = "format-command-actions";
    const edit = document.createElement("button");
    edit.type = "button";
    edit.textContent = t("format.edit");
    edit.addEventListener("click", () => showCommandForm(item));
    actions.append(edit);
    if (item.source === "user") {
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = t("format.remove");
      remove.addEventListener("click", () => void removeCommand(item));
      actions.append(remove);
    }
    row.append(name, spec, status, actions);
    list.appendChild(row);
  }
}

async function refreshCommandList() {
  const config = await loadFormatterConfig();
  renderCommandList(config.commands);
}

export async function openFormatOptionsDialog() {
  const dialog = optionsDialog();
  hideCommandForm();
  setDialogError("");
  try {
    const config = await loadFormatterConfig();
    const indent = normalizeIndent(config.indent);
    for (const input of dialog.querySelectorAll<HTMLInputElement>("input[name='format-indent']")) {
      input.checked = input.value === indent;
    }
    renderCommandList(config.commands);
  } catch (err) {
    setDialogError(err instanceof Error ? err.message : String(err));
  }
  dialog.hidden = false;
}

function renderLanguageSuggest(query: string) {
  if (languageInput().readOnly) {
    suggestBox().hidden = true;
    return;
  }
  const ids = host?.getLanguageIds() ?? [];
  const q = query.trim().toLowerCase();
  const matches = (
    q
      ? ids.filter(
          (id) => id.includes(q) || (host?.languageLabel(id).toLowerCase().includes(q) ?? false),
        )
      : ids
  ).slice(0, 10);
  suggestBox().replaceChildren();
  if (matches.length === 0) {
    suggestBox().hidden = true;
    return;
  }
  for (const id of matches) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "modal-suggest-item";
    btn.textContent = `${host?.languageLabel(id) ?? id}  ${id}`;
    btn.addEventListener("mousedown", (ev) => ev.preventDefault());
    btn.addEventListener("click", () => {
      languageInput().value = id;
      suggestBox().hidden = true;
    });
    suggestBox().appendChild(btn);
  }
  suggestBox().hidden = false;
}

async function saveIndent() {
  const selected = optionsDialog().querySelector<HTMLInputElement>(
    "input[name='format-indent']:checked",
  );
  const indent = normalizeIndent(selected?.value);
  try {
    await saveFormatIndent(indent);
    host?.onIndentChange(indent);
    closeDialog();
  } catch (err) {
    setDialogError(err instanceof Error ? err.message : String(err));
  }
}

function parseArgs(text: string): string[] {
  return text
    .trim()
    .split(/\s+/)
    .filter((part) => part.length > 0);
}

async function saveCommand() {
  const language = languageInput().value.trim();
  const program = programInput().value.trim();
  const args = parseArgs(argsInput().value);
  if (!language) {
    setDialogError(t("format.needLanguage"));
    return;
  }
  if (!program) {
    setDialogError(t("format.needProgram"));
    return;
  }
  try {
    await saveFormatterCommand(language, program, args);
    host?.onFormatterChange?.();
    hideCommandForm();
    await refreshCommandList();
  } catch (err) {
    setDialogError(err instanceof Error ? err.message : String(err));
  }
}

async function removeCommand(item: FormatterCommandInfo) {
  const result = await confirmDialog({
    title: t("format.removeTitle"),
    message: t("format.removeConfirm", { language: host?.languageLabel(item.id) ?? item.id }),
    kind: "warning",
    buttons: [
      { id: "remove", label: t("format.remove"), role: "danger" },
      { id: "cancel", label: t("dialog.cancel") },
    ],
    defaultId: "cancel",
    cancelId: "cancel",
  });
  if (result !== "remove") {
    return;
  }
  try {
    await removeFormatterCommand(item.id);
    host?.onFormatterChange?.();
    if (editingLanguage === item.id) {
      hideCommandForm();
    }
    await refreshCommandList();
  } catch (err) {
    setDialogError(err instanceof Error ? err.message : String(err));
  }
}

export function bindFormatDialogs(options: FormatUiHost) {
  host = options;
  const dialog = optionsDialog();

  dialog.querySelector("#format-options-cancel")?.addEventListener("click", () => {
    closeDialog();
  });
  dialog.querySelector("#format-options-save")?.addEventListener("click", () => {
    void saveIndent();
  });
  dialog.querySelector("#format-options-add")?.addEventListener("click", () => {
    showCommandForm();
  });
  dialog.querySelector("#format-command-form-cancel")?.addEventListener("click", () => {
    hideCommandForm();
  });
  dialog.querySelector("#format-command-form-save")?.addEventListener("click", () => {
    void saveCommand();
  });
  languageInput().addEventListener("input", (ev) => {
    renderLanguageSuggest((ev.target as HTMLInputElement).value);
  });
  languageInput().addEventListener("focus", (ev) => {
    renderLanguageSuggest((ev.target as HTMLInputElement).value);
  });

  window.addEventListener(
    "keydown",
    (ev) => {
      if (ev.key !== "Escape" || dialog.hidden) {
        return;
      }
      ev.preventDefault();
      ev.stopPropagation();
      if (!commandForm().hidden) {
        hideCommandForm();
        return;
      }
      closeDialog();
    },
    true,
  );
}
