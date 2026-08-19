use crate::paths;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionTab {
    pub id: String,
    #[serde(default)]
    pub title: String,
    pub path: Option<String>,
    pub language_id: String,
    #[serde(default)]
    pub dirty: bool,
    /// Filled on load from `{id}.txt` or a legacy inline `content` field. Never written to index.json.
    #[serde(default)]
    pub content: String,
    pub view_state: Option<serde_json::Value>,
    #[serde(default)]
    pub last_disk_mtime_ms: Option<u64>,
    #[serde(default)]
    pub last_disk_size: Option<u64>,
    #[serde(default)]
    pub encoding: Option<String>,
    #[serde(default)]
    pub disk_loaded: Option<u64>,
    #[serde(default)]
    pub disk_size: Option<u64>,
    #[serde(default)]
    pub view_mode: Option<String>,
    #[serde(default)]
    pub md_preview: Option<bool>,
    #[serde(default)]
    pub md_view: Option<String>,
    #[serde(default)]
    pub md_scroll_top: f64,
    #[serde(default)]
    pub pdf_page: Option<u32>,
    #[serde(default)]
    pub pdf_scale: Option<f64>,
    #[serde(default)]
    pub trashed: bool,
    #[serde(default)]
    pub trashed_at: Option<u64>,
    #[serde(default)]
    pub read_only: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub active_id: Option<String>,
    #[serde(default)]
    pub tabs: Vec<SessionTab>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyRecycleBin {
    #[serde(default)]
    items: Vec<LegacyRecycleItem>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyRecycleItem {
    id: String,
    #[serde(default)]
    content: String,
    #[serde(default)]
    language_id: String,
    #[serde(default)]
    encoding: Option<String>,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn is_safe_tab_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 80
        && id != "index"
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn tab_content_path(id: &str) -> Option<std::path::PathBuf> {
    if !is_safe_tab_id(id) {
        return None;
    }
    Some(paths::session_dir().join(format!("{id}.txt")))
}

fn write_atomic(path: &Path, data: impl AsRef<[u8]>) -> Result<(), String> {
    let tmp = path.with_extension("tmp");
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("create {}: {e}", parent.display()))?;
    }
    fs::write(&tmp, data.as_ref()).map_err(|e| format!("write {}: {e}", tmp.display()))?;
    if path.exists() {
        fs::remove_file(path).map_err(|e| format!("replace {}: {e}", path.display()))?;
    }
    fs::rename(&tmp, path).map_err(|e| format!("rename {}: {e}", path.display()))
}

fn write_tab_content(id: &str, content: &str) -> Result<(), String> {
    let path = tab_content_path(id).ok_or_else(|| format!("invalid tab id {id}"))?;
    write_atomic(&path, content)
}

fn read_tab_content(id: &str) -> Option<String> {
    let path = tab_content_path(id)?;
    fs::read_to_string(path).ok()
}

fn save_index(session: &Session) -> Result<(), String> {
    let dir = paths::session_dir();
    fs::create_dir_all(&dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
    let mut slim = session.clone();
    for tab in &mut slim.tabs {
        tab.content.clear();
    }
    let json = serde_json::to_string_pretty(&slim).map_err(|e| e.to_string())?;
    write_atomic(&paths::session_index_path(), json)
}

fn prune_content_files(keep: &HashSet<String>) {
    let Ok(entries) = fs::read_dir(paths::session_dir()) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let ext = path.extension().and_then(|e| e.to_str());
        if ext == Some("tmp") {
            let _ = fs::remove_file(&path);
            continue;
        }
        if ext != Some("txt") {
            continue;
        }
        let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else {
            continue;
        };
        if !keep.contains(stem) {
            let _ = fs::remove_file(path);
        }
    }
}

fn migrate_legacy_recycle_bin(session: &mut Session) -> bool {
    let path = paths::recycle_bin_path();
    let Ok(text) = fs::read_to_string(&path) else {
        return false;
    };
    let Ok(bin) = serde_json::from_str::<LegacyRecycleBin>(&text) else {
        return false;
    };
    if bin.items.is_empty() {
        let _ = fs::remove_file(&path);
        return false;
    }

    let mut used: HashSet<String> = session.tabs.iter().map(|tab| tab.id.clone()).collect();
    let mut stamp = now_ms();
    let mut imported = false;
    for item in bin.items {
        if item.content.trim().is_empty() {
            continue;
        }
        let mut id = item.id;
        if !is_safe_tab_id(&id) || used.contains(&id) {
            id = format!("tab-trash-{stamp}");
        }
        if write_tab_content(&id, &item.content).is_err() {
            continue;
        }
        used.insert(id.clone());
        session.tabs.push(SessionTab {
            id,
            title: String::new(),
            path: None,
            language_id: if item.language_id.is_empty() {
                "plaintext".into()
            } else {
                item.language_id
            },
            dirty: true,
            content: item.content,
            view_state: None,
            last_disk_mtime_ms: None,
            last_disk_size: None,
            encoding: item.encoding,
            disk_loaded: None,
            disk_size: None,
            view_mode: None,
            md_preview: None,
            md_view: None,
            md_scroll_top: 0.0,
            pdf_page: None,
            pdf_scale: None,
            trashed: true,
            trashed_at: Some(stamp),
            read_only: false,
        });
        stamp = stamp.saturating_sub(1);
        imported = true;
    }
    let _ = fs::remove_file(&path);
    imported
}

pub fn load_session() -> Session {
    let path = paths::session_index_path();
    let mut session: Session = fs::read_to_string(&path)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default();

    let mut wrote_files = false;
    for tab in &mut session.tabs {
        if let Some(text) = read_tab_content(&tab.id) {
            tab.content = text;
        } else if !tab.content.is_empty() {
            if write_tab_content(&tab.id, &tab.content).is_ok() {
                wrote_files = true;
            }
        }
    }
    let imported = migrate_legacy_recycle_bin(&mut session);
    if wrote_files || imported {
        let _ = save_index(&session);
    }
    session
}

pub fn save_session(
    mut session: Session,
    contents: Option<HashMap<String, String>>,
) -> Result<(), String> {
    let keep: HashSet<String> = session
        .tabs
        .iter()
        .filter(|tab| tab.trashed || tab.dirty)
        .map(|tab| tab.id.clone())
        .collect();
    if let Some(contents) = contents {
        for (id, text) in contents {
            if keep.contains(&id) {
                write_tab_content(&id, &text)?;
            }
        }
    }
    for tab in &mut session.tabs {
        tab.content.clear();
    }
    save_index(&session)?;
    prune_content_files(&keep);
    Ok(())
}
