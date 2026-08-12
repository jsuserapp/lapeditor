mod languages;

use languages::{load_language_plugins, LanguagePlugin};
use std::fs;
use std::path::PathBuf;
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

fn file_path_to_string(path: tauri_plugin_dialog::FilePath) -> Option<String> {
    path.into_path()
        .ok()
        .map(|p| p.to_string_lossy().into_owned())
}

#[tauri::command]
fn list_language_plugins(app: AppHandle) -> Result<Vec<LanguagePlugin>, String> {
    load_language_plugins(&app)
}

#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| format!("read {path}: {e}"))
}

#[tauri::command]
fn write_text_file(path: String, contents: String) -> Result<(), String> {
    fs::write(&path, contents).map_err(|e| format!("write {path}: {e}"))
}

#[tauri::command]
fn pick_open_file(app: AppHandle) -> Result<Option<String>, String> {
    let file = app.dialog().file().set_title("Open File").blocking_pick_file();
    Ok(file.and_then(file_path_to_string))
}

#[tauri::command]
fn pick_save_file(app: AppHandle, default_name: Option<String>) -> Result<Option<String>, String> {
    let mut builder = app.dialog().file().set_title("Save File");
    if let Some(name) = default_name {
        builder = builder.set_file_name(name);
    }
    let file = builder.blocking_save_file();
    Ok(file.and_then(file_path_to_string))
}

#[tauri::command]
fn language_id_for_path(app: AppHandle, path: String) -> Result<Option<String>, String> {
    let ext = PathBuf::from(&path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| format!(".{}", e.to_ascii_lowercase()));

    let Some(ext) = ext else {
        return Ok(None);
    };

    let plugins = load_language_plugins(&app)?;
    Ok(plugins
        .into_iter()
        .find(|p| {
            p.extensions
                .iter()
                .any(|candidate| candidate.eq_ignore_ascii_case(&ext))
        })
        .map(|p| p.id))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            list_language_plugins,
            read_text_file,
            write_text_file,
            pick_open_file,
            pick_save_file,
            language_id_for_path
        ])
        .run(tauri::generate_context!())
        .expect("error while running Lapeditor");
}
