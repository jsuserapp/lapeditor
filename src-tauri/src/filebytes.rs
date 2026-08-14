use crate::encoding::{self, TextEncoding};
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileBytesChunk {
    pub data: String,
    pub offset: u64,
    pub total_size: u64,
    pub encoding: Option<String>,
}

fn b64_encode(bytes: &[u8]) -> String {
    STANDARD.encode(bytes)
}

fn b64_decode(data: &str) -> Result<Vec<u8>, String> {
    STANDARD.decode(data).map_err(|e| format!("base64: {e}"))
}

pub fn read_file_bytes(path: &str, offset: u64, length: u64) -> Result<FileBytesChunk, String> {
    let meta = fs::metadata(path).map_err(|e| format!("stat {path}: {e}"))?;
    if meta.is_dir() {
        return Err(format!("read {path}: is a directory"));
    }
    let mut file = File::open(path).map_err(|e| format!("read {path}: {e}"))?;
    let total_size = meta.len();
    if offset >= total_size || length == 0 {
        return Ok(FileBytesChunk {
            data: String::new(),
            offset,
            total_size,
            encoding: if offset == 0 {
                Some(TextEncoding::Utf8.as_str().to_string())
            } else {
                None
            },
        });
    }
    let take = length.min(total_size - offset) as usize;
    file.seek(SeekFrom::Start(offset))
        .map_err(|e| format!("seek {path}: {e}"))?;
    let mut buf = vec![0u8; take];
    file.read_exact(&mut buf)
        .map_err(|e| format!("read {path}: {e}"))?;
    let encoding = if offset == 0 {
        Some(encoding::detect_encoding(&buf).as_str().to_string())
    } else {
        None
    };
    Ok(FileBytesChunk {
        data: b64_encode(&buf),
        offset,
        total_size,
        encoding,
    })
}

pub fn write_file_bytes(
    path: &str,
    prefix_b64: &str,
    tail_offset: Option<u64>,
    tail_from: Option<&str>,
) -> Result<(), String> {
    let prefix = b64_decode(prefix_b64)?;
    let parent = Path::new(path).parent().filter(|p| !p.as_os_str().is_empty());
    let tmp = match parent {
        Some(dir) => dir.join(format!(
            ".{}.lapeditor-tmp",
            Path::new(path)
                .file_name()
                .map(|n| n.to_string_lossy())
                .unwrap_or_default()
        )),
        None => Path::new(path).with_extension("lapeditor-tmp"),
    };

    {
        let mut out = File::create(&tmp).map_err(|e| format!("create {}: {e}", tmp.display()))?;
        out.write_all(&prefix)
            .map_err(|e| format!("write {}: {e}", tmp.display()))?;
        if let Some(offset) = tail_offset {
            let src_path = tail_from.unwrap_or(path);
            if let Ok(mut src) = File::open(src_path) {
                if let Ok(meta) = src.metadata() {
                    if offset < meta.len() {
                        src.seek(SeekFrom::Start(offset))
                            .map_err(|e| format!("seek {path}: {e}"))?;
                        std::io::copy(&mut src, &mut out)
                            .map_err(|e| format!("copy tail {path}: {e}"))?;
                    }
                }
            }
        }
        out.flush()
            .map_err(|e| format!("flush {}: {e}", tmp.display()))?;
    }

    fs::rename(&tmp, path).or_else(|_| {
        fs::remove_file(path).ok();
        fs::rename(&tmp, path)
    }).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("replace {path}: {e}")
    })?;
    Ok(())
}

pub fn decode_b64(data: &str, encoding: &str) -> Result<String, String> {
    let bytes = b64_decode(data)?;
    Ok(encoding::decode_bytes(&bytes, TextEncoding::parse(encoding)))
}

pub fn encode_b64(text: &str, encoding: &str) -> String {
    b64_encode(&encoding::encode_string(text, TextEncoding::parse(encoding)))
}

pub fn convert_b64(data: &str, from: &str, to: &str) -> Result<String, String> {
    let bytes = b64_decode(data)?;
    Ok(b64_encode(&encoding::convert_text_bytes(&bytes, from, to)))
}
