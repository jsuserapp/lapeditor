import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { confirmDialog } from "./confirm";
import { t } from "./i18n";
import { promptName } from "./name-dialog";
import { setTooltip } from "./tooltip";

export const EXPLORER_WIDTH_MIN = 160;
export const EXPLORER_WIDTH_MAX = 560;
export const EXPLORER_WIDTH_DEFAULT = 240;

export type DirEntryDto = {
  name: string;
  path: string;
  isDir: boolean;
};

export type SidebarView = "explorer" | "search";

export type ExplorerApi = {
  setOpen: (open: boolean) => void;
  isOpen: () => boolean;
  toggle: () => void;
  setView: (view: SidebarView) => void;
  getView: () => SidebarView;
  openView: (view: SidebarView) => void;
  getWorkspace: () => string | null;
  setWorkspace: (path: string | null) => Promise<void>;
  revealPath: (path: string | null) => void;
  syncLocale: () => void;
  applyInitial: (open: boolean, width: number, folder: string | null) => Promise<void>;
};

type ExplorerHost = {
  onOpenFile: (path: string) => void;
  onPathsRemoved?: (path: string, isDir: boolean) => void;
  onLayout: () => void;
  onPersist: (patch: {
    explorerOpen?: boolean;
    explorerWidth?: number;
    workspaceFolder?: string;
  }) => void;
  onViewChange?: (view: SidebarView) => void;
  onWorkspaceChange?: (path: string | null) => void;
  isProtectedPath?: (path: string) => boolean;
};

function pathKey(path: string) {
  return path.replace(/^\\\\\?\\/, "").replace(/\\/g, "/").toLowerCase();
}

function basename(path: string) {
  const parts = path.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || path;
}

function parentPath(path: string) {
  const idx = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return idx < 0 ? "" : path.slice(0, idx);
}

function invokeError(err: unknown): string {
  if (typeof err === "string") {
    return err;
  }
  if (err && typeof err === "object" && "message" in err) {
    return String((err as { message: unknown }).message);
  }
  return String(err);
}

function explorerActionError(err: unknown): string {
  const raw = invokeError(err);
  if (raw === "empty") {
    return t("explorer.errEmptyName");
  }
  if (raw === "invalid") {
    return t("explorer.errInvalidName");
  }
  if (raw === "exists") {
    return t("explorer.errExists");
  }
  if (raw === "not_dir") {
    return t("explorer.errNotDir");
  }
  if (raw === "not_found") {
    return t("explorer.errNotFound");
  }
  if (raw === "session-cache") {
    return t("explorer.errProtected");
  }
  return t("explorer.errFailed", { error: raw.replace(/^io:\s*/i, "") });
}

