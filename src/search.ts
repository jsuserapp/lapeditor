import { Settings } from "lucide";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { ExplorerApi } from "./explorer";
import { t } from "./i18n";
import { setTooltip } from "./tooltip";
import { setUiIcon } from "./ui-icon";

const DEBOUNCE_MS = 1000;

export type SearchHit = {
  path: string;
  line: number;
  column: number;
  endColumn: number;
  preview: string;
};

export type SearchExcludeSettings = {
  enabled: boolean;
  skipHidden: boolean;
  useGitignore: boolean;
  useIgnoreFile: boolean;
  useGitExclude: boolean;
  skipDependencies: boolean;
  skipBuild: boolean;
  skipVcs: boolean;
  skipSvn: boolean;
  skipIde: boolean;
  skipOsJunk: boolean;
  customDirs: string[];
};

export type SearchApi = {
  open: () => void;
  focus: () => void;
  setWorkspace: (path: string | null) => void;
  applyExcludeSettings: (settings: Partial<SearchExcludeSettings> | null | undefined) => void;
  syncLocale: () => void;
  dispose: () => void;
};

type SearchHost = {
  explorer: () => ExplorerApi | undefined;
  getWorkspace: () => string | null;
  onOpenHit: (hit: SearchHit) => void;
  onPersistExclude: (settings: SearchExcludeSettings) => void;
};

type HitsEvent = { id: number; hits: SearchHit[] };
type DoneEvent = {
  id: number;
  filesSearched: number;
  matchCount: number;
  truncated: boolean;
  cancelled: boolean;
  error?: string | null;
};

function defaultExcludeSettings(): SearchExcludeSettings {
  return {
    enabled: true,
    skipHidden: true,
    useGitignore: true,
    useIgnoreFile: true,
    useGitExclude: true,
    skipDependencies: true,
    skipBuild: true,
    skipVcs: true,
    skipSvn: true,
    skipIde: true,
    skipOsJunk: true,
    customDirs: [],
  };
}

function mergeExcludeSettings(
  base: SearchExcludeSettings,
  patch: Partial<SearchExcludeSettings> | null | undefined,
): SearchExcludeSettings {
  if (!patch) {
    return { ...base, customDirs: [...base.customDirs] };
  }
  return {
    enabled: patch.enabled ?? base.enabled,
    skipHidden: patch.skipHidden ?? base.skipHidden,
    useGitignore: patch.useGitignore ?? base.useGitignore,
    useIgnoreFile: patch.useIgnoreFile ?? base.useIgnoreFile,
    useGitExclude: patch.useGitExclude ?? base.useGitExclude,
    skipDependencies: patch.skipDependencies ?? base.skipDependencies,
    skipBuild: patch.skipBuild ?? base.skipBuild,
    skipVcs: patch.skipVcs ?? base.skipVcs,
    skipSvn: patch.skipSvn ?? base.skipSvn,
    skipIde: patch.skipIde ?? base.skipIde,
    skipOsJunk: patch.skipOsJunk ?? base.skipOsJunk,
    customDirs: [...(patch.customDirs ?? base.customDirs)],
  };
}

function normalizeCustomDir(raw: string): string | null {
  const trimmed = raw.trim().replace(/^[/\\]+|[/\\]+$/g, "");
  if (!trimmed || trimmed.length > 120) {
    return null;
  }
  if (trimmed === "." || trimmed === ".." || trimmed.includes("..")) {
    return null;
  }
  if (/[<>|\0]/.test(trimmed)) {
    return null;
  }
  return trimmed;
}

function basename(path: string) {
  const parts = path.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || path;
}

function relativePath(path: string, root: string | null) {
  if (!root) {
    return path;
  }
  const normPath = path.replace(/\\/g, "/");
  const normRoot = root.replace(/\\/g, "/").replace(/\/+$/, "");
  if (normPath.toLowerCase().startsWith(normRoot.toLowerCase() + "/")) {
    return normPath.slice(normRoot.length + 1);
  }
  if (normPath.toLowerCase() === normRoot.toLowerCase()) {
    return basename(path);
  }
  return path;
}

