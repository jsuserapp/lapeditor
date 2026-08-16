use std::fs::{self, OpenOptions};
use std::path::{Path, PathBuf};

const WIN_RESERVED: &[&str] = &[
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

fn error_code(code: &str) -> String {
    code.to_string()
}

pub fn validate_entry_name(name: &str) -> Result<(), String> {
    let name = name.trim();
    if name.is_empty() {
        return Err(error_code("empty"));
    }
    if name == "." || name == ".." {
        return Err(error_code("invalid"));
    }
    if name.chars().any(|ch| {
        matches!(ch, '/' | '\\' | '<' | '>' | ':' | '"' | '|' | '?' | '*') || ch.is_control()
    }) {
        return Err(error_code("invalid"));
    }
    if name.ends_with(' ') || name.ends_with('.') {
        return Err(error_code("invalid"));
    }
    let stem = name.split('.').next().unwrap_or(name);
    if WIN_RESERVED.iter().any(|item| stem.eq_ignore_ascii_case(item)) {
        return Err(error_code("invalid"));
    }
    Ok(())
}

fn child_path(parent: &str, name: &str) -> Result<PathBuf, String> {
    validate_entry_name(name)?;
    let parent_path = Path::new(parent);
    if !parent_path.is_dir() {
        return Err(error_code("not_dir"));
    }
    Ok(parent_path.join(name.trim()))
}

pub fn create_fs_entry(parent: String, name: String, is_dir: bool) -> Result<String, String> {
    let path = child_path(&parent, &name)?;
    if path.exists() {
        return Err(error_code("exists"));
    }
    if is_dir {
        fs::create_dir(&path).map_err(|e| format!("io: {e}"))?;
    } else {
        OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .map_err(|e| format!("io: {e}"))?;
    }
    Ok(path.to_string_lossy().into_owned())
}

pub fn delete_fs_entry(path: String) -> Result<(), String> {
    let target = Path::new(&path);
    let meta = fs::symlink_metadata(target).map_err(|_| error_code("not_found"))?;
    if meta.is_dir() {
        fs::remove_dir_all(target).map_err(|e| format!("io: {e}"))?;
    } else {
        fs::remove_file(target).map_err(|e| format!("io: {e}"))?;
    }
    Ok(())
}
