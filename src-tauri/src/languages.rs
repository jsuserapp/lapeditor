use crate::paths;
use serde::Serialize;
use std::fs;
use tauri::AppHandle;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanguagePlugin {
    pub id: String,
    pub aliases: Vec<String>,
    pub extensions: Vec<String>,
    pub scope_name: String,
    pub grammar_json: String,
}

#[derive(Debug, serde::Deserialize)]
struct LanguageManifest {
    id: String,
    #[serde(default)]
    aliases: Vec<String>,
    #[serde(default)]
    extensions: Vec<String>,
    #[serde(rename = "scopeName")]
    scope_name: String,
    grammar: String,
}

pub fn load_language_plugins(app: &AppHandle) -> Result<Vec<LanguagePlugin>, String> {
    let root = paths::languages_dir(app);
    if !root.is_dir() {
        return Ok(Vec::new());
    }

    let mut plugins = Vec::new();
    let entries = fs::read_dir(&root).map_err(|e| format!("read languages dir: {e}"))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("read languages entry: {e}"))?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        let manifest_path = path.join("language.json");
        if !manifest_path.is_file() {
            continue;
        }

        let manifest_text =
            fs::read_to_string(&manifest_path).map_err(|e| format!("read {}: {e}", manifest_path.display()))?;
        let manifest: LanguageManifest = serde_json::from_str(&manifest_text)
            .map_err(|e| format!("parse {}: {e}", manifest_path.display()))?;

        let grammar_path = path.join(&manifest.grammar);
        let grammar_json =
            fs::read_to_string(&grammar_path).map_err(|e| format!("read {}: {e}", grammar_path.display()))?;

        let _: serde_json::Value = serde_json::from_str(&grammar_json)
            .map_err(|e| format!("invalid grammar JSON {}: {e}", grammar_path.display()))?;

        plugins.push(LanguagePlugin {
            id: manifest.id,
            aliases: manifest.aliases,
            extensions: manifest.extensions,
            scope_name: manifest.scope_name,
            grammar_json,
        });
    }

    plugins.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(plugins)
}
