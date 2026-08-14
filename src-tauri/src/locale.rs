use crate::paths;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use tauri::AppHandle;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocaleInfo {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocaleFile {
    pub id: String,
    pub name: String,
    pub strings: HashMap<String, String>,
}

#[derive(Debug, Deserialize)]
struct LocaleManifest {
    #[serde(default)]
    name: String,
    #[serde(default)]
    strings: HashMap<String, String>,
}

fn locale_id_from_path(path: &std::path::Path) -> Option<String> {
    if path.extension().and_then(|e| e.to_str()) != Some("json") {
        return None;
    }
    path.file_stem()
        .and_then(|s| s.to_str())
        .map(|s| s.to_string())
}

fn read_locale_file(path: &std::path::Path, id: &str) -> Result<LocaleFile, String> {
    let text = fs::read_to_string(path).map_err(|e| format!("read {}: {e}", path.display()))?;
    let manifest: LocaleManifest =
        serde_json::from_str(&text).map_err(|e| format!("parse {}: {e}", path.display()))?;
    Ok(LocaleFile {
        id: id.to_string(),
        name: if manifest.name.is_empty() {
            id.to_string()
        } else {
            manifest.name
        },
        strings: manifest.strings,
    })
}

pub fn list_locales(app: &AppHandle) -> Result<Vec<LocaleInfo>, String> {
    let root = paths::locale_dir(app);
    if !root.is_dir() {
        return Ok(Vec::new());
    }

    let mut locales = Vec::new();
    let entries = fs::read_dir(&root).map_err(|e| format!("read locale dir: {e}"))?;
    for entry in entries {
        let path = entry.map_err(|e| format!("read locale entry: {e}"))?.path();
        if !path.is_file() {
            continue;
        }
        let Some(id) = locale_id_from_path(&path) else {
            continue;
        };
        match read_locale_file(&path, &id) {
            Ok(file) => locales.push(LocaleInfo {
                id: file.id,
                name: file.name,
            }),
            Err(err) => eprintln!("{err}"),
        }
    }

    locales.sort_by(|a, b| {
        match (a.id.as_str(), b.id.as_str()) {
            ("en", "en") => std::cmp::Ordering::Equal,
            ("en", _) => std::cmp::Ordering::Less,
            (_, "en") => std::cmp::Ordering::Greater,
            _ => a.id.cmp(&b.id),
        }
    });
    Ok(locales)
}

pub fn load_locale(app: &AppHandle, id: &str) -> Result<LocaleFile, String> {
    let root = paths::locale_dir(app);
    let requested = root.join(format!("{id}.json"));
    if requested.is_file() {
        return read_locale_file(&requested, id);
    }

    let fallback = root.join("en.json");
    if fallback.is_file() {
        return read_locale_file(&fallback, "en");
    }

    let locales = list_locales(app)?;
    let Some(first) = locales.first() else {
        return Err("no locale files found".into());
    };
    read_locale_file(&root.join(format!("{}.json", first.id)), &first.id)
}
