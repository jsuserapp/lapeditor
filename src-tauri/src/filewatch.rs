use notify::{Event, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileStat {
    pub mtime_ms: u64,
    pub size: u64,
    pub readonly: bool,
}

struct WatchRuntime {
    watcher: Option<RecommendedWatcher>,
}

pub struct FileWatchState {
    runtime: Mutex<Option<WatchRuntime>>,
    generation: AtomicU64,
    watched: Mutex<HashMap<String, String>>,
    ignore_until: Mutex<HashMap<String, Instant>>,
    last_emitted: Mutex<HashMap<String, Instant>>,
    explorer_runtime: Mutex<Option<WatchRuntime>>,
    explorer_generation: AtomicU64,
    explorer_dirs: Mutex<HashMap<String, String>>,
    explorer_expanded: Mutex<HashMap<String, String>>,
    explorer_last_emitted: Mutex<HashMap<String, Instant>>,
}

impl FileWatchState {
    pub fn new() -> Self {
        Self {
            runtime: Mutex::new(None),
            generation: AtomicU64::new(0),
            watched: Mutex::new(HashMap::new()),
            ignore_until: Mutex::new(HashMap::new()),
            last_emitted: Mutex::new(HashMap::new()),
            explorer_runtime: Mutex::new(None),
            explorer_generation: AtomicU64::new(0),
            explorer_dirs: Mutex::new(HashMap::new()),
            explorer_expanded: Mutex::new(HashMap::new()),
            explorer_last_emitted: Mutex::new(HashMap::new()),
        }
    }
}

impl Drop for FileWatchState {
    fn drop(&mut self) {
        self.generation.fetch_add(1, Ordering::Relaxed);
        self.explorer_generation.fetch_add(1, Ordering::Relaxed);
        // RecommendedWatcher::drop can block forever on Windows if the notify
        // thread is joining during process teardown. Leak it; the process is exiting.
        if let Ok(mut runtime) = self.runtime.lock() {
            if let Some(mut runtime) = runtime.take() {
                if let Some(watcher) = runtime.watcher.take() {
                    std::mem::forget(watcher);
                }
            }
        }
        if let Ok(mut runtime) = self.explorer_runtime.lock() {
            if let Some(mut runtime) = runtime.take() {
                if let Some(watcher) = runtime.watcher.take() {
                    std::mem::forget(watcher);
                }
            }
        }
    }
}

fn path_key(path: &Path) -> String {
    let raw = path.to_string_lossy();
    let trimmed = raw
        .strip_prefix(r"\\?\")
        .or_else(|| raw.strip_prefix("//?/"))
        .unwrap_or(raw.as_ref());
    let unified = trimmed.replace('\\', "/");
    if cfg!(windows) {
        unified.to_ascii_lowercase()
    } else {
        unified
    }
}

pub fn stat_text_file(path: &str) -> Result<FileStat, String> {
    let meta = fs::metadata(path).map_err(|e| format!("stat {path}: {e}"))?;
    let mtime_ms = meta
        .modified()
        .unwrap_or(SystemTime::UNIX_EPOCH)
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    Ok(FileStat {
        mtime_ms,
        size: meta.len(),
        readonly: meta.permissions().readonly(),
    })
}

pub fn mark_self_write(state: &FileWatchState, path: &str) {
    let mut ignore = state.ignore_until.lock().unwrap_or_else(|e| e.into_inner());
    ignore.insert(path_key(Path::new(path)), Instant::now() + Duration::from_millis(1200));
}

fn should_ignore(state: &FileWatchState, key: &str) -> bool {
    let mut ignore = state.ignore_until.lock().unwrap_or_else(|e| e.into_inner());
    ignore.retain(|_, until| Instant::now() < *until);
    ignore.contains_key(key)
}

fn emit_original(app: &AppHandle, state: &FileWatchState, original: &str) {
    let key = path_key(Path::new(original));
    if should_ignore(state, &key) {
        return;
    }

    let mut last = state.last_emitted.lock().unwrap_or_else(|e| e.into_inner());
    let now = Instant::now();
    if last
        .get(&key)
        .is_some_and(|prev| now.saturating_duration_since(*prev) < Duration::from_millis(80))
    {
        return;
    }
    last.insert(key, now);
    drop(last);

    let _ = app.emit("external-file-changed", original.to_string());
}

fn emit_if_watched(app: &AppHandle, state: &FileWatchState, path: &Path) {
    let key = path_key(path);
    let original = {
        let watched = state.watched.lock().unwrap_or_else(|e| e.into_inner());
        watched.get(&key).cloned()
    };
    if let Some(original) = original {
        emit_original(app, state, &original);
    }
}

fn emit_all_watched(app: &AppHandle, state: &FileWatchState) {
    let originals: Vec<String> = {
        let watched = state.watched.lock().unwrap_or_else(|e| e.into_inner());
        watched.values().cloned().collect()
    };
    for original in originals {
        emit_original(app, state, &original);
    }
}

fn handle_notify_event(app: &AppHandle, event: Event) {
    let Some(file_watch) = app.try_state::<FileWatchState>() else {
        return;
    };
    if event.need_rescan() {
        emit_all_watched(app, &file_watch);
        return;
    }
    if !matches!(
        event.kind,
        notify::EventKind::Modify(_) | notify::EventKind::Remove(_) | notify::EventKind::Create(_)
    ) {
        return;
    }
    for path in event.paths {
        emit_if_watched(app, &file_watch, &path);
    }
}

fn stop_runtime(state: &FileWatchState) {
    state.generation.fetch_add(1, Ordering::Relaxed);
    let mut runtime = state.runtime.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(mut runtime) = runtime.take() {
        if let Some(watcher) = runtime.watcher.take() {
            std::mem::forget(watcher);
        }
    }
}

pub fn watch_text_files(app: AppHandle, paths: Vec<String>) -> Result<(), String> {
    let state = app.state::<FileWatchState>();
    let unique: Vec<String> = {
        let mut seen = HashSet::new();
        paths
            .into_iter()
            .filter(|p| !p.is_empty() && !crate::paths::is_session_path(Path::new(p)) && seen.insert(path_key(Path::new(p))))
            .collect()
    };

    {
        let mut watched = state.watched.lock().unwrap_or_else(|e| e.into_inner());
        watched.clear();
        for path in &unique {
            watched.insert(path_key(Path::new(path)), path.clone());
        }
    }

    stop_runtime(&state);

    if unique.is_empty() {
        return Ok(());
    }

    let generation = state.generation.load(Ordering::Relaxed);
    let (tx, rx) = mpsc::sync_channel::<Event>(32);
    let mut watcher = notify::recommended_watcher(move |result: Result<Event, notify::Error>| {
        if let Ok(event) = result {
            let _ = tx.try_send(event);
        }
    })
    .map_err(|e| format!("create watcher: {e}"))?;

    let mut dirs: HashSet<PathBuf> = HashSet::new();
    for path in &unique {
        let path = PathBuf::from(path);
        match path.parent() {
            Some(parent) if !parent.as_os_str().is_empty() => {
                dirs.insert(parent.to_path_buf());
            }
            _ => {
                dirs.insert(path);
            }
        }
    }
    for dir in &dirs {
        if dir.exists() {
            let _ = watcher.watch(dir, RecursiveMode::NonRecursive);
        }
    }

    let app_for_watch = app.clone();
    std::thread::Builder::new()
        .name("lapeditor-filewatch".into())
        .spawn(move || loop {
            let stale = match app_for_watch.try_state::<FileWatchState>() {
                None => true,
                Some(s) => s.generation.load(Ordering::Relaxed) != generation,
            };
            if stale {
                break;
            }
            match rx.recv_timeout(Duration::from_millis(250)) {
                Ok(event) => handle_notify_event(&app_for_watch, event),
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => break,
            }
        })
        .map_err(|e| format!("start watcher thread: {e}"))?;

    let mut runtime = state.runtime.lock().unwrap_or_else(|e| e.into_inner());
    *runtime = Some(WatchRuntime {
        watcher: Some(watcher),
    });
    Ok(())
}

fn stop_explorer_runtime(state: &FileWatchState) {
    state.explorer_generation.fetch_add(1, Ordering::Relaxed);
    let mut runtime = state.explorer_runtime.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(mut runtime) = runtime.take() {
        if let Some(watcher) = runtime.watcher.take() {
            std::mem::forget(watcher);
        }
    }
}

fn emit_explorer_dir(app: &AppHandle, state: &FileWatchState, original: &str) {
    let key = path_key(Path::new(original));
    let mut last = state.explorer_last_emitted.lock().unwrap_or_else(|e| e.into_inner());
    let now = Instant::now();
    if last
        .get(&key)
        .is_some_and(|prev| now.saturating_duration_since(*prev) < Duration::from_millis(120))
    {
        return;
    }
    last.insert(key, now);
    drop(last);
    let _ = app.emit("explorer-dir-changed", original.to_string());
}

fn is_under_root(path: &Path, root_key: &str) -> bool {
    let key = path_key(path);
    key == root_key || key.starts_with(&format!("{root_key}/"))
}

fn emit_explorer_for_path(app: &AppHandle, state: &FileWatchState, path: &Path) {
    let dirs = state.explorer_dirs.lock().unwrap_or_else(|e| e.into_inner());
    let Some(root) = dirs.values().next().cloned() else {
        return;
    };
    let root_key = path_key(Path::new(&root));
    drop(dirs);
    if !is_under_root(path, &root_key) {
        return;
    }
    let parent_key = if path_key(path) == root_key {
        root_key
    } else if let Some(parent) = path.parent() {
        path_key(parent)
    } else {
        return;
    };
    let expanded = state.explorer_expanded.lock().unwrap_or_else(|e| e.into_inner());
    let Some(original) = expanded.get(&parent_key).cloned() else {
        return;
    };
    drop(expanded);
    emit_explorer_dir(app, state, &original);
}

fn handle_explorer_event(app: &AppHandle, event: Event) {
    let Some(file_watch) = app.try_state::<FileWatchState>() else {
        return;
    };
    if event.need_rescan() {
        let originals: Vec<String> = {
            let expanded = file_watch.explorer_expanded.lock().unwrap_or_else(|e| e.into_inner());
            expanded.values().cloned().collect()
        };
        for original in originals {
            emit_explorer_dir(app, &file_watch, &original);
        }
        return;
    }
    if !matches!(
        event.kind,
        notify::EventKind::Create(_)
            | notify::EventKind::Remove(_)
            | notify::EventKind::Modify(notify::event::ModifyKind::Name(_))
    ) {
        return;
    }
    for path in event.paths {
        emit_explorer_for_path(app, &file_watch, &path);
    }
}

pub fn watch_explorer_dirs(app: AppHandle, paths: Vec<String>) -> Result<(), String> {
    let state = app.state::<FileWatchState>();
    let unique: Vec<String> = {
        let mut seen = HashSet::new();
        paths
            .into_iter()
            .filter(|p| !p.is_empty() && seen.insert(path_key(Path::new(p))))
            .collect()
    };

    {
        let mut dirs = state.explorer_dirs.lock().unwrap_or_else(|e| e.into_inner());
        dirs.clear();
        for path in &unique {
            dirs.insert(path_key(Path::new(path)), path.clone());
        }
    }

    stop_explorer_runtime(&state);

    if unique.is_empty() {
        state.explorer_expanded.lock().unwrap_or_else(|e| e.into_inner()).clear();
        return Ok(());
    }

    let generation = state.explorer_generation.load(Ordering::Relaxed);
    let (tx, rx) = mpsc::sync_channel::<Event>(512);
    let mut watcher = notify::recommended_watcher(move |result: Result<Event, notify::Error>| {
        if let Ok(event) = result {
            let _ = tx.try_send(event);
        }
    })
    .map_err(|e| format!("create explorer watcher: {e}"))?;

    if let Some(path) = unique.first() {
        let dir = PathBuf::from(path);
        if dir.is_dir() {
            watcher
                .watch(&dir, RecursiveMode::Recursive)
                .map_err(|e| format!("watch {}: {e}", dir.display()))?;
        }
    }

    let app_for_watch = app.clone();
    std::thread::Builder::new()
        .name("lapeditor-explorer-watch".into())
        .spawn(move || loop {
            let stale = match app_for_watch.try_state::<FileWatchState>() {
                None => true,
                Some(s) => s.explorer_generation.load(Ordering::Relaxed) != generation,
            };
            if stale {
                break;
            }
            match rx.recv_timeout(Duration::from_millis(250)) {
                Ok(event) => handle_explorer_event(&app_for_watch, event),
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => break,
            }
        })
        .map_err(|e| format!("start explorer watcher thread: {e}"))?;

    let mut runtime = state.explorer_runtime.lock().unwrap_or_else(|e| e.into_inner());
    *runtime = Some(WatchRuntime {
        watcher: Some(watcher),
    });
    Ok(())
}

pub fn set_explorer_expanded(app: AppHandle, paths: Vec<String>) {
    let state = app.state::<FileWatchState>();
    let mut expanded = state.explorer_expanded.lock().unwrap_or_else(|e| e.into_inner());
    expanded.clear();
    for path in paths {
        if path.is_empty() {
            continue;
        }
        expanded.insert(path_key(Path::new(&path)), path);
    }
}
