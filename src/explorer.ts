import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { t } from "./i18n";
import { setTooltip } from "./tooltip";

export const EXPLORER_WIDTH_MIN = 160;
export const EXPLORER_WIDTH_MAX = 560;
export const EXPLORER_WIDTH_DEFAULT = 240;

export type DirEntryDto = {
  name: string;
  path: string;
  isDir: boolean;
};

export type ExplorerApi = {
  setOpen: (open: boolean) => void;
  isOpen: () => boolean;
  toggle: () => void;
  setWorkspace: (path: string | null) => Promise<void>;
  revealPath: (path: string | null) => void;
  syncLocale: () => void;
  applyInitial: (open: boolean, width: number, folder: string | null) => Promise<void>;
};

type ExplorerHost = {
  onOpenFile: (path: string) => void;
  onLayout: () => void;
  onPersist: (patch: {
    explorerOpen?: boolean;
    explorerWidth?: number;
    workspaceFolder?: string;
  }) => void;
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
  const gutter = document.querySelector<HTMLDivElement>("#sidebar-gutter")!;
  const tree = document.querySelector<HTMLDivElement>("#explorer-tree")!;
  const toggleBtn = document.querySelector<HTMLButtonElement>("#btn-explorer")!;
  const folderBtn = document.querySelector<HTMLButtonElement>("#btn-explorer-folder")!;

  let open = false;
  let width = EXPLORER_WIDTH_DEFAULT;
  let workspace: string | null = null;
  let selected: string | null = null;
  const expanded = new Set<string>();
  const children = new Map<string, DirEntryDto[]>();
  const dirPaths = new Map<string, string>();
  const refreshTimers = new Map<string, number>();
  let watchTimer: number | undefined;
  let expandedTimer: number | undefined;

  const applyOpen = (next: boolean) => {
    open = next;
    workbench.classList.toggle("explorer-open", open);
    sidebar.hidden = !open;
    gutter.hidden = !open;
    toggleBtn.setAttribute("aria-pressed", open ? "true" : "false");
    if (open) {
      applyExplorerWidth(workbench, width);
    }
    host.onLayout();
  };

  const persist = (patch: {
    explorerOpen?: boolean;
    explorerWidth?: number;
    workspaceFolder?: string;
  }) => {
    host.onPersist(patch);
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
  };

  const selectRow = (row: HTMLElement, path: string) => {
    selected = path;
    tree.querySelectorAll(".tree-row.active").forEach((el) => el.classList.remove("active"));
    row.classList.add("active");
  };

  const renderNode = (entry: DirEntryDto, depth: number): HTMLElement => {
    const key = pathKey(entry.path);
    const node = document.createElement("div");
    node.className = `tree-node${entry.isDir && expanded.has(key) ? " expanded" : ""}`;
    node.dataset.path = entry.path;
    node.style.setProperty("--tree-depth", String(depth));

    const row = document.createElement("div");
    row.className = `tree-row${entry.isDir ? " dir" : " file"}${
      selected && pathKey(selected) === key ? " active" : ""
    }`;
    row.title = entry.name;

    const twist = document.createElement("span");
    twist.className = "tree-twist";
    const name = document.createElement("span");
    name.className = "tree-name";
    name.textContent = entry.name;
    row.append(twist, name);
    node.appendChild(row);

    row.addEventListener("click", (ev) => {
      ev.stopPropagation();
      selectRow(row, entry.path);
      if (!entry.isDir) {
        host.onOpenFile(entry.path);
        return;
      }
      const onTwist = (ev.target as HTMLElement).closest(".tree-twist");
      if (onTwist || !expanded.has(key)) {
        void toggleDir(entry.path, node, depth);
      }
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
      } catch (err) {
        console.warn("failed to open workspace", workspace, err);
        workspace = null;
      }
    }
    renderTree();
    scheduleWatch();
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
    if (!path || !workspace || !open) {
      tree.querySelectorAll(".tree-row.active").forEach((el) => el.classList.remove("active"));
      if (path) {
        const row = [...tree.querySelectorAll<HTMLElement>(".tree-row")].find((el) => {
          const node = el.closest<HTMLElement>(".tree-node");
          return node?.dataset.path && pathKey(node.dataset.path) === pathKey(path);
        });
        row?.classList.add("active");
      }
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
    })();
  };

  const syncLocale = () => {
    setTooltip(toggleBtn, t("explorer.toggle"));
    setTooltip(folderBtn, t("explorer.openFolderTitle"));
    if (!workspace) {
      renderEmpty();
    }
  };

  toggleBtn.addEventListener("click", () => {
    applyOpen(!open);
    persist({ explorerOpen: open });
  });
  folderBtn.addEventListener("click", () => void pickFolder());

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
    setWorkspace,
    revealPath,
    syncLocale,
    applyInitial(nextOpen, nextWidth, folder) {
      width = clampExplorerWidth(nextWidth);
      applyExplorerWidth(workbench, width);
      applyOpen(nextOpen);
      return setWorkspace(folder);
    },
  };
}
