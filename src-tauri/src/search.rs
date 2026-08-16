use crate::config::SearchExcludeSettings;
use ignore::WalkBuilder;
use memchr::memchr;
use regex::RegexBuilder;
use serde::Serialize;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::thread;
use tauri::{AppHandle, Emitter, Manager};

const MAX_FILE_BYTES: u64 = 1024 * 1024;
const BINARY_PROBE_BYTES: usize = 8 * 1024;
const MAX_MATCHES_TOTAL: usize = 5_000;
const MAX_MATCHES_PER_FILE: usize = 200;
const HIT_BATCH: usize = 40;
const PREVIEW_MAX_CHARS: usize = 240;

const BINARY_EXTENSIONS: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "webp", "ico", "bmp", "svgz", "exe", "dll", "so", "dylib",
    "zip", "7z", "rar", "gz", "tgz", "tar", "xz", "bz2", "wasm", "pdf", "woff", "woff2", "ttf",
    "otf", "eot", "mp3", "mp4", "avi", "mov", "mkv", "webm", "class", "o", "a", "lib", "obj",
    "pdb", "sqlite", "db", "bin", "dat", "pak", "dmg", "iso", "img", "apk", "ipa",
];

pub struct SearchState {
    active_id: AtomicU64,
}

impl SearchState {
    pub fn new() -> Self {
        Self {
            active_id: AtomicU64::new(0),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHitDto {
    pub path: String,
    pub line: u32,
    pub column: u32,
    pub end_column: u32,
    pub preview: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SearchHitsEvent {
    id: u64,
    hits: Vec<SearchHitDto>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SearchDoneEvent {
    id: u64,
    files_searched: u32,
    match_count: u32,
    truncated: bool,
    cancelled: bool,
    error: Option<String>,
}

#[derive(Debug, Clone)]
pub struct SearchOptions {
    pub match_case: bool,
    pub whole_word: bool,
    pub use_regex: bool,
    pub excludes: SearchExcludeSettings,
}

enum Matcher {
    Literal {
        needle: Vec<u8>,
        match_case: bool,
        whole_word: bool,
    },
    Regex(regex::Regex),
}

impl Matcher {
    fn compile(query: &str, options: &SearchOptions) -> Result<Self, String> {
        if query.is_empty() {
            return Err("empty query".into());
        }
        if options.use_regex {
            let pattern = if options.whole_word {
                format!(r"\b(?:{query})\b")
            } else {
                query.to_string()
            };
            let re = RegexBuilder::new(&pattern)
                .case_insensitive(!options.match_case)
                .multi_line(false)
                .dot_matches_new_line(false)
                .build()
                .map_err(|e| format!("invalid regex: {e}"))?;
            Ok(Self::Regex(re))
        } else {
            let needle = if options.match_case {
                query.as_bytes().to_vec()
            } else {
                query.to_lowercase().into_bytes()
            };
            Ok(Self::Literal {
                needle,
                match_case: options.match_case,
                whole_word: options.whole_word,
            })
        }
    }

    fn find_in_line(&self, line: &str) -> Option<(usize, usize)> {
        match self {
            Self::Literal {
                needle,
                match_case,
                whole_word,
            } => find_literal(line, needle, *match_case, *whole_word),
            Self::Regex(re) => {
                let m = re.find(line)?;
                Some((m.start(), m.end()))
            }
        }
    }
}

fn is_word_char(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_'
}

fn is_word_boundary(hay: &[u8], start: usize, end: usize) -> bool {
    let before_ok = start == 0 || !is_word_char(hay[start - 1]);
    let after_ok = end >= hay.len() || !is_word_char(hay[end]);
    before_ok && after_ok
}

fn find_literal(
    line: &str,
    needle: &[u8],
    match_case: bool,
    whole_word: bool,
) -> Option<(usize, usize)> {
    if needle.is_empty() {
        return None;
    }
    let hay_owned;
    let hay: &[u8] = if match_case {
        line.as_bytes()
    } else {
        hay_owned = line.to_lowercase().into_bytes();
        &hay_owned
    };
    let mut from = 0;
    while from + needle.len() <= hay.len() {
        let Some(rel) = memchr(needle[0], &hay[from..]) else {
            return None;
        };
        let start = from + rel;
        let end = start + needle.len();
        if end <= hay.len() && &hay[start..end] == needle {
            if !whole_word || is_word_boundary(hay, start, end) {
                if match_case {
                    return Some((start, end));
                }
                if let Some(range) = map_casefold_range(line, start, end) {
                    return Some(range);
                }
            }
        }
        from = start + 1;
    }
    None
}

fn map_casefold_range(line: &str, fold_start: usize, fold_end: usize) -> Option<(usize, usize)> {
    let mut fold_i = 0usize;
    let mut byte_start = None;
    for (byte_i, ch) in line.char_indices() {
        let folded = ch.to_lowercase().next().unwrap_or(ch);
        let fold_len = folded.len_utf8();
        if byte_start.is_none() && fold_i == fold_start {
            byte_start = Some(byte_i);
        }
        if let Some(start) = byte_start {
            if fold_i + fold_len == fold_end {
                return Some((start, byte_i + ch.len_utf8()));
            }
        }
        fold_i += fold_len;
    }
    None
}

fn is_binary_extension(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|ext| {
            BINARY_EXTENSIONS
                .iter()
                .any(|b| ext.eq_ignore_ascii_case(b))
        })
        .unwrap_or(false)
}

fn has_nul(buf: &[u8]) -> bool {
    memchr(0, buf).is_some()
}

fn truncate_preview(line: &str) -> String {
    let trimmed = line.trim_end_matches(['\r', '\n']);
    if trimmed.chars().count() <= PREVIEW_MAX_CHARS {
        return trimmed.to_string();
    }
    let mut out = String::new();
    for (i, ch) in trimmed.chars().enumerate() {
        if i >= PREVIEW_MAX_CHARS {
            break;
        }
        out.push(ch);
    }
    out.push('…');
    out
}

fn char_column(line: &str, byte_offset: usize) -> u32 {
    let capped = byte_offset.min(line.len());
    (line[..capped].chars().count() + 1) as u32
}

fn search_file(path: &Path, matcher: &Matcher) -> Result<Vec<SearchHitDto>, String> {
    let meta = std::fs::metadata(path).map_err(|e| format!("stat: {e}"))?;
    if !meta.is_file() || meta.len() > MAX_FILE_BYTES {
        return Ok(Vec::new());
    }
    if is_binary_extension(path) {
        return Ok(Vec::new());
    }

    let mut file = File::open(path).map_err(|e| format!("open: {e}"))?;
    let mut probe = vec![0u8; BINARY_PROBE_BYTES.min(meta.len() as usize)];
    let n = file.read(&mut probe).map_err(|e| format!("read: {e}"))?;
    probe.truncate(n);
    if has_nul(&probe) {
        return Ok(Vec::new());
    }
    file.seek(SeekFrom::Start(0))
        .map_err(|e| format!("seek: {e}"))?;

    let mut buf = Vec::with_capacity(meta.len() as usize);
    file.take(MAX_FILE_BYTES)
        .read_to_end(&mut buf)
        .map_err(|e| format!("read: {e}"))?;
    if has_nul(&buf) {
        return Ok(Vec::new());
    }

    let text = String::from_utf8_lossy(&buf);
    let path_str = path.to_string_lossy().into_owned();
    let mut hits = Vec::new();
    for (idx, line) in text.lines().enumerate() {
        if hits.len() >= MAX_MATCHES_PER_FILE {
            break;
        }
        if let Some((start, end)) = matcher.find_in_line(line) {
            hits.push(SearchHitDto {
                path: path_str.clone(),
                line: (idx + 1) as u32,
                column: char_column(line, start),
                end_column: char_column(line, end),
                preview: truncate_preview(line),
            });
        }
    }
    Ok(hits)
}

fn build_walker(root: &Path, excludes: &SearchExcludeSettings) -> Result<ignore::Walk, String> {
    // Avoid \\?\ verbatim prefixes — they break gitignore matching on Windows.
    let root = dunce_simplified(root);
    let mut builder = WalkBuilder::new(&root);
    builder.follow_links(false);
    builder.standard_filters(false);
    if excludes.enabled {
        builder.hidden(excludes.skip_hidden);
        builder.git_ignore(excludes.use_gitignore);
        builder.git_global(false);
        builder.git_exclude(excludes.use_git_exclude);
        builder.ignore(excludes.use_ignore_file);
        let excludes = excludes.clone();
        builder.filter_entry(move |entry| {
            !is_excluded_path(
                entry.path(),
                entry.file_type().map(|t| t.is_dir()).unwrap_or(false),
                &excludes,
            )
        });
    } else {
        builder.hidden(false);
        builder.git_ignore(false);
        builder.git_global(false);
        builder.git_exclude(false);
        builder.ignore(false);
    }
    Ok(builder.build())
}

fn dunce_simplified(path: &Path) -> PathBuf {
    let raw = path.to_string_lossy();
    if let Some(stripped) = raw.strip_prefix(r"\\?\") {
        PathBuf::from(stripped)
    } else {
        path.to_path_buf()
    }
}

fn is_excluded_path(path: &Path, is_dir: bool, excludes: &SearchExcludeSettings) -> bool {
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if name.is_empty() {
        return false;
    }

    if excludes.skip_dependencies
        && matches!(
            name.as_str(),
            "node_modules" | "bower_components" | "vendor"
        )
    {
        return true;
    }
    if excludes.skip_build
        && matches!(
            name.as_str(),
            "dist" | "build" | "out" | "target" | ".next" | "coverage"
        )
    {
        return true;
    }
    if excludes.skip_vcs && matches!(name.as_str(), ".git" | ".hg") {
        return true;
    }
    if excludes.skip_svn && name == ".svn" {
        return true;
    }
    if excludes.skip_ide && matches!(name.as_str(), ".idea" | ".vscode" | ".vs" | ".cursor") {
        return true;
    }
    if excludes.skip_os_junk && !is_dir && matches!(name.as_str(), ".ds_store" | "thumbs.db") {
        return true;
    }

    for custom in &excludes.custom_dirs {
        let custom_key = custom.replace('\\', "/").to_ascii_lowercase();
        if custom_key.contains('/') {
            let path_key = path.to_string_lossy().replace('\\', "/").to_ascii_lowercase();
            if path_key.ends_with(&custom_key)
                || path_key.contains(&format!("/{custom_key}/"))
                || path_key.ends_with(&format!("/{custom_key}"))
            {
                return true;
            }
        } else if name == custom_key {
            return true;
        }
    }
    false
}

fn emit_hits(app: &AppHandle, id: u64, hits: &mut Vec<SearchHitDto>) {
    if hits.is_empty() {
        return;
    }
    let batch = std::mem::take(hits);
    let _ = app.emit("search-hits", SearchHitsEvent { id, hits: batch });
}

fn emit_done(
    app: &AppHandle,
    id: u64,
    files_searched: u32,
    match_count: u32,
    truncated: bool,
    cancelled: bool,
    error: Option<String>,
) {
    let _ = app.emit(
        "search-done",
        SearchDoneEvent {
            id,
            files_searched,
            match_count,
            truncated,
            cancelled,
            error,
        },
    );
}

pub fn cancel_search(state: &SearchState) {
    state.active_id.store(0, Ordering::SeqCst);
}

pub fn start_search(
    app: AppHandle,
    request_id: u64,
    root: String,
    query: String,
    options: SearchOptions,
) -> Result<(), String> {
    if request_id == 0 {
        return Err("invalid request id".into());
    }
    let root_path = dunce_simplified(Path::new(&root));
    if !root_path.is_dir() {
        return Err(format!("not a directory: {root}"));
    }
    let matcher = Matcher::compile(&query, &options)?;
    app.state::<SearchState>()
        .active_id
        .store(request_id, Ordering::SeqCst);
    let excludes = options.excludes.normalized();
    let id = request_id;

    thread::spawn(move || {
        let alive = || {
            app.state::<SearchState>().active_id.load(Ordering::SeqCst) == id
        };
        if !alive() {
            emit_done(&app, id, 0, 0, false, true, None);
            return;
        }

        let walker = match build_walker(&root_path, &excludes) {
            Ok(w) => w,
            Err(err) => {
                emit_done(&app, id, 0, 0, false, false, Some(err));
                return;
            }
        };

        let mut pending = Vec::with_capacity(HIT_BATCH);
        let mut files_searched = 0u32;
        let mut match_count = 0usize;
        let mut truncated = false;

        for entry in walker {
            if !alive() {
                emit_hits(&app, id, &mut pending);
                emit_done(&app, id, files_searched, match_count as u32, truncated, true, None);
                return;
            }
            let entry = match entry {
                Ok(e) => e,
                Err(_) => continue,
            };
            if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                continue;
            }
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            files_searched = files_searched.saturating_add(1);
            match search_file(path, &matcher) {
                Ok(hits) if !hits.is_empty() => {
                    for hit in hits {
                        if match_count >= MAX_MATCHES_TOTAL {
                            truncated = true;
                            break;
                        }
                        match_count += 1;
                        pending.push(hit);
                        if pending.len() >= HIT_BATCH {
                            emit_hits(&app, id, &mut pending);
                        }
                    }
                    if truncated {
                        break;
                    }
                }
                Ok(_) => {}
                Err(_) => {}
            }
        }

        emit_hits(&app, id, &mut pending);
        emit_done(
            &app,
            id,
            files_searched,
            match_count as u32,
            truncated,
            false,
            None,
        );
    });

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_hello_case_insensitive() {
        let matcher = Matcher::compile(
            "Hello",
            &SearchOptions {
                match_case: false,
                whole_word: false,
                use_regex: false,
                excludes: SearchExcludeSettings::default(),
            },
        )
        .unwrap();
        let line = r#"        let original = "Hello 你好";"#;
        let found = matcher.find_in_line(line).expect("should match");
        assert_eq!(&line[found.0..found.1], "Hello");
    }

    #[test]
    fn walker_finds_encoding_rs_hello() {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
        let root = dunce_simplified(&root.canonicalize().expect("repo root"));
        let matcher = Matcher::compile(
            "Hello",
            &SearchOptions {
                match_case: false,
                whole_word: false,
                use_regex: false,
                excludes: SearchExcludeSettings::default(),
            },
        )
        .unwrap();

        for (label, excludes) in [
            ("plain", SearchExcludeSettings {
                enabled: false,
                ..SearchExcludeSettings::default()
            }),
            ("excludes", SearchExcludeSettings::default()),
        ] {
            let walker = build_walker(&root, &excludes).expect("walker");
            let mut encoding_hits = 0usize;
            let mut saw_encoding = false;
            let mut files = 0usize;
            for entry in walker {
                let Ok(entry) = entry else { continue };
                if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                    continue;
                }
                let path = entry.path();
                if !path.is_file() {
                    continue;
                }
                files += 1;
                if path.file_name().and_then(|n| n.to_str()) == Some("encoding.rs") {
                    saw_encoding = true;
                    encoding_hits = search_file(path, &matcher).unwrap().len();
                }
            }
            eprintln!("{label}: files={files} saw_encoding={saw_encoding} hits={encoding_hits}");
            assert!(files > 0, "{label}: no files under {}", root.display());
            assert!(saw_encoding, "{label}: encoding.rs missing");
            assert!(encoding_hits > 0, "{label}: no Hello hits");
            if excludes.enabled {
                assert!(
                    files < 5_000,
                    "{label}: excludes too weak, scanned {files} files"
                );
            }
        }
    }
}
