mod config;
mod encoding;
mod filebytes;
mod filewatch;
mod languages;
mod locale;
mod paths;
mod session;

use encoding::TextFile;
use filewatch::{stat_text_file as stat_text_file_impl, watch_text_files as watch_text_files_impl, FileStat, FileWatchState};
use languages::{
    install_language_plugin as install_language_plugin_impl,
    list_language_catalog as list_language_catalog_impl,
    list_language_plugin_info, load_language_grammars as load_language_grammars_impl,
    LanguageCatalogItem, LanguagePlugin, LanguagePluginInfo,
};
use locale::{LocaleFile, LocaleInfo};
use std::path::PathBuf;
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

fn file_path_to_string(path: tauri_plugin_dialog::FilePath) -> Option<String> {
    path.into_path()
        .ok()
        .map(|p| p.to_string_lossy().into_owned())
}

#[tauri::command]
fn list_language_plugins(app: tauri::AppHandle) -> Result<Vec<LanguagePluginInfo>, String> {
    list_language_plugin_info(&app)
}

#[tauri::command]
fn load_language_grammars(
    app: tauri::AppHandle,
) -> Result<std::collections::HashMap<String, String>, String> {
    load_language_grammars_impl(&app)
}

#[tauri::command]
fn list_language_catalog(app: tauri::AppHandle) -> Result<Vec<LanguageCatalogItem>, String> {
    list_language_catalog_impl(&app)
}

#[tauri::command]
async fn install_language_plugin(
    app: tauri::AppHandle,
    language_id: String,
) -> Result<LanguagePlugin, String> {
    install_language_plugin_impl(&app, &language_id).await
}

#[tauri::command]
fn read_text_file(path: String, encoding: Option<String>) -> Result<TextFile, String> {
    encoding::read_text_file(&path, encoding.as_deref())
}

#[tauri::command]
fn write_text_file(
    app: tauri::AppHandle,
    path: String,
    contents: String,
    encoding: Option<String>,
) -> Result<(), String> {
    let state = app.state::<FileWatchState>();
    filewatch::mark_self_write(&state, &path);
    encoding::write_text_file(&path, &contents, encoding.as_deref().unwrap_or("utf-8"))
}

#[tauri::command]
fn reinterpret_text(contents: String, from: String, to: String) -> String {
    encoding::reinterpret_text(&contents, &from, &to)
}

#[tauri::command]
fn read_file_bytes(path: String, offset: u64, length: u64) -> Result<filebytes::FileBytesChunk, String> {
    filebytes::read_file_bytes(&path, offset, length)
}

#[tauri::command]
fn write_file_bytes(
    app: tauri::AppHandle,
    path: String,
    data: String,
    tail_offset: Option<u64>,
    tail_from: Option<String>,
) -> Result<(), String> {
    let state = app.state::<FileWatchState>();
    filewatch::mark_self_write(&state, &path);
    filebytes::write_file_bytes(&path, &data, tail_offset, tail_from.as_deref())
}

#[tauri::command]
fn decode_bytes(data: String, encoding: String) -> Result<String, String> {
    filebytes::decode_b64(&data, &encoding)
}

#[tauri::command]
fn encode_bytes(text: String, encoding: String) -> String {
    filebytes::encode_b64(&text, &encoding)
}

#[tauri::command]
fn convert_bytes(data: String, from: String, to: String) -> Result<String, String> {
    filebytes::convert_b64(&data, &from, &to)
}

#[tauri::command]
fn stat_text_file(path: String) -> Result<FileStat, String> {
    stat_text_file_impl(&path)
}

#[tauri::command]
fn watch_text_files(app: tauri::AppHandle, paths: Vec<String>) -> Result<(), String> {
    watch_text_files_impl(app, paths)
}

#[tauri::command]
fn pick_open_file(app: tauri::AppHandle, title: Option<String>) -> Result<Option<String>, String> {
    let title = title.unwrap_or_else(|| "Open File".into());
    let file = app.dialog().file().set_title(title).blocking_pick_file();
    Ok(file.and_then(file_path_to_string))
}

