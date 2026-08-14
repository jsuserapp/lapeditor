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

impl Default for Settings {
    fn default() -> Self {
        Self {
            zoom: default_zoom(),
            locale: default_locale(),
            theme: default_theme(),
            md_split: default_md_split(),
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
    settings
}

pub fn update_settings(
    locale: Option<String>,
    theme: Option<String>,
    md_split: Option<f64>,
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
    save_settings(&settings)?;
    Ok(settings)
}

pub fn save_settings(settings: &Settings) -> Result<(), String> {
    write_json(&paths::settings_path(), settings)
}

pub fn load_window_state() -> WindowState {
    read_json(&paths::window_state_path())
}

pub fn save_window_state(app: &AppHandle) -> Result<(), String> {
    let Some(window) = app.get_webview_window("main") else {
        return Ok(());
    };

    let mut state = load_window_state();
    let maximized = window.is_maximized().unwrap_or(false);
    state.maximized = maximized;

    if !maximized {
        if let Ok(position) = window.outer_position() {
            state.x = Some(position.x);
            state.y = Some(position.y);
        }
        if let Ok(size) = window.outer_size() {
            state.width = Some(size.width);
            state.height = Some(size.height);
        }
    }

    write_json(&paths::window_state_path(), &state)
}

pub fn restore_window_state(window: &WebviewWindow) {
    let state = load_window_state();

    if let (Some(x), Some(y)) = (state.x, state.y) {
        let _ = window.set_position(PhysicalPosition::new(x, y));
    }
    if let (Some(width), Some(height)) = (state.width, state.height) {
        if width >= 640 && height >= 420 {
            let _ = window.set_size(PhysicalSize::new(width, height));
        }
    }
    if state.maximized {
        let _ = window.maximize();
    }
}