export function bindSearch(host: SearchHost): SearchApi {
  const button = document.querySelector<HTMLButtonElement>("#btn-search")!;
  const queryInput = document.querySelector<HTMLInputElement>("#search-query")!;
  const statusEl = document.querySelector<HTMLDivElement>("#search-status")!;
  const resultsEl = document.querySelector<HTMLDivElement>("#search-results")!;
  const optCase = document.querySelector<HTMLButtonElement>("#search-opt-case")!;
  const optWord = document.querySelector<HTMLButtonElement>("#search-opt-word")!;
  const optRegex = document.querySelector<HTMLButtonElement>("#search-opt-regex")!;
  const useExcludes = document.querySelector<HTMLInputElement>("#search-use-excludes")!;
  const settingsBtn = document.querySelector<HTMLButtonElement>("#search-exclude-settings")!;
  setUiIcon(settingsBtn, Settings, { size: 14, strokeWidth: 1.8 });
  const dialog = document.querySelector<HTMLDivElement>("#search-exclude-dialog")!;
  const sxHidden = document.querySelector<HTMLInputElement>("#sx-hidden")!;
  const sxGitignore = document.querySelector<HTMLInputElement>("#sx-gitignore")!;
  const sxIgnoreFile = document.querySelector<HTMLInputElement>("#sx-ignore-file")!;
  const sxGitExclude = document.querySelector<HTMLInputElement>("#sx-git-exclude")!;
  const sxDeps = document.querySelector<HTMLInputElement>("#sx-deps")!;
  const sxBuild = document.querySelector<HTMLInputElement>("#sx-build")!;
  const sxVcs = document.querySelector<HTMLInputElement>("#sx-vcs")!;
  const sxSvn = document.querySelector<HTMLInputElement>("#sx-svn")!;
  const sxIde = document.querySelector<HTMLInputElement>("#sx-ide")!;
  const sxOs = document.querySelector<HTMLInputElement>("#sx-os")!;
  const sxCustomInput = document.querySelector<HTMLInputElement>("#sx-custom-input")!;
  const sxCustomAdd = document.querySelector<HTMLButtonElement>("#sx-custom-add")!;
  const sxCustomError = document.querySelector<HTMLParagraphElement>("#sx-custom-error")!;
  const sxCustomList = document.querySelector<HTMLUListElement>("#sx-custom-list")!;
  const sxCancel = document.querySelector<HTMLButtonElement>("#sx-cancel")!;
  const sxSave = document.querySelector<HTMLButtonElement>("#sx-save")!;

  let workspace: string | null = host.getWorkspace();
  let matchCase = false;
  let wholeWord = false;
  let useRegex = false;
  let excludes = defaultExcludeSettings();
  let draftCustomDirs: string[] = [];
  let debounceTimer: number | undefined;
  let searchSeq = 0;
  let activeId = 0;
  let searching = false;
  let hitsByFile = new Map<string, SearchHit[]>();
  let fileOrder: string[] = [];
  let unsubscribers: UnlistenFn[] = [];

  const syncMasterToggle = () => {
    useExcludes.checked = excludes.enabled;
  };

  const syncOptButtons = () => {
    optCase.setAttribute("aria-pressed", matchCase ? "true" : "false");
    optWord.setAttribute("aria-pressed", wholeWord ? "true" : "false");
    optRegex.setAttribute("aria-pressed", useRegex ? "true" : "false");
    optCase.classList.toggle("active", matchCase);
    optWord.classList.toggle("active", wholeWord);
    optRegex.classList.toggle("active", useRegex);
  };

  const setStatus = (text: string) => {
    statusEl.textContent = text;
  };

  const clearResults = () => {
    hitsByFile = new Map();
    fileOrder = [];
    resultsEl.replaceChildren();
  };

  const renderResults = () => {
    resultsEl.replaceChildren();
    for (const path of fileOrder) {
      const hits = hitsByFile.get(path);
      if (!hits?.length) {
        continue;
      }
      const group = document.createElement("div");
      group.className = "search-file-group";

      const header = document.createElement("div");
      header.className = "search-file-header";
      header.title = path;
      const name = document.createElement("span");
      name.className = "search-file-name";
      name.textContent = basename(path);
      const rel = document.createElement("span");
      rel.className = "search-file-path";
      rel.textContent = relativePath(path, workspace);
      const count = document.createElement("span");
      count.className = "search-file-count";
      count.textContent = String(hits.length);
      header.append(name, rel, count);
      group.appendChild(header);

      for (const hit of hits) {
        const row = document.createElement("button");
        row.type = "button";
        row.className = "search-hit";
        const lineNo = document.createElement("span");
        lineNo.className = "search-hit-line";
        lineNo.textContent = String(hit.line);
        const preview = document.createElement("span");
        preview.className = "search-hit-preview";
        preview.textContent = hit.preview;
        row.append(lineNo, preview);
        row.addEventListener("click", () => host.onOpenHit(hit));
        group.appendChild(row);
      }
      resultsEl.appendChild(group);
    }
  };

  const setCustomError = (message: string | null) => {
    if (!message) {
      sxCustomError.hidden = true;
      sxCustomError.textContent = "";
      return;
    }
    sxCustomError.hidden = false;
    sxCustomError.textContent = message;
  };

  const renderCustomList = () => {
    sxCustomList.replaceChildren();
    for (const dir of draftCustomDirs) {
      const li = document.createElement("li");
      li.className = "search-exclude-custom-item";
      const label = document.createElement("span");
      label.textContent = dir;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "search-exclude-custom-remove";
      remove.textContent = "×";
      remove.setAttribute("aria-label", t("dialog.cancel"));
      remove.addEventListener("click", () => {
        draftCustomDirs = draftCustomDirs.filter((item) => item !== dir);
        renderCustomList();
      });
      li.append(label, remove);
      sxCustomList.appendChild(li);
    }
  };

  const fillDialogFromExcludes = () => {
    sxHidden.checked = excludes.skipHidden;
    sxGitignore.checked = excludes.useGitignore;
    sxIgnoreFile.checked = excludes.useIgnoreFile;
    sxGitExclude.checked = excludes.useGitExclude;
    sxDeps.checked = excludes.skipDependencies;
    sxBuild.checked = excludes.skipBuild;
    sxVcs.checked = excludes.skipVcs;
    sxSvn.checked = excludes.skipSvn;
    sxIde.checked = excludes.skipIde;
    sxOs.checked = excludes.skipOsJunk;
    draftCustomDirs = [...excludes.customDirs];
    sxCustomInput.value = "";
    setCustomError(null);
    renderCustomList();
  };

  const readDialogToExcludes = (): SearchExcludeSettings => ({
    enabled: excludes.enabled,
    skipHidden: sxHidden.checked,
    useGitignore: sxGitignore.checked,
    useIgnoreFile: sxIgnoreFile.checked,
    useGitExclude: sxGitExclude.checked,
    skipDependencies: sxDeps.checked,
    skipBuild: sxBuild.checked,
    skipVcs: sxVcs.checked,
    skipSvn: sxSvn.checked,
    skipIde: sxIde.checked,
    skipOsJunk: sxOs.checked,
    customDirs: [...draftCustomDirs],
  });

  const setDialogOpen = (open: boolean) => {
    dialog.hidden = !open;
    if (open) {
      fillDialogFromExcludes();
      sxHidden.focus();
    }
  };

  const addCustomDir = () => {
    const name = normalizeCustomDir(sxCustomInput.value);
    if (!name) {
      setCustomError(t("search.excludeCustomInvalid"));
      sxCustomInput.focus();
      return;
    }
    if (draftCustomDirs.some((item) => item.toLowerCase() === name.toLowerCase())) {
      setCustomError(t("search.excludeCustomExists"));
      sxCustomInput.focus();
      return;
    }
    draftCustomDirs = [...draftCustomDirs, name];
    sxCustomInput.value = "";
    setCustomError(null);
    renderCustomList();
    sxCustomInput.focus();
  };

  const persistExcludes = () => {
    host.onPersistExclude({ ...excludes, customDirs: [...excludes.customDirs] });
  };

  const cancelActive = () => {
    if (!searching && !activeId) {
      return;
    }
    activeId = 0;
    searching = false;
    void invoke("cancel_workspace_search").catch(() => {});
  };

  const runSearch = async () => {
    const query = queryInput.value;
    if (!workspace) {
      cancelActive();
      clearResults();
      setStatus(t("search.noWorkspace"));
      return;
    }
    if (!query.trim()) {
      cancelActive();
      clearResults();
      setStatus("");
      return;
    }

    const id = ++searchSeq;
    activeId = id;
    clearResults();
    searching = true;
    setStatus(t("search.searching"));

    try {
      await invoke("search_workspace", {
        requestId: id,
        root: workspace,
        query,
        matchCase,
        wholeWord,
        useRegex,
        excludes: {
          ...excludes,
          enabled: useExcludes.checked,
          customDirs: [...excludes.customDirs],
        },
      });
    } catch (err) {
      if (activeId !== id) {
        return;
      }
      searching = false;
      activeId = 0;
      const message = err instanceof Error ? err.message : String(err);
      setStatus(t("search.error", { error: message.replace(/^invalid regex:\s*/i, "") }));
    }
  };

  const scheduleSearch = () => {
    window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(() => {
      void runSearch();
    }, DEBOUNCE_MS);
  };

  const open = () => {
    const explorer = host.explorer();
    if (explorer?.isOpen() && explorer.getView() === "search") {
      explorer.setOpen(false);
      return;
    }
    explorer?.openView("search");
    queryInput.focus();
    queryInput.select();
  };

  const focus = () => {
    host.explorer()?.openView("search");
    queryInput.focus();
    queryInput.select();
  };

  const syncLocale = () => {
    setTooltip(button, t("search.toggle"));
    button.setAttribute("aria-label", t("search.toggle"));
    setTooltip(optCase, t("search.matchCase"));
    setTooltip(optWord, t("search.wholeWord"));
    setTooltip(optRegex, t("search.regex"));
    setTooltip(settingsBtn, t("search.excludeSettingsTitle"));
    settingsBtn.setAttribute("aria-label", t("search.excludeSettingsTitle"));
    queryInput.placeholder = t("search.placeholder");
    sxCustomInput.placeholder = t("search.excludeCustomPlaceholder");
    if (!workspace && !queryInput.value.trim()) {
      setStatus(t("search.noWorkspace"));
    }
  };

  button.addEventListener("click", () => open());
  queryInput.addEventListener("input", () => scheduleSearch());
  queryInput.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      window.clearTimeout(debounceTimer);
      void runSearch();
    }
  });

  const toggleOpt = (which: "case" | "word" | "regex") => {
    if (which === "case") {
      matchCase = !matchCase;
    } else if (which === "word") {
      wholeWord = !wholeWord;
    } else {
      useRegex = !useRegex;
    }
    syncOptButtons();
    scheduleSearch();
  };
  optCase.addEventListener("click", () => toggleOpt("case"));
  optWord.addEventListener("click", () => toggleOpt("word"));
  optRegex.addEventListener("click", () => toggleOpt("regex"));

  useExcludes.addEventListener("change", () => {
    excludes = { ...excludes, enabled: useExcludes.checked };
    persistExcludes();
    scheduleSearch();
  });
  settingsBtn.addEventListener("click", () => setDialogOpen(true));
  sxCancel.addEventListener("click", () => setDialogOpen(false));
  sxSave.addEventListener("click", () => {
    excludes = readDialogToExcludes();
    syncMasterToggle();
    persistExcludes();
    setDialogOpen(false);
    scheduleSearch();
  });
  sxCustomAdd.addEventListener("click", () => addCustomDir());
  sxCustomInput.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      addCustomDir();
    }
  });
  dialog.addEventListener("click", (ev) => {
    if (ev.target === dialog) {
      setDialogOpen(false);
    }
  });
  window.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && !dialog.hidden) {
      ev.preventDefault();
      setDialogOpen(false);
    }
  });

  syncOptButtons();
  syncMasterToggle();

  void (async () => {
    try {
      const offHits = await listen<HitsEvent>("search-hits", (event) => {
        if (event.payload.id !== activeId) {
          return;
        }
        for (const hit of event.payload.hits) {
          let list = hitsByFile.get(hit.path);
          if (!list) {
            list = [];
            hitsByFile.set(hit.path, list);
            fileOrder.push(hit.path);
          }
          list.push(hit);
        }
        renderResults();
        const total = [...hitsByFile.values()].reduce((n, list) => n + list.length, 0);
        setStatus(t("search.progress", { matches: String(total), files: String(fileOrder.length) }));
      });
      const offDone = await listen<DoneEvent>("search-done", (event) => {
        if (event.payload.id !== activeId) {
          return;
        }
        searching = false;
        if (event.payload.cancelled) {
          return;
        }
        if (event.payload.error) {
          setStatus(t("search.error", { error: event.payload.error }));
          return;
        }
        if (event.payload.matchCount === 0) {
          setStatus(t("search.noResults"));
          return;
        }
        const key = event.payload.truncated ? "search.doneTruncated" : "search.done";
        setStatus(
          t(key, {
            matches: String(event.payload.matchCount),
            files: String(fileOrder.length),
            scanned: String(event.payload.filesSearched),
          }),
        );
      });
      unsubscribers = [offHits, offDone];
    } catch (err) {
      console.warn("failed to listen for search events", err);
    }
  })();

  syncLocale();
  if (!workspace) {
    setStatus(t("search.noWorkspace"));
  }

  return {
    open,
    focus,
    setWorkspace(path) {
      workspace = path;
      if (!path) {
        cancelActive();
        clearResults();
        setStatus(t("search.noWorkspace"));
        return;
      }
      if (queryInput.value.trim()) {
        scheduleSearch();
      } else {
        setStatus("");
      }
    },
    applyExcludeSettings(settings) {
      excludes = mergeExcludeSettings(defaultExcludeSettings(), settings);
      syncMasterToggle();
    },
    syncLocale,
    dispose() {
      window.clearTimeout(debounceTimer);
      cancelActive();
      for (const off of unsubscribers) {
        off();
      }
      unsubscribers = [];
    },
  };
}
