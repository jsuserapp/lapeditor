use crate::paths;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::time::Duration;
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanguagePlugin {
    pub id: String,
    pub aliases: Vec<String>,
    pub extensions: Vec<String>,
    pub scope_name: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub grammar_json: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanguagePluginInfo {
    pub id: String,
    pub aliases: Vec<String>,
    pub extensions: Vec<String>,
    pub scope_name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanguageCatalogItem {
    pub id: String,
    pub aliases: Vec<String>,
    pub extensions: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct LanguageManifest {
    id: String,
    #[serde(default)]
    aliases: Vec<String>,
    #[serde(default)]
    extensions: Vec<String>,
    #[serde(rename = "scopeName")]
    scope_name: String,
    grammar: String,
    #[serde(default)]
    formatter: Option<ManifestFormatter>,
}

#[derive(Debug, Deserialize)]
struct ManifestFormatter {
    kind: String,
    program: Option<String>,
    #[serde(default)]
    args: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct CommandFormatterSpec {
    pub program: String,
    pub args: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct CatalogFile {
    #[serde(default = "default_repo")]
    repo: String,
    #[serde(default = "default_ref", rename = "ref")]
    git_ref: String,
    languages: Vec<CatalogLang>,
}

#[derive(Debug, Deserialize)]
struct CatalogLang {
    id: String,
    #[serde(default)]
    aliases: Vec<String>,
    #[serde(default)]
    extensions: Vec<String>,
    #[serde(rename = "scopeName")]
    scope_name: String,
    path: String,
    repo: Option<String>,
    #[serde(rename = "ref")]
    git_ref: Option<String>,
}

fn default_repo() -> String {
    "microsoft/vscode".into()
}

fn default_ref() -> String {
    "main".into()
}

pub fn valid_language_id(id: &str) -> bool {
    let mut chars = id.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    first.is_ascii_alphanumeric()
        && chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
        && !id.contains("..")
}

fn catalog_path(app: &AppHandle) -> PathBuf {
    if let Ok(custom) = std::env::var("LAPEDITOR_LANGUAGE_CATALOG") {
        return PathBuf::from(custom);
    }
    let portable = paths::plugin_dir().join("language-catalog.json");
    if portable.is_file() {
        return portable;
    }
    if let Ok(resource) = app.path().resource_dir() {
        let bundled = resource.join("plugin").join("language-catalog.json");
        if bundled.is_file() {
            return bundled;
        }
    }
    portable
}

fn load_catalog_file(app: &AppHandle) -> Result<CatalogFile, String> {
    let path = catalog_path(app);
    let text = fs::read_to_string(&path).map_err(|e| format!("read {}: {e}", path.display()))?;
    serde_json::from_str(&text).map_err(|e| format!("parse {}: {e}", path.display()))
}

fn read_manifests(app: &AppHandle) -> Result<Vec<(std::path::PathBuf, LanguageManifest)>, String> {
    let root = paths::languages_dir(app);
    if !root.is_dir() {
        return Ok(Vec::new());
    }
    let mut manifests = Vec::new();
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
        manifests.push((path, manifest));
    }
    manifests.sort_by(|a, b| a.1.id.cmp(&b.1.id));
    Ok(manifests)
}

pub fn command_formatter_for(app: &AppHandle, language_id: &str) -> Option<CommandFormatterSpec> {
    let Ok(manifests) = read_manifests(app) else {
        return None;
    };
    manifests.into_iter().find_map(|(_, manifest)| {
        if !manifest.id.eq_ignore_ascii_case(language_id) {
            return None;
        }
        let formatter = manifest.formatter?;
        if !formatter.kind.eq_ignore_ascii_case("command") {
            return None;
        }
        let program = formatter.program?.trim().to_string();
        if program.is_empty() {
            return None;
        }
        Some(CommandFormatterSpec {
            program,
            args: formatter.args,
        })
    })
}

pub fn list_language_plugin_info(app: &AppHandle) -> Result<Vec<LanguagePluginInfo>, String> {
    Ok(read_manifests(app)?
        .into_iter()
        .map(|(_, manifest)| LanguagePluginInfo {
            id: manifest.id,
            aliases: manifest.aliases,
            extensions: manifest.extensions,
            scope_name: manifest.scope_name,
        })
        .collect())
}

pub fn load_language_grammars(app: &AppHandle) -> Result<std::collections::HashMap<String, String>, String> {
    let mut grammars = std::collections::HashMap::new();
    for (dir, manifest) in read_manifests(app)? {
        let grammar_path = dir.join(&manifest.grammar);
        let grammar_json =
            fs::read_to_string(&grammar_path).map_err(|e| format!("read {}: {e}", grammar_path.display()))?;
        grammars.insert(manifest.id, grammar_json);
    }
    Ok(grammars)
}

pub fn list_language_catalog(app: &AppHandle) -> Result<Vec<LanguageCatalogItem>, String> {
    let catalog = load_catalog_file(app)?;
    let installed = list_language_plugin_info(app)?;
    let installed_ids: Vec<String> = installed.into_iter().map(|p| p.id).collect();
    let mut items: Vec<LanguageCatalogItem> = catalog
        .languages
        .into_iter()
        .filter(|lang| !installed_ids.iter().any(|id| id.eq_ignore_ascii_case(&lang.id)))
        .map(|lang| LanguageCatalogItem {
            id: lang.id,
            aliases: lang.aliases,
            extensions: lang.extensions,
        })
        .collect();
    items.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(items)
}

async fn download_text(url: &str) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .user_agent("Lapeditor/0.1")
        .build()
        .map_err(|e| format!("http client: {e}"))?;
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("download {url}: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("download {url}: HTTP {}", response.status()));
    }
    response
        .text()
        .await
        .map_err(|e| format!("download {url}: {e}"))
}

async fn download_grammar(repo: &str, git_ref: &str, path: &str) -> Result<String, String> {
    let urls = [
        format!("https://cdn.jsdelivr.net/gh/{repo}@{git_ref}/{path}"),
        format!("https://raw.githubusercontent.com/{repo}/{git_ref}/{path}"),
    ];
    let mut last_error = String::from("no grammar URL");
    for url in urls {
        match download_text(&url).await {
            Ok(body) => return Ok(body),
            Err(err) => last_error = err,
        }
    }
    Err(last_error)
}

pub async fn install_language_plugin(app: &AppHandle, language_id: &str) -> Result<LanguagePlugin, String> {
    let id = language_id.trim();
    if !valid_language_id(id) {
        return Err(format!("invalid language id: {id}"));
    }

    let catalog = load_catalog_file(app)?;
    let lang = catalog
        .languages
        .iter()
        .find(|item| item.id.eq_ignore_ascii_case(id))
        .ok_or_else(|| format!("language not in catalog: {id}"))?;

    let existing = list_language_plugin_info(app)?;
    if existing.iter().any(|plugin| plugin.id.eq_ignore_ascii_case(&lang.id)) {
        return Err(format!("{} is already installed", lang.id));
    }

    let repo = lang.repo.as_deref().unwrap_or(&catalog.repo);
    let git_ref = lang.git_ref.as_deref().unwrap_or(&catalog.git_ref);
    let grammar_json = download_grammar(repo, git_ref, &lang.path).await?;
    let parsed: serde_json::Value =
        serde_json::from_str(&grammar_json).map_err(|e| format!("grammar is not JSON: {e}"))?;
    let grammar_scope = parsed
        .get("scopeName")
        .and_then(|v| v.as_str())
        .unwrap_or(&lang.scope_name);
    if grammar_scope != lang.scope_name {
        return Err(format!(
            "grammar scopeName {grammar_scope} does not match catalog {}",
            lang.scope_name
        ));
    }

    let dir = paths::languages_dir(app).join(&lang.id);
    if dir.exists() {
        return Err(format!("{} is already installed", lang.id));
    }
    fs::create_dir_all(&dir).map_err(|e| format!("create {}: {e}", dir.display()))?;

    let grammar_name = "grammar.tmLanguage.json";
    let write_result = (|| {
        fs::write(dir.join(grammar_name), &grammar_json)
            .map_err(|e| format!("write grammar: {e}"))?;
        let manifest = serde_json::json!({
            "id": lang.id,
            "aliases": lang.aliases,
            "extensions": lang.extensions,
            "scopeName": lang.scope_name,
            "grammar": grammar_name,
        });
        let manifest_text = serde_json::to_string_pretty(&manifest)
            .map_err(|e| format!("encode language.json: {e}"))?;
        fs::write(dir.join("language.json"), manifest_text + "\n")
            .map_err(|e| format!("write language.json: {e}"))?;
        Ok::<(), String>(())
    })();

    if let Err(err) = write_result {
        let _ = fs::remove_dir_all(&dir);
        return Err(err);
    }

    Ok(LanguagePlugin {
        id: lang.id.clone(),
        aliases: lang.aliases.clone(),
        extensions: lang.extensions.clone(),
        scope_name: lang.scope_name.clone(),
        grammar_json,
    })
}
