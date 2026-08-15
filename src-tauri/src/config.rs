use crate::paths;
use serde::{Deserialize, Serialize};
use std::fs;
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewWindow};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    #[serde(default = "default_zoom")]
    pub zoom: f64,
    #[serde(default = "default_locale")]
    pub locale: String,
    #[serde(default = "default_theme")]
    pub theme: String,
    #[serde(default = "default_md_split")]
    pub md_split: f64,
    #[serde(default = "default_explorer_open")]
    pub explorer_open: bool,
    #[serde(default = "default_explorer_width")]
    pub explorer_width: f64,
    #[serde(default)]
    pub workspace_folder: Option<String>,
    #[serde(default = "default_font_family")]
    pub font_family: String,
    #[serde(default = "default_font_size")]
    pub font_size: f64,
}

fn default_zoom() -> f64 {
    1.0
}

fn default_locale() -> String {
    "en".into()
}

fn default_theme() -> String {
    "dark".into()
}

fn default_md_split() -> f64 {
    0.5
}

fn default_explorer_open() -> bool {
    true
}

fn default_explorer_width() -> f64 {
    240.0
}

fn default_font_family() -> String {
    "Cascadia Code, Consolas, 'Courier New', monospace".into()
}

fn default_font_size() -> f64 {
    14.0
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            zoom: default_zoom(),
            locale: default_locale(),
            theme: default_theme(),
            md_split: default_md_split(),
            explorer_open: default_explorer_open(),
            explorer_width: default_explorer_width(),
            workspace_folder: None,
            font_family: default_font_family(),
            font_size: default_font_size(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct WindowState {
    pub x: Option<i32>,
    pub y: Option<i32>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    #[serde(default)]
    pub maximized: bool,
}

fn read_json<T: for<'de> Deserialize<'de> + Default>(path: &std::path::Path) -> T {
    fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

fn write_json<T: Serialize>(path: &std::path::Path, value: &T) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("create {}: {e}", parent.display()))?;
    }
    let json = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    fs::write(path, json).map_err(|e| format!("write {}: {e}", path.display()))
}

pub const ZOOM_MIN: f64 = 0.5;
pub const ZOOM_MAX: f64 = 2.0;

pub fn load_settings() -> Settings {
    let mut settings = read_json::<Settings>(&paths::settings_path());
    settings.zoom = settings.zoom.clamp(ZOOM_MIN, ZOOM_MAX);
    if settings.locale.trim().is_empty() {
        settings.locale = default_locale();
    }
    if settings.theme != "light" && settings.theme != "dark" {
        settings.theme = default_theme();
    }
    if !(settings.md_split >= 0.2 && settings.md_split <= 0.8) {
        settings.md_split = default_md_split();
    }
    if !(settings.explorer_width >= 160.0 && settings.explorer_width <= 560.0) {
        settings.explorer_width = default_explorer_width();
    }
    if let Some(folder) = settings.workspace_folder.as_mut() {
        if folder.trim().is_empty() {
            settings.workspace_folder = None;
        }
    }
    if settings.font_family.trim().is_empty() {
        settings.font_family = default_font_family();
    }
    if !(settings.font_size >= 10.0 && settings.font_size <= 28.0) {
        settings.font_size = default_font_size();
    }
    settings
}

pub fn update_settings(
    locale: Option<String>,
    theme: Option<String>,
    md_split: Option<f64>,
    explorer_open: Option<bool>,
    explorer_width: Option<f64>,
    workspace_folder: Option<String>,
    font_family: Option<String>,
    font_size: Option<f64>,
) -> Result<Settings, String> {
    let mut settings = load_settings();
    if let Some(locale) = locale {
        if !locale.trim().is_empty() {
            settings.locale = locale;
        }
    }
    if let Some(theme) = theme {
        if theme == "light" || theme == "dark" {
            settings.theme = theme;
        }
    }
    if let Some(md_split) = md_split {
        if md_split >= 0.2 && md_split <= 0.8 {
            settings.md_split = md_split;
        }
    }
    if let Some(explorer_open) = explorer_open {
        settings.explorer_open = explorer_open;
    }
    if let Some(explorer_width) = explorer_width {
        if explorer_width >= 160.0 && explorer_width <= 560.0 {
            settings.explorer_width = explorer_width;
        }
    }
    if let Some(folder) = workspace_folder {
        let trimmed = folder.trim();
        settings.workspace_folder = if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        };
    }
    if let Some(font_family) = font_family {
        let trimmed = font_family.trim();
        if !trimmed.is_empty() {
            settings.font_family = trimmed.to_string();
        }
    }
    if let Some(font_size) = font_size {
        if font_size >= 10.0 && font_size <= 28.0 {
            settings.font_size = font_size.round();
        }
    }
    save_settings(&settings)?;
    Ok(settings)
}

