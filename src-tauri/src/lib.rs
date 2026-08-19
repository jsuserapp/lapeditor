mod clipboard;
mod config;
mod encoding;
mod filebytes;
mod filewatch;
mod format;
mod fsops;
mod languages;
mod locale;
mod paths;
mod search;
mod session;
#[cfg(windows)]
mod webview_clipboard;

use config::SearchExcludeSettings;
use encoding::TextFile;
use filewatch::{
    set_explorer_expanded as set_explorer_expanded_impl, stat_text_file as stat_text_file_impl,
    watch_explorer_dirs as watch_explorer_dirs_impl, watch_text_files as watch_text_files_impl,
    FileStat, FileWatchState,
};
use languages::{
    install_language_plugin as install_language_plugin_impl,
    list_language_catalog as list_language_catalog_impl,
    list_language_plugin_info, load_language_grammars as load_language_grammars_impl,
    LanguageCatalogItem, LanguagePlugin, LanguagePluginInfo,
};
use locale::{LocaleFile, LocaleInfo};
use search::{SearchOptions, SearchState};
use std::path::PathBuf;
use std::sync::mpsc;
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

fn file_path_to_string(path: tauri_plugin_dialog::FilePath) -> Option<String> {
    path.into_path()
        .ok()
        .map(|p| p.to_string_lossy().into_owned())
}

#[tauri::command]
fn read_clipboard() -> Result<String, String> {
    clipboard::read_text()
}

#[tauri::command]
fn write_clipboard(text: String) -> Result<(), String> {
    clipboard::write_text(&text)
}

#[tauri::command]
fn write_clipboard_image(width: u32, height: u32, data: String) -> Result<(), String> {
    clipboard::write_image_rgba_base64(width, height, &data)
}

#[tauri::command]
fn write_clipboard_image_file(path: String) -> Result<(), String> {
    clipboard::write_image_file(&path)
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
    paths::deny_if_session_path(&path)?;
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
    paths::deny_if_session_path(&path)?;
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
fn watch_explorer_dirs(app: tauri::AppHandle, paths: Vec<String>) -> Result<(), String> {
    watch_explorer_dirs_impl(app, paths)
}

#[tauri::command]
fn set_explorer_expanded(app: tauri::AppHandle, paths: Vec<String>) {
    set_explorer_expanded_impl(app, paths)
}

fn restore_dialog_owner(window: &tauri::WebviewWindow) {
    let _ = window.set_enabled(true);
    let _ = window.set_focus();
}

async fn recv_dialog_path(
    window: tauri::WebviewWindow,
    rx: mpsc::Receiver<Option<String>>,
) -> Result<Option<String>, String> {
    let path = tauri::async_runtime::spawn_blocking(move || rx.recv().ok().flatten())
        .await
        .map_err(|e| e.to_string())?;
    restore_dialog_owner(&window);
    Ok(path)
}

#[tauri::command]
async fn pick_open_file(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    title: Option<String>,
    image_only: Option<bool>,
) -> Result<Option<String>, String> {
    let title = title.unwrap_or_else(|| "Open File".into());
    let (tx, rx) = mpsc::channel();
    let owner = window.clone();
    let mut builder = app.dialog().file().set_title(title).set_parent(&window);
    if image_only.unwrap_or(false) {
        builder = builder.add_filter(
            "Images",
            &["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"],
        );
    }
    builder.pick_file(move |file| {
        restore_dialog_owner(&owner);
        let _ = tx.send(file.and_then(file_path_to_string));
    });
    recv_dialog_path(window, rx).await
}

#[tauri::command]
async fn pick_open_folder(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    title: Option<String>,
) -> Result<Option<String>, String> {
    let title = title.unwrap_or_else(|| "Open Folder".into());
    let (tx, rx) = mpsc::channel();
    let owner = window.clone();
    app.dialog()
        .file()
        .set_title(title)
        .set_parent(&window)
        .pick_folder(move |folder| {
            restore_dialog_owner(&owner);
            let _ = tx.send(folder.and_then(file_path_to_string));
        });
    recv_dialog_path(window, rx).await
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct DirEntryDto {
    name: String,
    path: String,
    is_dir: bool,
}

#[tauri::command]
fn cancel_workspace_search(app: tauri::AppHandle) {
    search::cancel_search(app.state::<SearchState>().inner());
}

#[tauri::command]
fn search_workspace(
    app: tauri::AppHandle,
    request_id: u64,
    root: String,
    query: String,
    match_case: bool,
    whole_word: bool,
    use_regex: bool,
    excludes: SearchExcludeSettings,
) -> Result<(), String> {
    search::start_search(
        app,
        request_id,
        root,
        query,
        SearchOptions {
            match_case,
            whole_word,
            use_regex,
            excludes,
        },
    )
}

#[tauri::command]
fn list_dir_entries(path: String) -> Result<Vec<DirEntryDto>, String> {
    let root = PathBuf::from(&path);
    if !root.is_dir() {
        return Err(format!("not a directory: {path}"));
    }
    let mut entries = Vec::new();
    for entry in std::fs::read_dir(&root).map_err(|e| format!("read {path}: {e}"))? {
        let entry = entry.map_err(|e| format!("read {path}: {e}"))?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if name == "." || name == ".." {
            continue;
        }
        let child = entry.path();
        let file_type = entry.file_type().map_err(|e| format!("stat {}: {e}", child.display()))?;
        entries.push(DirEntryDto {
            name,
            path: child.to_string_lossy().into_owned(),
            is_dir: file_type.is_dir(),
        });
    }
    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_ascii_lowercase().cmp(&b.name.to_ascii_lowercase()))
    });
    Ok(entries)
}