#[tauri::command]
fn pick_save_file(
    app: tauri::AppHandle,
    default_name: Option<String>,
    directory: Option<String>,
    title: Option<String>,
) -> Result<Option<String>, String> {
    let title = title.unwrap_or_else(|| "Save File".into());
    let mut builder = app.dialog().file().set_title(title);
    if let Some(dir) = directory.filter(|d| !d.is_empty()) {
        builder = builder.set_directory(dir);
    }
    if let Some(name) = default_name.filter(|n| !n.is_empty()) {
        builder = builder.set_file_name(name);
    }
    let file = builder.blocking_save_file();
    Ok(file.and_then(file_path_to_string))
}

#[tauri::command]
fn language_id_for_path(app: tauri::AppHandle, path: String) -> Result<Option<String>, String> {
    let ext = PathBuf::from(&path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| format!(".{}", e.to_ascii_lowercase()));

    let Some(ext) = ext else {
        return Ok(None);
    };

    let plugins = list_language_plugin_info(&app)?;
    Ok(plugins
        .into_iter()
        .find(|p| {
            p.extensions
                .iter()
                .any(|candidate| candidate.eq_ignore_ascii_case(&ext))
        })
        .map(|p| p.id))
}

#[tauri::command]
fn get_settings() -> config::Settings {
    config::load_settings()
}

#[tauri::command]
fn update_settings(
    locale: Option<String>,
    theme: Option<String>,
    md_split: Option<f64>,
) -> Result<config::Settings, String> {
    config::update_settings(locale, theme, md_split)
}

#[tauri::command]
fn list_ui_locales(app: tauri::AppHandle) -> Result<Vec<LocaleInfo>, String> {
    locale::list_locales(&app)
}

#[tauri::command]
fn load_ui_locale(app: tauri::AppHandle, id: String) -> Result<LocaleFile, String> {
    locale::load_locale(&app, &id)
}

#[tauri::command]
fn set_zoom(window: tauri::WebviewWindow, level: f64) -> Result<f64, String> {
    let zoom = level.clamp(config::ZOOM_MIN, config::ZOOM_MAX);
    window.set_zoom(zoom).map_err(|e| e.to_string())?;

    let mut settings = config::load_settings();
    settings.zoom = zoom;
    config::save_settings(&settings)?;
    Ok(zoom)
}

#[tauri::command]
fn zoom_by(window: tauri::WebviewWindow, delta: f64) -> Result<f64, String> {
    let current = config::load_settings().zoom;
    set_zoom(window, current + delta)
}

#[tauri::command]
fn save_window_state(app: tauri::AppHandle) -> Result<(), String> {
    config::save_window_state(&app)
}

#[tauri::command]
fn load_session() -> session::Session {
    session::load_session()
}

#[tauri::command]
fn save_session(session: session::Session) -> Result<(), String> {
    session::save_session(session)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    paths::ensure_layout().expect("create portable app directories");

    #[cfg(windows)]
    {
        std::env::set_var(
            "WEBVIEW2_USER_DATA_FOLDER",
            paths::webview_data_dir().as_os_str(),
        );
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(FileWatchState::new())
        .invoke_handler(tauri::generate_handler![
            list_language_plugins,
            load_language_grammars,
            list_language_catalog,
            install_language_plugin,
            read_text_file,
            write_text_file,
            reinterpret_text,
            read_file_bytes,
            write_file_bytes,
            decode_bytes,
            encode_bytes,
            convert_bytes,
            stat_text_file,
            watch_text_files,
            pick_open_file,
            pick_save_file,
            language_id_for_path,
            get_settings,
            update_settings,
            list_ui_locales,
            load_ui_locale,
            set_zoom,
            zoom_by,
            save_window_state,
            load_session,
            save_session
        ])
        .setup(|app| {
            paths::seed_locale_files(app.handle());
            if let Some(window) = app.get_webview_window("main") {
                if let Ok(icon) = tauri::image::Image::from_bytes(include_bytes!("../icons/128x128.png")) {
                    let _ = window.set_icon(icon);
                }
                config::restore_window_state(&window);
                let _ = window.set_zoom(config::load_settings().zoom);
                let handle = app.handle().clone();
                window.on_window_event(move |event| {
                    if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                        let _ = config::save_window_state(&handle);
                    }
                });
                let _ = window.show();
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Lapeditor");
}