pub fn save_settings(settings: &Settings) -> Result<(), String> {
    write_json(&paths::settings_path(), settings)
}

pub fn load_window_state() -> WindowState {
    read_json(&paths::window_state_path())
}

fn is_normal_position(x: i32, y: i32) -> bool {
    // Minimized windows on Windows report coordinates like -32000.
    x > -10_000 && y > -10_000 && x < 50_000 && y < 50_000
}

fn is_normal_size(width: u32, height: u32) -> bool {
    width >= 800 && height >= 500 && width <= 20_000 && height <= 20_000
}

struct RestoredFrame {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    maximized: bool,
}

#[cfg(windows)]
fn restored_frame(window: &WebviewWindow) -> Option<RestoredFrame> {
    use windows::Win32::UI::WindowsAndMessaging::{
        GetWindowPlacement, WINDOWPLACEMENT, WPF_RESTORETOMAXIMIZED, SW_SHOWMAXIMIZED,
        SW_SHOWMINIMIZED,
    };

    let hwnd = window.hwnd().ok()?;
    let mut place = WINDOWPLACEMENT::default();
    place.length = std::mem::size_of::<WINDOWPLACEMENT>() as u32;
    unsafe { GetWindowPlacement(hwnd, &mut place).ok()? };

    let rect = place.rcNormalPosition;
    let width = rect.right.saturating_sub(rect.left);
    let height = rect.bottom.saturating_sub(rect.top);
    if width <= 0 || height <= 0 {
        return None;
    }

    let maximized = place.showCmd == SW_SHOWMAXIMIZED.0 as u32
        || (place.showCmd == SW_SHOWMINIMIZED.0 as u32
            && place.flags.contains(WPF_RESTORETOMAXIMIZED));

    Some(RestoredFrame {
        x: rect.left,
        y: rect.top,
        width: width as u32,
        height: height as u32,
        maximized,
    })
}

#[cfg(not(windows))]
fn restored_frame(window: &WebviewWindow) -> Option<RestoredFrame> {
    if window.is_maximized().unwrap_or(false) || window.is_minimized().unwrap_or(false) {
        return None;
    }
    let position = window.outer_position().ok()?;
    let size = window.outer_size().ok()?;
    Some(RestoredFrame {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
        maximized: false,
    })
}

pub fn save_window_state(app: &AppHandle) -> Result<(), String> {
    let Some(window) = app.get_webview_window("main") else {
        return Ok(());
    };

    let mut state = load_window_state();
    if let Some(frame) = restored_frame(&window) {
        if is_normal_position(frame.x, frame.y) && is_normal_size(frame.width, frame.height) {
            state.x = Some(frame.x);
            state.y = Some(frame.y);
            state.width = Some(frame.width);
            state.height = Some(frame.height);
        }
        state.maximized = frame.maximized;
    } else if !window.is_minimized().unwrap_or(false) {
        state.maximized = window.is_maximized().unwrap_or(false);
    }

    write_json(&paths::window_state_path(), &state)
}

pub fn restore_window_state(window: &WebviewWindow) {
    let state = load_window_state();

    if let (Some(x), Some(y)) = (state.x, state.y) {
        if is_normal_position(x, y) {
            let _ = window.set_position(PhysicalPosition::new(x, y));
        }
    }
    if let (Some(width), Some(height)) = (state.width, state.height) {
        if is_normal_size(width, height) {
            let _ = window.set_size(PhysicalSize::new(width, height));
        }
    }
    if state.maximized {
        let _ = window.maximize();
    }
}
