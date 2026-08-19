use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

pub fn app_root() -> PathBuf {
    if let Ok(dir) = std::env::var("LAPEDITOR_ROOT") {
        return PathBuf::from(dir);
    }

    #[cfg(debug_assertions)]
    {
        let dev = Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
        if let Ok(canonical) = fs::canonicalize(&dev) {
            return canonical;
        }
        return dev;
    }

    #[cfg(not(debug_assertions))]
    {
        std::env::current_exe()
            .ok()
            .and_then(|exe| exe.parent().map(Path::to_path_buf))
            .unwrap_or_else(|| PathBuf::from("."))
    }
}

pub fn config_dir() -> PathBuf {
    app_root().join("config")
}

pub fn plugin_dir() -> PathBuf {
    app_root().join("plugin")
}

fn dir_has_json(dir: &Path) -> bool {
    fs::read_dir(dir)
        .ok()
        .map(|entries| {
            entries.flatten().any(|entry| {
                entry.path().extension().and_then(|e| e.to_str()) == Some("json")
            })
        })
        .unwrap_or(false)
}

pub fn languages_dir(app: &AppHandle) -> PathBuf {
    if let Ok(dir) = std::env::var("LAPEDITOR_LANGUAGES_DIR") {
        return PathBuf::from(dir);
    }

    let portable = plugin_dir().join("languages");
    if portable.is_dir() {
        return portable;
    }

    if let Ok(resource) = app.path().resource_dir() {
        let bundled = resource.join("plugin").join("languages");
        if bundled.is_dir() {
            return bundled;
        }
    }

    portable
}

pub fn locale_dir(app: &AppHandle) -> PathBuf {
    if let Ok(dir) = std::env::var("LAPEDITOR_LOCALE_DIR") {
        return PathBuf::from(dir);
    }

    let portable = app_root().join("locale");
    if portable.is_dir() && dir_has_json(&portable) {
        return portable;
    }

    if let Ok(resource) = app.path().resource_dir() {
        let bundled = resource.join("locale");
        if bundled.is_dir() && dir_has_json(&bundled) {
            return bundled;
        }
    }

    portable
}

pub fn seed_locale_files(app: &AppHandle) {
    let portable = app_root().join("locale");
    if fs::create_dir_all(&portable).is_err() || dir_has_json(&portable) {
        return;
    }

    let Ok(resource) = app.path().resource_dir() else {
        return;
    };
    let bundled = resource.join("locale");
    let Ok(entries) = fs::read_dir(&bundled) else {
        return;
    };
    for entry in entries.flatten() {
        let from = entry.path();
        if from.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        if let Some(name) = from.file_name() {
            let _ = fs::copy(&from, portable.join(name));
        }
    }
}

pub fn data_dir() -> PathBuf {
    app_root().join("data")
}

pub fn session_dir() -> PathBuf {
    data_dir().join("session")
}

pub fn session_index_path() -> PathBuf {
    session_dir().join("index.json")
}

pub fn recycle_bin_path() -> PathBuf {
    data_dir().join("recycle-bin.json")
}

fn path_key(path: &Path) -> String {
    let buf = fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    let raw = buf.to_string_lossy();
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

pub fn is_session_path(path: &Path) -> bool {
    let key = path_key(path);
    let root = path_key(&session_dir());
    key == root || key.starts_with(&format!("{root}/"))
}

pub fn deny_if_session_path(path: &str) -> Result<(), String> {
    if is_session_path(Path::new(path)) {
        Err("session-cache".into())
    } else {
        Ok(())
    }
}

pub fn webview_data_dir() -> PathBuf {
    data_dir().join("webview")
}

pub fn settings_path() -> PathBuf {
    config_dir().join("settings.json")
}

pub fn formatters_path() -> PathBuf {
    config_dir().join("formatters.json")
}

pub fn window_state_path() -> PathBuf {
    config_dir().join("window.json")
}

pub fn ensure_layout() -> Result<(), String> {
    for dir in [
        config_dir(),
        plugin_dir().join("languages"),
        app_root().join("locale"),
        data_dir(),
        webview_data_dir(),
        session_dir(),
    ] {
        fs::create_dir_all(&dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
    }
    Ok(())
}