#[tauri::command]
fn create_fs_entry(
    app: tauri::AppHandle,
    parent: String,
    name: String,
    is_dir: bool,
) -> Result<String, String> {
    paths::deny_if_session_path(&parent)?;
    let tentative = PathBuf::from(&parent).join(name.trim());
    paths::deny_if_session_path(&tentative.to_string_lossy())?;
    let path = fsops::create_fs_entry(parent, name, is_dir)?;
    filewatch::mark_self_write(&app.state::<FileWatchState>(), &path);
    Ok(path)
}

#[tauri::command]
fn delete_fs_entry(app: tauri::AppHandle, path: String) -> Result<(), String> {
    paths::deny_if_session_path(&path)?;
    filewatch::mark_self_write(&app.state::<FileWatchState>(), &path);
    fsops::delete_fs_entry(path)
}

#[tauri::command]
fn open_in_file_manager(app: tauri::AppHandle, path: String, is_dir: bool) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let opener = app.opener();
    if is_dir {
        opener
            .open_path(&path, None::<&str>)
            .map_err(|e| e.to_string())
    } else {
        opener.reveal_item_in_dir(&path).map_err(|e| e.to_string())
    }
}

#[tauri::command]
fn clipboard_has_image() -> Result<bool, String> {
    clipboard::has_image()
}

#[tauri::command]
fn save_clipboard_markdown_image(
    app: tauri::AppHandle,
    markdown_path: String,
    stem: String,
) -> Result<Option<String>, String> {
    let Some(png) = clipboard::read_image_png()? else {
        return Ok(None);
    };
    let saved = fsops::save_markdown_image_bytes(markdown_path, png, "png", &stem)?;
    filewatch::mark_self_write(&app.state::<FileWatchState>(), &saved.absolute_path);
    Ok(Some(saved.relative_path))
}

#[tauri::command]
fn import_markdown_image(
    app: tauri::AppHandle,
    markdown_path: String,
    source_path: String,
) -> Result<String, String> {
    let saved = fsops::import_markdown_image(markdown_path, source_path)?;
    filewatch::mark_self_write(&app.state::<FileWatchState>(), &saved.absolute_path);
    Ok(saved.relative_path)
}

