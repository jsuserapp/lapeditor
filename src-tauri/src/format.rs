use crate::languages::{command_formatter_for, valid_language_id};
use crate::paths;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};
use tauri::AppHandle;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FormatterFile {
    #[serde(default = "default_indent")]
    pub indent: String,
    #[serde(default)]
    pub commands: BTreeMap<String, CommandSpec>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandSpec {
    pub program: String,
    #[serde(default)]
    pub args: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FormatterCommandInfo {
    pub id: String,
    pub program: String,
    pub args: Vec<String>,
    pub source: String,
    pub available: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FormatterConfigDto {
    pub indent: String,
    pub commands: Vec<FormatterCommandInfo>,
}

fn default_indent() -> String {
    "2".into()
}

impl Default for FormatterFile {
    fn default() -> Self {
        Self {
            indent: default_indent(),
            commands: BTreeMap::new(),
        }
    }
}

fn normalize_indent(indent: &str) -> String {
    match indent.trim() {
        "4" => "4".into(),
        "tab" | "\t" => "tab".into(),
        _ => "2".into(),
    }
}

fn default_command(language_id: &str) -> Option<CommandSpec> {
    match language_id {
        "rust" => Some(CommandSpec {
            program: "rustfmt".into(),
            args: vec![
                "--emit=stdout".into(),
                "--config=skip_children=true".into(),
            ],
        }),
        "go" => Some(CommandSpec {
            program: "gofmt".into(),
            args: Vec::new(),
        }),
        "python" => Some(CommandSpec {
            program: "black".into(),
            args: vec!["-q".into(), "-".into()],
        }),
        "c" | "cpp" => Some(CommandSpec {
            program: "clang-format".into(),
            args: Vec::new(),
        }),
        _ => None,
    }
}

fn program_basename(program: &str) -> String {
    Path::new(program)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(program)
        .trim()
        .to_ascii_lowercase()
}

fn is_inplace_flag(arg: &str) -> bool {
    matches!(
        arg,
        "-i" | "-w" | "--inplace" | "--in-place" | "--write" | "--backup"
    )
}

fn looks_like_source_path(arg: &str) -> bool {
    if arg == "-" || arg.starts_with('-') {
        return false;
    }
    let path = Path::new(arg);
    path.is_absolute() || arg.contains('/') || arg.contains('\\') || path.is_file()
}

fn stdin_safe_args(program: &str, args: &[String]) -> Vec<String> {
    let name = program_basename(program);
    let mut out = Vec::new();
    let mut skip_next = false;
    for arg in args {
        if skip_next {
            skip_next = false;
            continue;
        }
        if arg == "--emit" {
            out.push("--emit=stdout".into());
            skip_next = true;
            continue;
        }
        if arg == "--emit=files" || arg.starts_with("--emit=files,") {
            out.push("--emit=stdout".into());
            continue;
        }
        if is_inplace_flag(arg) || looks_like_source_path(arg) {
            continue;
        }
        out.push(arg.clone());
    }

    if name == "rustfmt" || name == "rustfmt.exe" {
        if !out.iter().any(|a| a == "--emit" || a.starts_with("--emit=")) {
            out.push("--emit=stdout".into());
        }
        if !out.iter().any(|a| a.contains("skip_children")) {
            out.push("--config=skip_children=true".into());
        }
    }
    if (name == "black" || name == "black.exe") && !out.iter().any(|a| a == "-") {
        out.push("-".into());
    }
    out
}

fn isolated_temp_dir() -> Result<std::path::PathBuf, String> {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let dir = std::env::temp_dir().join(format!("lapeditor-fmt-{}-{nanos}", std::process::id()));
    std::fs::create_dir_all(&dir).map_err(|e| format!("create temp dir: {e}"))?;
    Ok(dir)
}

fn default_language_ids() -> [&'static str; 5] {
    ["c", "cpp", "go", "python", "rust"]
}

fn command_available(program: &str) -> bool {
    let program = program.trim();
    if program.is_empty() {
        return false;
    }
    if program.contains('/') || program.contains('\\') {
        return Path::new(program).is_file();
    }
    let Ok(path_var) = std::env::var("PATH") else {
        return false;
    };
    let mut exts = Vec::new();
    if cfg!(windows) {
        let pathext = std::env::var("PATHEXT").unwrap_or_else(|_| ".EXE;.CMD;.BAT".into());
        exts.extend(pathext.split(';').filter(|s| !s.is_empty()).map(|s| s.to_string()));
        if !program.contains('.') {
            // also try the name as given
            exts.push(String::new());
        }
    } else {
        exts.push(String::new());
    }
    for dir in std::env::split_paths(&path_var) {
        for ext in &exts {
            let candidate = if ext.is_empty() {
                dir.join(program)
            } else if program.to_ascii_lowercase().ends_with(&ext.to_ascii_lowercase()) {
                dir.join(program)
            } else {
                dir.join(format!("{program}{ext}"))
            };
            if candidate.is_file() {
                return true;
            }
        }
    }
    false
}

fn valid_program(program: &str) -> bool {
    let program = program.trim();
    !program.is_empty() && !program.contains('\0') && !program.contains('\n')
}

pub fn load_formatter_file() -> FormatterFile {
    let path = paths::formatters_path();
    let mut file: FormatterFile = std::fs::read_to_string(&path)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default();
    file.indent = normalize_indent(&file.indent);
    file.commands.retain(|id, spec| {
        valid_language_id(id) && valid_program(&spec.program)
    });
    file
}

fn save_formatter_file(file: &FormatterFile) -> Result<(), String> {
    let path = paths::formatters_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("create {}: {e}", parent.display()))?;
    }
    let json = serde_json::to_string_pretty(file).map_err(|e| e.to_string())?;
    std::fs::write(&path, json + "\n").map_err(|e| format!("write {}: {e}", path.display()))
}

fn resolve_command(app: &AppHandle, language_id: &str) -> Result<(CommandSpec, String), String> {
    let file = load_formatter_file();
    if let Some(spec) = file.commands.get(language_id) {
        return Ok((spec.clone(), "user".into()));
    }
    if let Some(spec) = command_formatter_for(app, language_id) {
        return Ok((
            CommandSpec {
                program: spec.program,
                args: spec.args,
            },
            "plugin".into(),
        ));
    }
    if let Some(spec) = default_command(language_id) {
        return Ok((spec, "default".into()));
    }
    Err(format!("no formatter configured for {language_id}"))
}

pub fn get_formatter_config(app: &AppHandle) -> FormatterConfigDto {
    let file = load_formatter_file();
    let mut commands = Vec::new();
    let mut seen = std::collections::HashSet::new();

    for (id, spec) in &file.commands {
        seen.insert(id.to_ascii_lowercase());
        commands.push(FormatterCommandInfo {
            id: id.clone(),
            program: spec.program.clone(),
            args: spec.args.clone(),
            source: "user".into(),
            available: command_available(&spec.program),
        });
    }

    for id in default_language_ids() {
        if seen.contains(id) {
            continue;
        }
        if let Some(spec) = command_formatter_for(app, id) {
            seen.insert(id.to_string());
            commands.push(FormatterCommandInfo {
                id: id.into(),
                program: spec.program.clone(),
                args: spec.args.clone(),
                source: "plugin".into(),
                available: command_available(&spec.program),
            });
            continue;
        }
        if let Some(spec) = default_command(id) {
            commands.push(FormatterCommandInfo {
                id: id.into(),
                program: spec.program.clone(),
                args: spec.args.clone(),
                source: "default".into(),
                available: command_available(&spec.program),
            });
        }
    }

    commands.sort_by(|a, b| a.id.cmp(&b.id));
    FormatterConfigDto {
        indent: file.indent,
        commands,
    }
}

pub fn save_format_indent(indent: &str) -> Result<FormatterFile, String> {
    let mut file = load_formatter_file();
    file.indent = normalize_indent(indent);
    save_formatter_file(&file)?;
    Ok(file)
}

pub fn save_formatter_command(
    language_id: &str,
    program: &str,
    args: Vec<String>,
) -> Result<FormatterFile, String> {
    let id = language_id.trim();
    if !valid_language_id(id) {
        return Err(format!("invalid language id: {id}"));
    }
    let program = program.trim();
    if !valid_program(program) {
        return Err("invalid formatter program".into());
    }
    let mut file = load_formatter_file();
    file.commands.insert(
        id.to_string(),
        CommandSpec {
            program: program.to_string(),
            args: args.into_iter().map(|a| a.trim().to_string()).filter(|a| !a.is_empty()).collect(),
        },
    );
    save_formatter_file(&file)?;
    Ok(file)
}

pub fn remove_formatter_command(language_id: &str) -> Result<FormatterFile, String> {
    let id = language_id.trim();
    if !valid_language_id(id) {
        return Err(format!("invalid language id: {id}"));
    }
    let mut file = load_formatter_file();
    file.commands.remove(id);
    save_formatter_file(&file)?;
    Ok(file)
}

pub fn format_with_command(app: &AppHandle, language_id: &str, text: &str) -> Result<String, String> {
    let id = language_id.trim();
    if !valid_language_id(id) {
        return Err(format!("invalid language id: {id}"));
    }
    let (spec, _source) = resolve_command(app, id)?;
    if !command_available(&spec.program) {
        return Err(format!("formatter not found: {}", spec.program));
    }

    let args = stdin_safe_args(&spec.program, &spec.args);
    let workdir = isolated_temp_dir()?;
    struct RemoveDir(std::path::PathBuf);
    impl Drop for RemoveDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
    let _cleanup = RemoveDir(workdir.clone());

    let mut child = Command::new(&spec.program)
        .args(&args)
        .current_dir(&workdir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("run {}: {e}", spec.program))?;

    {
        let stdin = child.stdin.as_mut().ok_or_else(|| "formatter stdin closed".to_string())?;
        stdin
            .write_all(text.as_bytes())
            .map_err(|e| format!("write formatter stdin: {e}"))?;
    }

    drop(child.stdin.take());
    let output = child
        .wait_with_output()
        .map_err(|e| format!("formatter exit: {e}"))?;
    let stdout = String::from_utf8(output.stdout).map_err(|_| "formatter output is not UTF-8".to_string())?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if stderr.is_empty() {
            return Err(format!("{} failed", spec.program));
        }
        return Err(stderr);
    }
    Ok(stdout)
}