function validateEntryName(name: string): string | null {
  const value = name.trim();
  if (!value) {
    return t("explorer.errEmptyName");
  }
  if (
    value === "." ||
    value === ".." ||
    /[\\/<>:"|?*\u0000-\u001f]/.test(value) ||
    /[. ]$/.test(value)
  ) {
    return t("explorer.errInvalidName");
  }
  return null;
}

export function clampExplorerWidth(width: number, hostWidth?: number) {
  if (!Number.isFinite(width)) {
    return EXPLORER_WIDTH_DEFAULT;
  }
  let max = EXPLORER_WIDTH_MAX;
  if (hostWidth && hostWidth > 0) {
    max = Math.min(max, Math.max(EXPLORER_WIDTH_MIN, hostWidth - 236));
  }
  return Math.min(max, Math.max(EXPLORER_WIDTH_MIN, Math.round(width)));
}

export function applyExplorerWidth(workbench: HTMLElement, width: number) {
  const value = clampExplorerWidth(width, workbench.clientWidth);
  workbench.style.setProperty("--sidebar-width", `${value}px`);
  return value;
}

export function bindExplorer(host: ExplorerHost): ExplorerApi {
  const workbench = document.querySelector<HTMLDivElement>("#workbench")!;
  const sidebar = document.querySelector<HTMLElement>("#sidebar")!;
  const explorerPanel = document.querySelector<HTMLDivElement>("#explorer-panel")!;
  const searchPanel = document.querySelector<HTMLDivElement>("#search-panel")!;
  const gutter = document.querySelector<HTMLDivElement>("#sidebar-gutter")!;
  const tree = document.querySelector<HTMLDivElement>("#explorer-tree")!;
  const toggleBtn = document.querySelector<HTMLButtonElement>("#btn-explorer")!;
  const searchBtn = document.querySelector<HTMLButtonElement>("#btn-search")!;
  const folderBtn = document.querySelector<HTMLButtonElement>("#btn-explorer-folder")!;
  const newFileBtn = document.querySelector<HTMLButtonElement>("#btn-explorer-new-file")!;
  const newFolderBtn = document.querySelector<HTMLButtonElement>("#btn-explorer-new-folder")!;
  const deleteBtn = document.querySelector<HTMLButtonElement>("#btn-explorer-delete")!;
  const treeMenu = document.querySelector<HTMLDivElement>("#explorer-context-menu")!;
  const treeMenuOpen = document.querySelector<HTMLButtonElement>("#explorer-ctx-open-folder")!;
  const treeMenuDelete = document.querySelector<HTMLButtonElement>("#explorer-ctx-delete")!;
  const treeMenuSep = treeMenu.querySelector<HTMLElement>(".popover-sep");

  let open = false;
  let view: SidebarView = "explorer";
  let width = EXPLORER_WIDTH_DEFAULT;
  let workspace: string | null = null;
  let selected: string | null = null;
  let selectedIsDir = false;
  const expanded = new Set<string>();
  const children = new Map<string, DirEntryDto[]>();
  const dirPaths = new Map<string, string>();
  const refreshTimers = new Map<string, number>();
  let watchTimer: number | undefined;
  let expandedTimer: number | undefined;
  let menuTarget: { path: string; isDir: boolean } | null = null;

  const applyView = (next: SidebarView) => {
    view = next;
    explorerPanel.hidden = view !== "explorer";
    searchPanel.hidden = view !== "search";
    toggleBtn.setAttribute("aria-pressed", open && view === "explorer" ? "true" : "false");
    searchBtn.setAttribute("aria-pressed", open && view === "search" ? "true" : "false");
    host.onViewChange?.(view);
    if (view !== "explorer") {
      hideTreeContextMenu();
    }
  };

  const applyOpen = (next: boolean) => {
    open = next;
    workbench.classList.toggle("explorer-open", open);
    sidebar.hidden = !open;
    gutter.hidden = !open;
    if (open) {
      applyExplorerWidth(workbench, width);
      applyView(view);
    } else {
      toggleBtn.setAttribute("aria-pressed", "false");
      searchBtn.setAttribute("aria-pressed", "false");
    }
    host.onLayout();
    if (!open) {
      hideTreeContextMenu();
    }
  };

  const persist = (patch: {
    explorerOpen?: boolean;
    explorerWidth?: number;
    workspaceFolder?: string;
  }) => {
    host.onPersist(patch);
  };

  const isProtected = (path: string | null | undefined) => {
    return !!path && !!host.isProtectedPath?.(path);
  };

  const syncExplorerActions = () => {
    const hasSel = !!workspace && !!selected;
    const protectedSel = isProtected(selected);
    const folderSel = hasSel && selectedIsDir && !protectedSel;
    newFileBtn.disabled = !folderSel;
    newFolderBtn.disabled = !folderSel;
    deleteBtn.disabled = !hasSel || protectedSel;
    setTooltip(newFileBtn, protectedSel ? t("explorer.protected") : t("explorer.newFileTitle"));
    setTooltip(newFolderBtn, protectedSel ? t("explorer.protected") : t("explorer.newFolderTitle"));
    setTooltip(deleteBtn, protectedSel ? t("explorer.protected") : t("explorer.deleteTitle"));
  };

  const renderEmpty = () => {
    tree.replaceChildren();
    const box = document.createElement("div");
    box.className = "explorer-empty";
    const hint = document.createElement("p");
    hint.textContent = t("explorer.empty");
    const action = document.createElement("button");
    action.type = "button";
    action.className = "explorer-empty-action";
    action.textContent = t("explorer.openFolder");
    action.addEventListener("click", () => void pickFolder());
    box.append(hint, action);
    tree.appendChild(box);
    selected = null;
    selectedIsDir = false;
    syncExplorerActions();
  };

  const selectRow = (row: HTMLElement, path: string, isDir: boolean) => {
    selected = path;
    selectedIsDir = isDir;
    tree.querySelectorAll(".tree-row.active").forEach((el) => el.classList.remove("active"));
    row.classList.add("active");
    syncExplorerActions();
  };

  const renderNode = (entry: DirEntryDto, depth: number): HTMLElement => {
    const key = pathKey(entry.path);
    const node = document.createElement("div");
    node.className = `tree-node${entry.isDir && expanded.has(key) ? " expanded" : ""}`;
    node.dataset.path = entry.path;
    node.style.setProperty("--tree-depth", String(depth));

    const protectedEntry = isProtected(entry.path);
    const row = document.createElement("div");
    row.className = `tree-row${entry.isDir ? " dir" : " file"}${
      selected && pathKey(selected) === key ? " active" : ""
    }${protectedEntry ? " protected" : ""}`;
    row.title = protectedEntry ? `${entry.name} · ${t("explorer.protected")}` : entry.name;

    const twist = document.createElement("span");
    twist.className = "tree-twist";
    const name = document.createElement("span");
    name.className = "tree-name";
    name.textContent = entry.name;
    row.append(twist, name);
    node.appendChild(row);

    row.addEventListener("click", (ev) => {
      ev.stopPropagation();
      selectRow(row, entry.path, entry.isDir);
      if (!entry.isDir) {
        host.onOpenFile(entry.path);
        return;
      }
      const onTwist = (ev.target as HTMLElement).closest(".tree-twist");
      if (onTwist || !expanded.has(key)) {
        void toggleDir(entry.path, node, depth);
      }
    });
    row.addEventListener("contextmenu", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      showTreeContextMenu(entry, ev.clientX, ev.clientY);
    });

    if (entry.isDir && expanded.has(key)) {
      const kids = children.get(key);
      if (kids) {
        const wrap = document.createElement("div");
        wrap.className = "tree-children";
        for (const child of kids) {
          wrap.appendChild(renderNode(child, depth + 1));
        }
        node.appendChild(wrap);
      }
    }
    return node;
  };

  const renderTree = () => {
    if (!workspace) {
      renderEmpty();
      return;
    }
    tree.replaceChildren();
    const root: DirEntryDto = {
      name: basename(workspace),
      path: workspace,
      isDir: true,
    };
    expanded.add(pathKey(workspace));
    tree.appendChild(renderNode(root, 0));
    syncExplorerActions();
  };

  const loadDir = async (path: string) => {
    const key = pathKey(path);
    const entries = await invoke<DirEntryDto[]>("list_dir_entries", { path });
    children.set(key, entries);
    dirPaths.set(key, path);
    return entries;
  };

  const sameEntries = (left: DirEntryDto[], right: DirEntryDto[]) => {
    return (
      left.length === right.length &&
      left.every(
        (entry, index) =>
          pathKey(entry.path) === pathKey(right[index].path) && entry.isDir === right[index].isDir,
      )
    );
  };

  const findNode = (path: string) => {
    const key = pathKey(path);
    return [...tree.querySelectorAll<HTMLElement>(".tree-node")].find(
      (el) => el.dataset.path && pathKey(el.dataset.path) === key,
    );
  };

  const pruneMissing = (parentKey: string, liveChildKeys: Set<string>) => {
    const prefix = `${parentKey}/`;
    for (const childKey of [...children.keys(), ...expanded]) {
      if (childKey === parentKey || !childKey.startsWith(prefix)) {
        continue;
      }
      const top = `${parentKey}/${childKey.slice(prefix.length).split("/")[0]}`;
      if (!liveChildKeys.has(top)) {
        children.delete(childKey);
        expanded.delete(childKey);
        dirPaths.delete(childKey);
      }
    }
  };

  const scheduleWatch = () => {
    if (watchTimer !== undefined) {
      clearTimeout(watchTimer);
    }
    watchTimer = window.setTimeout(() => {
      watchTimer = undefined;
      const paths = workspace ? [workspace] : [];
      void invoke("watch_explorer_dirs", { paths }).catch((err) => {
        console.warn("failed to watch workspace folder", err);
      });
      scheduleExpanded();
    }, 50);
  };

  const scheduleExpanded = () => {
    if (expandedTimer !== undefined) {
      clearTimeout(expandedTimer);
    }
    expandedTimer = window.setTimeout(() => {
      expandedTimer = undefined;
      const paths = [...expanded].map((key) => dirPaths.get(key)).filter((path): path is string => !!path);
      void invoke("set_explorer_expanded", { paths }).catch((err) => {
        console.warn("failed to sync expanded folders", err);
      });
    }, 50);
  };

  const refreshDir = async (path: string) => {
    const key = pathKey(path);
    if (!workspace || !expanded.has(key)) {
      return;
    }
    const rootKey = pathKey(workspace);
    const previous = children.get(key) ?? [];
    let entries: DirEntryDto[];
    try {
      entries = await loadDir(path);
    } catch {
      expanded.delete(key);
      children.delete(key);
      dirPaths.delete(key);
      scheduleExpanded();
      const parent = parentPath(path);
      if (parent && pathKey(parent).startsWith(rootKey)) {
        await refreshDir(parent);
      } else if (key === rootKey) {
        renderTree();
      }
      return;
    }
    const live = new Set(entries.map((entry) => pathKey(entry.path)));
    pruneMissing(key, live);
    scheduleExpanded();
    if (selected && !live.has(pathKey(selected)) && pathKey(selected).startsWith(`${key}/`)) {
      const stillThere = [...live].some((child) => pathKey(selected!).startsWith(`${child}/`));
      if (!stillThere) {
        selected = path;
      }
    }
    const node = findNode(path);
    if (!node || !expanded.has(key) || (previous.length > 0 && sameEntries(previous, entries))) {
      return;
    }
    const depth = Number(node.style.getPropertyValue("--tree-depth") || 0);
    node.querySelector(":scope > .tree-children")?.remove();
    const wrap = document.createElement("div");
    wrap.className = "tree-children";
    for (const child of entries) {
      wrap.appendChild(renderNode(child, depth + 1));
    }
    node.appendChild(wrap);
  };

  const scheduleRefresh = (path: string) => {
    const key = pathKey(path);
    const prev = refreshTimers.get(key);
    if (prev !== undefined) {
      clearTimeout(prev);
    }
    refreshTimers.set(
      key,
      window.setTimeout(() => {
        refreshTimers.delete(key);
        void refreshDir(path);
      }, 160),
    );
  };

  const toggleDir = async (path: string, node: HTMLElement, depth: number) => {
    const key = pathKey(path);
    if (expanded.has(key)) {
      expanded.delete(key);
      node.classList.remove("expanded");
      node.querySelector(":scope > .tree-children")?.remove();
      scheduleExpanded();
      return;
    }
    try {
      const entries = await loadDir(path);
      expanded.add(key);
      node.classList.add("expanded");
      node.querySelector(":scope > .tree-children")?.remove();
      const wrap = document.createElement("div");
      wrap.className = "tree-children";
      for (const child of entries) {
        wrap.appendChild(renderNode(child, depth + 1));
      }
      node.appendChild(wrap);
      scheduleExpanded();
    } catch (err) {
      console.warn("failed to list folder", path, err);
    }
  };

  const setWorkspace = async (path: string | null) => {
    workspace = path && path.trim() ? path : null;
    children.clear();
    expanded.clear();
    dirPaths.clear();
    if (workspace) {
      try {
        await loadDir(workspace);
        expanded.add(pathKey(workspace));
        selected = workspace;
        selectedIsDir = true;
      } catch (err) {
        console.warn("failed to open workspace", workspace, err);
        workspace = null;
        selected = null;
        selectedIsDir = false;
      }
    } else {
      selected = null;
      selectedIsDir = false;
    }
    renderTree();
    scheduleWatch();
    syncExplorerActions();
    host.onWorkspaceChange?.(workspace);
  };

  const showCreated = async (parent: string, created: string, isDir: boolean) => {
    expanded.add(pathKey(parent));
    dirPaths.set(pathKey(parent), parent);
    try {
      await loadDir(parent);
    } catch (err) {
      console.warn("failed to refresh folder after create", parent, err);
    }
    selected = created;
    selectedIsDir = isDir;
    renderTree();
    scheduleExpanded();
    const row = [...tree.querySelectorAll<HTMLElement>(".tree-row")].find((el) => {
      const node = el.closest<HTMLElement>(".tree-node");
      return node?.dataset.path && pathKey(node.dataset.path) === pathKey(created);
    });
    row?.classList.add("active");
    row?.scrollIntoView({ block: "nearest" });
    syncExplorerActions();
    if (!isDir) {
      host.onOpenFile(created);
    }
  };

  const createInSelection = async (isDir: boolean) => {
    if (!selected || !selectedIsDir || isProtected(selected)) {
      return;
    }
    const folder = selected;
    const folderName = basename(folder);
    await promptName({
      title: isDir ? t("explorer.newFolderTitle") : t("explorer.newFileTitle"),
      hint: t(isDir ? "explorer.newFolderHint" : "explorer.newFileHint", { folder: folderName }),
      label: t("explorer.nameLabel"),
      confirmLabel: t("explorer.create"),
      validate: validateEntryName,
      async submit(name) {
        try {
          const created = await invoke<string>("create_fs_entry", {
            parent: folder,
            name,
            isDir,
          });
          await showCreated(folder, created, isDir);
        } catch (err) {
          throw new Error(explorerActionError(err));
        }
      },
    });
  };

  const hideTreeContextMenu = () => {
    treeMenu.hidden = true;
    menuTarget = null;
  };

  const showTreeContextMenu = (entry: DirEntryDto, clientX: number, clientY: number) => {
    const mdMenu = document.querySelector<HTMLDivElement>("#md-preview-context-menu");
    if (mdMenu) {
      mdMenu.hidden = true;
    }
    menuTarget = { path: entry.path, isDir: entry.isDir };
    const protectedEntry = isProtected(entry.path);
    treeMenuDelete.hidden = protectedEntry;
    treeMenuDelete.disabled = protectedEntry;
    if (treeMenuSep) {
      treeMenuSep.hidden = protectedEntry;
    }
    treeMenuOpen.textContent = entry.isDir
      ? t("explorer.openInFileManager")
      : t("explorer.openContainingFolder");
    treeMenu.hidden = false;
    const pad = 8;
    const rect = treeMenu.getBoundingClientRect();
    const left = Math.min(clientX, window.innerWidth - rect.width - pad);
    const top = Math.min(clientY, window.innerHeight - rect.height - pad);
    treeMenu.style.left = `${Math.max(pad, left)}px`;
    treeMenu.style.top = `${Math.max(pad, top)}px`;
  };

  const openInFileManager = async (path: string, isDir: boolean) => {
    try {
      await invoke("open_in_file_manager", { path, isDir });
    } catch (err) {
      console.warn("failed to open in file manager", err);
    }
  };

  const deleteEntry = async (target: string, isDir: boolean) => {
    if (!workspace || isProtected(target)) {
      return;
    }
    const name = basename(target);
    const result = await confirmDialog({
      title: isDir ? t("explorer.deleteFolderTitle") : t("explorer.deleteFileTitle"),
      message: t(isDir ? "explorer.deleteFolder" : "explorer.deleteFile", { name }),
      kind: "warning",
      buttons: [
        { id: "delete", label: t("explorer.deleteConfirm"), role: "danger" },
        { id: "cancel", label: t("dialog.cancel") },
      ],
      defaultId: "cancel",
      cancelId: "cancel",
    });
    if (result !== "delete") {
      return;
    }
    try {
      await invoke("delete_fs_entry", { path: target });
    } catch (err) {
      await confirmDialog({
        title: t("explorer.deleteTitle"),
        message: explorerActionError(err),
        kind: "error",
        buttons: [{ id: "ok", label: t("dialog.ok"), role: "primary" }],
        defaultId: "ok",
        cancelId: "ok",
      });
      return;
    }
    host.onPathsRemoved?.(target, isDir);
    if (pathKey(target) === pathKey(workspace)) {
      await setWorkspace(null);
      persist({ workspaceFolder: "" });
      return;
    }
    const parent = parentPath(target) || workspace;
    const selKey = selected ? pathKey(selected) : "";
    const removedKey = pathKey(target);
    const selectionAffected =
      !!selKey &&
      (selKey === removedKey || (isDir && selKey.startsWith(`${removedKey}/`)));
    if (selectionAffected) {
      selected = parent;
      selectedIsDir = true;
    }
    expanded.delete(pathKey(target));
    children.delete(pathKey(target));
    dirPaths.delete(pathKey(target));
    if (parent) {
      try {
        await loadDir(parent);
      } catch (err) {
        console.warn("failed to refresh folder after delete", parent, err);
      }
    }
    renderTree();
    scheduleExpanded();
    syncExplorerActions();
  };

  const deleteSelection = async () => {
    if (!selected || !workspace) {
      return;
    }
    await deleteEntry(selected, selectedIsDir);
  };

  const pickFolder = async () => {
    const path = await invoke<string | null>("pick_open_folder", {
      title: t("explorer.openFolderTitle"),
    });
    if (!path) {
      return;
    }
    await setWorkspace(path);
    persist({ workspaceFolder: path });
    if (!open) {
      applyOpen(true);
      persist({ explorerOpen: true });
    }
  };

  const revealPath = (path: string | null) => {
    selected = path;
    selectedIsDir = false;
    if (!path || !workspace || !open) {
      tree.querySelectorAll(".tree-row.active").forEach((el) => el.classList.remove("active"));
      if (path) {
        const row = [...tree.querySelectorAll<HTMLElement>(".tree-row")].find((el) => {
          const node = el.closest<HTMLElement>(".tree-node");
          return node?.dataset.path && pathKey(node.dataset.path) === pathKey(path);
        });
        row?.classList.add("active");
      }
      syncExplorerActions();
      return;
    }
    const rootKey = pathKey(workspace);
    const fileKey = pathKey(path);
    if (fileKey !== rootKey && !fileKey.startsWith(`${rootKey}/`)) {
      renderTree();
      return;
    }
    void (async () => {
      let current = parentPath(path);
      const chain: string[] = [];
      while (current && pathKey(current).startsWith(rootKey)) {
        chain.unshift(current);
        if (pathKey(current) === rootKey) {
          break;
        }
        current = parentPath(current);
      }
      for (const dir of chain) {
        if (!children.has(pathKey(dir))) {
          try {
            await loadDir(dir);
          } catch {
            break;
          }
        }
        expanded.add(pathKey(dir));
        dirPaths.set(pathKey(dir), dir);
      }
      renderTree();
      scheduleExpanded();
      const row = [...tree.querySelectorAll<HTMLElement>(".tree-row")].find((el) => {
        const node = el.closest<HTMLElement>(".tree-node");
        return node?.dataset.path && pathKey(node.dataset.path) === fileKey;
      });
      row?.classList.add("active");
      row?.scrollIntoView({ block: "nearest" });
      syncExplorerActions();
    })();
  };

  const syncLocale = () => {
    setTooltip(toggleBtn, t("explorer.toggle"));
    setTooltip(folderBtn, t("explorer.openFolderTitle"));
    syncExplorerActions();
    if (!workspace) {
      renderEmpty();
    }
  };

  toggleBtn.addEventListener("click", () => {
    if (open && view === "explorer") {
      applyOpen(false);
      persist({ explorerOpen: false });
      return;
    }
    applyView("explorer");
    applyOpen(true);
    persist({ explorerOpen: true });
  });
  folderBtn.addEventListener("click", () => void pickFolder());
  newFileBtn.addEventListener("click", () => void createInSelection(false));
  newFolderBtn.addEventListener("click", () => void createInSelection(true));
  deleteBtn.addEventListener("click", () => void deleteSelection());
  treeMenuOpen.addEventListener("click", () => {
    const target = menuTarget;
    hideTreeContextMenu();
    if (target) {
      void openInFileManager(target.path, target.isDir);
    }
  });
  treeMenuDelete.addEventListener("click", () => {
    const target = menuTarget;
    hideTreeContextMenu();
    if (target) {
      void deleteEntry(target.path, target.isDir);
    }
  });
  document.addEventListener("pointerdown", (ev) => {
    if (treeMenu.hidden) {
      return;
    }
    const node = ev.target;
    if (node instanceof Node && treeMenu.contains(node)) {
      return;
    }
    hideTreeContextMenu();
  });
  window.addEventListener("blur", () => hideTreeContextMenu());
  window.addEventListener("resize", () => hideTreeContextMenu());
  syncExplorerActions();

  let dragging = false;
  const onMove = (ev: MouseEvent) => {
    if (!dragging) {
      return;
    }
    const rect = workbench.getBoundingClientRect();
    width = applyExplorerWidth(workbench, ev.clientX - rect.left - 36);
    host.onLayout();
  };
  const onUp = () => {
    if (!dragging) {
      return;
    }
    dragging = false;
    workbench.classList.remove("explorer-resizing");
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
    persist({ explorerWidth: width });
  };
  void listen<string>("explorer-dir-changed", (event) => {
    if (!workspace) {
      return;
    }
    scheduleRefresh(event.payload);
  }).catch((err) => {
    console.warn("failed to listen for explorer changes", err);
  });

  gutter.addEventListener("mousedown", (ev) => {
    if (ev.button !== 0 || !open) {
      return;
    }
    ev.preventDefault();
    dragging = true;
    workbench.classList.add("explorer-resizing");
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  });

  return {
    setOpen(next) {
      applyOpen(next);
    },
    isOpen: () => open,
    toggle() {
      applyOpen(!open);
      persist({ explorerOpen: open });
    },
    setView(next) {
      applyView(next);
    },
    getView: () => view,
    openView(next) {
      applyView(next);
      applyOpen(true);
      persist({ explorerOpen: true });
    },
    getWorkspace: () => workspace,
    setWorkspace,
    revealPath,
    syncLocale,
    applyInitial(nextOpen, nextWidth, folder) {
      width = clampExplorerWidth(nextWidth);
      applyExplorerWidth(workbench, width);
      applyView("explorer");
      applyOpen(nextOpen);
      return setWorkspace(folder);
    },
  };
}
