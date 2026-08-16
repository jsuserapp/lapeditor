use crate::paths;
use serde::{Deserialize, Serialize};
use std::fs;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionTab {
    pub id: String,
    pub title: String,
    pub path: Option<String>,
    pub language_id: String,
    #[serde(default)]
    pub dirty: bool,
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
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub active_id: Option<String>,
    #[serde(default)]
    pub tabs: Vec<SessionTab>,
}

pub fn load_session() -> Session {
    let path = paths::session_index_path();
    fs::read_to_string(&path)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

pub fn save_session(session: Session) -> Result<(), String> {
    let dir = paths::session_dir();
    fs::create_dir_all(&dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
    let path = paths::session_index_path();
    let json = serde_json::to_string_pretty(&session).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| format!("write {}: {e}", path.display()))
}
