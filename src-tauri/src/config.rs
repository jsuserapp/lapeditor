use crate::paths;
use serde::{Deserialize, Serialize};
use std::fs;
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewWindow};

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchExcludeSettings {
    /// Master switch: when false, none of the rules below apply.
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default = "default_true")]
    pub skip_hidden: bool,
    #[serde(default = "default_true")]
    pub use_gitignore: bool,
    #[serde(default = "default_true")]
    pub use_ignore_file: bool,
    #[serde(default = "default_true")]
    pub use_git_exclude: bool,
    #[serde(default = "default_true")]
    pub skip_dependencies: bool,
    #[serde(default = "default_true")]
    pub skip_build: bool,
    /// Skip Git / Mercurial metadata dirs (`.git`, `.hg`).
    #[serde(default = "default_true")]
    pub skip_vcs: bool,
    /// Skip Subversion metadata (`.svn`).
    #[serde(default = "default_true")]
    pub skip_svn: bool,
    #[serde(default = "default_true")]
    pub skip_ide: bool,
    #[serde(default = "default_true")]
    pub skip_os_junk: bool,
    #[serde(default)]
    pub custom_dirs: Vec<String>,
}

impl Default for SearchExcludeSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            skip_hidden: true,
            use_gitignore: true,
            use_ignore_file: true,
            use_git_exclude: true,
            skip_dependencies: true,
            skip_build: true,
            skip_vcs: true,
            skip_svn: true,
            skip_ide: true,
            skip_os_junk: true,
            custom_dirs: Vec::new(),
        }
    }
}

impl SearchExcludeSettings {
    pub fn normalized(mut self) -> Self {
        let mut seen = std::collections::HashSet::new();
        self.custom_dirs = self
            .custom_dirs
            .into_iter()
            .filter_map(|raw| {
                let name = normalize_custom_dir(&raw)?;
                if seen.insert(name.to_ascii_lowercase()) {
                    Some(name)
                } else {
                    None
                }
            })
            .take(64)
            .collect();
        self
    }
}

fn normalize_custom_dir(raw: &str) -> Option<String> {
    let trimmed = raw.trim().trim_matches(|c| c == '/' || c == '\\');
    if trimmed.is_empty() || trimmed.len() > 120 {
        return None;
    }
    if trimmed == "." || trimmed == ".." || trimmed.contains("..") {
        return None;
    }
    if trimmed.chars().any(|c| c.is_control() || c == '<' || c == '>' || c == '|' || c == '\0') {
        return None;
    }
    Some(trimmed.to_string())
}

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
    #[serde(default)]
    pub search_exclude: SearchExcludeSettings,
    #[serde(default)]
    pub word_wrap: bool,
    #[serde(default = "default_recycle_bin_size")]
    pub recycle_bin_size: u32,
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

fn default_recycle_bin_size() -> u32 {
    10
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
            search_exclude: SearchExcludeSettings::default(),
            word_wrap: false,
            recycle_bin_size: default_recycle_bin_size(),
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
    settings.search_exclude = settings.search_exclude.normalized();
    if settings.recycle_bin_size > 50 {
        settings.recycle_bin_size = 50;
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
    search_exclude: Option<SearchExcludeSettings>,
    word_wrap: Option<bool>,
    recycle_bin_size: Option<u32>,
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
    if let Some(search_exclude) = search_exclude {
        settings.search_exclude = search_exclude.normalized();
    }
    if let Some(word_wrap) = word_wrap {
        settings.word_wrap = word_wrap;
    }
    if let Some(recycle_bin_size) = recycle_bin_size {
        settings.recycle_bin_size = recycle_bin_size.min(50);
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

fn decoration_delta(window: &WebviewWindow) -> (u32, u32) {
    let Ok(outer) = window.outer_size() else {
        return (0, 0);
    };
    let Ok(inner) = window.inner_size() else {
        return (0, 0);
    };
    (
        outer.width.saturating_sub(inner.width),
        outer.height.saturating_sub(inner.height),
    )
}

struct RestoredFrame {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

#[cfg(windows)]
fn restored_frame(window: &WebviewWindow) -> Option<RestoredFrame> {
    use windows::Win32::UI::WindowsAndMessaging::{
        GetWindowPlacement, WINDOWPLACEMENT,
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

    Some(RestoredFrame {
        x: rect.left,
        y: rect.top,
        width: width as u32,
        height: height as u32,
    })
}

#[cfg(not(windows))]
fn restored_frame(window: &WebviewWindow) -> Option<RestoredFrame> {
    let position = window.outer_position().ok()?;
    let size = window.inner_size().ok()?;
    Some(RestoredFrame {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
    })
}

fn save_normal_inner_frame(window: &WebviewWindow, state: &mut WindowState) {
    let Ok(pos) = window.outer_position() else {
        return;
    };
    let Ok(size) = window.inner_size() else {
        return;
    };
    if is_normal_position(pos.x, pos.y) && is_normal_size(size.width, size.height) {
        state.x = Some(pos.x);
        state.y = Some(pos.y);
        state.width = Some(size.width);
        state.height = Some(size.height);
    }
}

/// Convert Win32 outer restore-bounds into Tauri inner size.
fn save_inner_frame_from_placement(window: &WebviewWindow, state: &mut WindowState, frame: &RestoredFrame) {
    let (pad_w, pad_h) = decoration_delta(window);
    let width = frame.width.saturating_sub(pad_w);
    let height = frame.height.saturating_sub(pad_h);
    if is_normal_position(frame.x, frame.y) && is_normal_size(width, height) {
        state.x = Some(frame.x);
        state.y = Some(frame.y);
        state.width = Some(width);
        state.height = Some(height);
    }
}

pub fn save_window_state(app: &AppHandle) -> Result<(), String> {
    let Some(window) = app.get_webview_window("main") else {
        return Ok(());
    };

    let mut state = load_window_state();
    let minimized = window.is_minimized().unwrap_or(false);
    let maximized = window.is_maximized().unwrap_or(false);

    if !minimized {
        state.maximized = maximized;
    }

    if !minimized && !maximized {
        // Pair with restore: Tauri set_size() is inner size, set_position() is outer.
        // Saving GetWindowPlacement (outer) and restoring via set_size made the
        // window grow by the DWM shadow/resize frame on every launch.
        save_normal_inner_frame(&window, &mut state);
    } else if let Some(frame) = restored_frame(&window) {
        let (pad_w, pad_h) = decoration_delta(&window);
        if pad_w > 0 || pad_h > 0 {
            save_inner_frame_from_placement(&window, &mut state, &frame);
        }
    }

    write_json(&paths::window_state_path(), &state)
}

pub fn restore_window_state(window: &WebviewWindow) {
    let state = load_window_state();

    if let (Some(width), Some(height)) = (state.width, state.height) {
        if is_normal_size(width, height) {
            let _ = window.set_size(PhysicalSize::new(width, height));
        }
    }
    if let (Some(x), Some(y)) = (state.x, state.y) {
        if is_normal_position(x, y) {
            let _ = window.set_position(PhysicalPosition::new(x, y));
        }
    }
    if state.maximized {
        let _ = window.maximize();
    }
}
