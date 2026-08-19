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

fn markdown_asset_dir(markdown_path: &Path) -> Result<PathBuf, String> {
    let parent = markdown_path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .ok_or_else(|| "invalid markdown path".to_string())?;
    let stem = markdown_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("images")
        .trim();
    let folder = if stem.is_empty() { "images" } else { stem };
    Ok(parent.join(folder))
}

fn relative_markdown_path(markdown_path: &Path, dest: &Path) -> Result<String, String> {
    let parent = markdown_path
        .parent()
        .ok_or_else(|| "invalid markdown path".to_string())?;
    let rel = dest
        .strip_prefix(parent)
        .map_err(|_| "image is not beside the markdown file".to_string())?;
    Ok(format!("./{}", rel.to_string_lossy().replace('\\', "/")))
}

fn unique_file(dir: &Path, stem: &str, ext: &str) -> PathBuf {
    let mut path = dir.join(format!("{stem}.{ext}"));
    if !path.exists() {
        return path;
    }
    if let Ok(mut n) = stem.parse::<u128>() {
        loop {
            n += 1;
            path = dir.join(format!("{n}.{ext}"));
            if !path.exists() {
                return path;
            }
        }
    }
    let mut i = 1u32;
    loop {
        path = dir.join(format!("{stem}-{i}.{ext}"));
        if !path.exists() {
            return path;
        }
        i += 1;
    }
}

fn sanitize_stem(name: &str) -> String {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return "image".into();
    }
    trimmed.to_string()
}

pub struct SavedMarkdownImage {
    pub relative_path: String,
    pub absolute_path: String,
}

pub fn save_markdown_image_bytes(
    markdown_path: String,
    data: Vec<u8>,
    ext: &str,
    stem: &str,
) -> Result<SavedMarkdownImage, String> {
    let md = Path::new(&markdown_path);
    if !md.is_file() {
        return Err("markdown file is not saved".into());
    }
    let dir = markdown_asset_dir(md)?;
    fs::create_dir_all(&dir).map_err(|e| format!("io: {e}"))?;
    let dest = unique_file(&dir, stem, ext);
    fs::write(&dest, data).map_err(|e| format!("io: {e}"))?;
    Ok(SavedMarkdownImage {
        relative_path: relative_markdown_path(md, &dest)?,
        absolute_path: dest.to_string_lossy().into_owned(),
    })
}

pub fn import_markdown_image(
    markdown_path: String,
    source_path: String,
) -> Result<SavedMarkdownImage, String> {
    let src = Path::new(&source_path);
    if !src.is_file() {
        return Err("source image not found".into());
    }
    let ext = src
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("png")
        .to_ascii_lowercase();
    let stem = src
        .file_stem()
        .and_then(|s| s.to_str())
        .map(sanitize_stem)
        .unwrap_or_else(|| "image".into());
    let bytes = fs::read(src).map_err(|e| format!("io: {e}"))?;
    save_markdown_image_bytes(markdown_path, bytes, &ext, &stem)
}