#[tauri::command]
async fn pick_save_file(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    default_name: Option<String>,
    directory: Option<String>,
    title: Option<String>,
) -> Result<Option<String>, String> {
    let title = title.unwrap_or_else(|| "Save File".into());
    let mut builder = app.dialog().file().set_title(title).set_parent(&window);
    if let Some(dir) = directory.filter(|d| !d.is_empty()) {
        builder = builder.set_directory(dir);
    }
    if let Some(name) = default_name.filter(|n| !n.is_empty()) {
        builder = builder.set_file_name(name);
    }
    let (tx, rx) = mpsc::channel();
    let owner = window.clone();
    builder.save_file(move |file| {
        restore_dialog_owner(&owner);
        let _ = tx.send(file.and_then(file_path_to_string));
    });
    recv_dialog_path(window, rx).await
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
    explorer_open: Option<bool>,
    explorer_width: Option<f64>,
    workspace_folder: Option<String>,
    font_family: Option<String>,
    font_size: Option<f64>,
    search_exclude: Option<SearchExcludeSettings>,
    word_wrap: Option<bool>,
    recycle_bin_size: Option<u32>,
) -> Result<config::Settings, String> {
    config::update_settings(
        locale,
        theme,
        md_split,
        explorer_open,
        explorer_width,
        workspace_folder,
        font_family,
        font_size,
        search_exclude,
        word_wrap,
        recycle_bin_size,
    )
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
fn uses_custom_titlebar() -> bool {
    cfg!(windows)
}

#[tauri::command]
fn session_dir() -> String {
    paths::session_dir().to_string_lossy().into_owned()
}

#[tauri::command]
fn load_session() -> session::Session {
    session::load_session()
}

#[tauri::command]
fn save_session(
    session: session::Session,
    contents: Option<std::collections::HashMap<String, String>>,
) -> Result<(), String> {
    session::save_session(session, contents)
}

#[tauri::command]
fn get_formatter_config(app: tauri::AppHandle) -> format::FormatterConfigDto {
    format::get_formatter_config(&app)
}

#[tauri::command]
fn save_format_indent(indent: String) -> Result<format::FormatterFile, String> {
    format::save_format_indent(&indent)
}

#[tauri::command]
fn save_formatter_command(
    language_id: String,
    program: String,
    args: Vec<String>,
) -> Result<format::FormatterFile, String> {
    format::save_formatter_command(&language_id, &program, args)
}

#[tauri::command]
fn remove_formatter_command(language_id: String) -> Result<format::FormatterFile, String> {
    format::remove_formatter_command(&language_id)
}

#[tauri::command]
fn format_with_command(
    app: tauri::AppHandle,
    language_id: String,
    text: String,
) -> Result<String, String> {
    format::format_with_command(&app, &language_id, &text)
}

fn focus_main_window(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    if window.is_minimized().unwrap_or(false) {
        let _ = window.unminimize();
    }
    let _ = window.show();
    // Windows often blocks SetForegroundWindow from a background process.
    // A brief always-on-top pulse lets the existing window come forward.
    let _ = window.set_always_on_top(true);
    let _ = window.set_focus();
    let _ = window.set_always_on_top(false);
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
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            focus_main_window(app);
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(FileWatchState::new())
        .manage(SearchState::new())
        .invoke_handler(tauri::generate_handler![
            read_clipboard,
            write_clipboard,
            write_clipboard_image,
            write_clipboard_image_file,
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
            watch_explorer_dirs,
            set_explorer_expanded,
            pick_open_file,
            pick_open_folder,
            list_dir_entries,
            create_fs_entry,
            delete_fs_entry,
            open_in_file_manager,
            clipboard_has_image,
            save_clipboard_markdown_image,
            import_markdown_image,
            search_workspace,
            cancel_workspace_search,
            pick_save_file,
            language_id_for_path,
            get_settings,
            update_settings,
            list_ui_locales,
            load_ui_locale,
            set_zoom,
            zoom_by,
            save_window_state,
            uses_custom_titlebar,
            session_dir,
            load_session,
            save_session,
            get_formatter_config,
            save_format_indent,
            save_formatter_command,
            remove_formatter_command,
            format_with_command
        ])
        .setup(|app| {
            paths::seed_locale_files(app.handle());
            if let Some(window) = app.get_webview_window("main") {
                if let Ok(icon) = tauri::image::Image::from_bytes(include_bytes!("../icons/128x128.png")) {
                    let _ = window.set_icon(icon);
                }
                #[cfg(windows)]
                {
                    let _ = window.set_decorations(false);
                    let _ = window.set_shadow(true);
                    webview_clipboard::allow_clipboard_read(&window);
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
