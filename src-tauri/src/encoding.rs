use encoding_rs::{DecoderResult, Encoding, UTF_16BE, UTF_16LE, UTF_8, WINDOWS_1252};
use serde::{Deserialize, Serialize};
use std::fmt::Write as _;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum TextEncoding {
    Ansi,
    Utf8,
    Utf8Bom,
    Utf16be,
    Utf16le,
}

impl Default for TextEncoding {
    fn default() -> Self {
        Self::Utf8
    }
}

impl TextEncoding {
    pub fn parse(value: &str) -> Self {
        match value.trim().to_ascii_lowercase().as_str() {
            "ansi" => Self::Ansi,
            "utf-8-bom" | "utf8-bom" | "utf8bom" => Self::Utf8Bom,
            "utf-16be" | "utf16be" | "utf-16-be" => Self::Utf16be,
            "utf-16le" | "utf16le" | "utf-16-le" => Self::Utf16le,
            _ => Self::Utf8,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Ansi => "ansi",
            Self::Utf8 => "utf-8",
            Self::Utf8Bom => "utf-8-bom",
            Self::Utf16be => "utf-16be",
            Self::Utf16le => "utf-16le",
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextFile {
    pub contents: String,
    pub encoding: String,
}

#[cfg(windows)]
extern "system" {
    fn GetACP() -> u32;
}

fn ansi_encoding() -> &'static Encoding {
    #[cfg(windows)]
    {
        let acp = unsafe { GetACP() };
        return match acp {
            874 => encoding_rs::WINDOWS_874,
            932 => encoding_rs::SHIFT_JIS,
            936 => encoding_rs::GBK,
            949 => encoding_rs::EUC_KR,
            950 => encoding_rs::BIG5,
            1250 => encoding_rs::WINDOWS_1250,
            1251 => encoding_rs::WINDOWS_1251,
            1252 => WINDOWS_1252,
            1253 => encoding_rs::WINDOWS_1253,
            1254 => encoding_rs::WINDOWS_1254,
            1255 => encoding_rs::WINDOWS_1255,
            1256 => encoding_rs::WINDOWS_1256,
            1257 => encoding_rs::WINDOWS_1257,
            1258 => encoding_rs::WINDOWS_1258,
            20866 => encoding_rs::KOI8_R,
            21866 => encoding_rs::KOI8_U,
            _ => WINDOWS_1252,
        };
    }
    #[cfg(not(windows))]
    WINDOWS_1252
}

pub fn detect_encoding(bytes: &[u8]) -> TextEncoding {
    if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        return TextEncoding::Utf8Bom;
    }
    if bytes.starts_with(&[0xFF, 0xFE]) {
        return TextEncoding::Utf16le;
    }
    if bytes.starts_with(&[0xFE, 0xFF]) {
        return TextEncoding::Utf16be;
    }
    if looks_like_utf16_le(bytes) {
        return TextEncoding::Utf16le;
    }
    if is_text_utf8(bytes) {
        return TextEncoding::Utf8;
    }
    TextEncoding::Ansi
}

fn is_text_utf8(bytes: &[u8]) -> bool {
    !bytes.contains(&0) && std::str::from_utf8(bytes).is_ok()
}

fn looks_like_utf16_le(bytes: &[u8]) -> bool {
    if bytes.len() < 4 {
        return false;
    }
    let even = if bytes.len() % 2 == 0 {
        bytes
    } else {
        &bytes[..bytes.len() - 1]
    };
    if even.len() < 4 {
        return false;
    }

    let pairs = even.len() / 2;
    let mut high_zero = 0usize;
    let mut low_zero = 0usize;
    let mut unpaired = 0usize;
    let mut cjk = 0usize;
    let mut ascii = 0usize;
    let mut pending_high = false;

    for chunk in even.chunks_exact(2) {
        let unit = u16::from_le_bytes([chunk[0], chunk[1]]);
        if chunk[1] == 0 {
            high_zero += 1;
        }
        if chunk[0] == 0 {
            low_zero += 1;
        }
        if (0xD800..=0xDBFF).contains(&unit) {
            pending_high = true;
        } else if (0xDC00..=0xDFFF).contains(&unit) {
            if pending_high {
                pending_high = false;
            } else {
                unpaired += 1;
            }
        } else {
            if pending_high {
                unpaired += 1;
                pending_high = false;
            }
            if (0x20..=0x7E).contains(&unit) || unit == 9 || unit == 10 || unit == 13 {
                ascii += 1;
            } else if (0x4E00..=0x9FFF).contains(&unit) || (0x3400..=0x4DBF).contains(&unit) {
                cjk += 1;
            }
        }
    }
    if pending_high {
        unpaired += 1;
    }

    if unpaired * 8 > pairs {
        return false;
    }
    if high_zero * 2 >= pairs && high_zero > low_zero {
        return true;
    }
    if bytes.contains(&0) && high_zero > low_zero {
        return true;
    }
    if !is_text_utf8(bytes) && (cjk + ascii) * 2 >= pairs && cjk > 0 {
        return true;
    }
    false
}

fn codec(encoding: TextEncoding) -> &'static Encoding {
    match encoding {
        TextEncoding::Utf8 | TextEncoding::Utf8Bom => UTF_8,
        TextEncoding::Utf16le => UTF_16LE,
        TextEncoding::Utf16be => UTF_16BE,
        TextEncoding::Ansi => ansi_encoding(),
    }
}

fn strip_decode_bom(bytes: &[u8], encoding: TextEncoding) -> &[u8] {
    match encoding {
        TextEncoding::Utf8Bom if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) => &bytes[3..],
        TextEncoding::Utf16le if bytes.starts_with(&[0xFF, 0xFE]) => &bytes[2..],
        TextEncoding::Utf16be if bytes.starts_with(&[0xFE, 0xFF]) => &bytes[2..],
        _ => bytes,
    }
}

fn push_byte_mark(out: &mut String, byte: u8) {
    let _ = write!(out, "[x{byte:02X}]");
}

fn parse_byte_mark(text: &str) -> Option<u8> {
    let rest = text.strip_prefix("[x")?;
    if rest.len() < 3 || !rest.is_char_boundary(2) || rest.as_bytes().get(2) != Some(&b']') {
        return None;
    }
    u8::from_str_radix(&rest[..2], 16).ok()
}

fn decode_marked(enc: &'static Encoding, bytes: &[u8]) -> String {
    let mut out = String::new();
    let mut decoder = enc.new_decoder_without_bom_handling();
    let mut offset = 0usize;
    while offset < bytes.len() {
        let src = &bytes[offset..];
        let cap = decoder
            .max_utf8_buffer_length_without_replacement(src.len())
            .unwrap_or(src.len().saturating_mul(3).saturating_add(16));
        let mut tmp = String::new();
        tmp.reserve(cap);
        let (result, read) = decoder.decode_to_string_without_replacement(src, &mut tmp, false);
        out.push_str(&tmp);
        if read == 0 {
            push_byte_mark(&mut out, bytes[offset]);
            offset += 1;
            decoder = enc.new_decoder_without_bom_handling();
            continue;
        }
        match result {
            DecoderResult::InputEmpty => {
                offset += read;
                break;
            }
            DecoderResult::OutputFull => {
                offset += read;
            }
            DecoderResult::Malformed(bad_len, _) => {
                let consumed_end = offset + read;
                let mal_start = consumed_end.saturating_sub(bad_len as usize);
                for &b in &bytes[mal_start..consumed_end] {
                    push_byte_mark(&mut out, b);
                }
                offset = consumed_end;
                decoder = enc.new_decoder_without_bom_handling();
            }
        }
    }
    let cap = decoder
        .max_utf8_buffer_length_without_replacement(0)
        .unwrap_or(16);
    let mut tail = String::new();
    tail.reserve(cap);
    let (result, _) = decoder.decode_to_string_without_replacement(&[], &mut tail, true);
    out.push_str(&tail);
    if let DecoderResult::Malformed(bad_len, _) = result {
        let mal_start = bytes.len().saturating_sub(bad_len as usize);
        for &b in &bytes[mal_start.max(offset)..] {
            push_byte_mark(&mut out, b);
        }
    } else if offset < bytes.len() {
        for &b in &bytes[offset..] {
            push_byte_mark(&mut out, b);
        }
    }
    out
}

pub fn decode_bytes(bytes: &[u8], encoding: TextEncoding) -> String {
    decode_marked(codec(encoding), strip_decode_bom(bytes, encoding))
}

fn encode_utf16_units(text: &str, little_endian: bool) -> Vec<u8> {
    let mut out = Vec::new();
    for unit in text.encode_utf16() {
        let raw = if little_endian {
            unit.to_le_bytes()
        } else {
            unit.to_be_bytes()
        };
        out.extend_from_slice(&raw);
    }
    out
}

fn encode_plain(text: &str, encoding: TextEncoding) -> Vec<u8> {
    match encoding {
        TextEncoding::Utf8 => text.as_bytes().to_vec(),
        TextEncoding::Utf8Bom => {
            let mut out = vec![0xEF, 0xBB, 0xBF];
            out.extend_from_slice(text.as_bytes());
            out
        }
        TextEncoding::Utf16le => {
            let mut out = vec![0xFF, 0xFE];
            out.extend(encode_utf16_units(text, true));
            out
        }
        TextEncoding::Utf16be => {
            let mut out = vec![0xFE, 0xFF];
            out.extend(encode_utf16_units(text, false));
            out
        }
        TextEncoding::Ansi => ansi_encoding().encode(text).0.into_owned(),
    }
}

fn encode_char_body(ch: char, encoding: TextEncoding) -> Vec<u8> {
    match encoding {
        TextEncoding::Utf8 | TextEncoding::Utf8Bom => {
            let mut buf = [0u8; 4];
            ch.encode_utf8(&mut buf).as_bytes().to_vec()
        }
        TextEncoding::Utf16le => encode_utf16_units(&ch.to_string(), true),
        TextEncoding::Utf16be => encode_utf16_units(&ch.to_string(), false),
        TextEncoding::Ansi => ansi_encoding().encode(&ch.to_string()).0.into_owned(),
    }
}

pub fn encode_string(text: &str, encoding: TextEncoding) -> Vec<u8> {
    let mut body = Vec::new();
    let mut pos = 0usize;
    while pos < text.len() {
        if let Some(byte) = parse_byte_mark(&text[pos..]) {
            body.push(byte);
            pos += 5;
            continue;
        }
        let ch = text[pos..].chars().next().expect("valid utf-8");
        body.extend(encode_char_body(ch, encoding));
        pos += ch.len_utf8();
    }
    match encoding {
        TextEncoding::Utf8Bom => {
            let mut out = vec![0xEF, 0xBB, 0xBF];
            out.extend(body);
            out
        }
        TextEncoding::Utf16le => {
            let mut out = vec![0xFF, 0xFE];
            out.extend(body);
            out
        }
        TextEncoding::Utf16be => {
            let mut out = vec![0xFE, 0xFF];
            out.extend(body);
            out
        }
        _ => body,
    }
}

fn expand_byte_markers(text: &str) -> String {
    let mut out = String::new();
    let mut pos = 0usize;
    while pos < text.len() {
        if let Some(byte) = parse_byte_mark(&text[pos..]) {
            out.push(char::from(byte));
            pos += 5;
            continue;
        }
        let ch = text[pos..].chars().next().expect("valid utf-8");
        out.push(ch);
        pos += ch.len_utf8();
    }
    out
}

pub fn convert_bytes(bytes: &[u8], from: TextEncoding, to: TextEncoding) -> Vec<u8> {
    let display = decode_bytes(bytes, from);
    encode_plain(&expand_byte_markers(&display), to)
}

pub fn read_text_file(path: &str, encoding: Option<&str>) -> Result<TextFile, String> {
    let bytes = std::fs::read(path).map_err(|e| format!("read {path}: {e}"))?;
    let encoding = encoding
        .map(TextEncoding::parse)
        .unwrap_or_else(|| detect_encoding(&bytes));
    Ok(TextFile {
        contents: decode_bytes(&bytes, encoding),
        encoding: encoding.as_str().to_string(),
    })
}

pub fn write_text_file(path: &str, contents: &str, encoding: &str) -> Result<(), String> {
    let bytes = encode_string(contents, TextEncoding::parse(encoding));
    std::fs::write(path, bytes).map_err(|e| format!("write {path}: {e}"))
}

pub fn reinterpret_text(contents: &str, from: &str, to: &str) -> String {
    let bytes = encode_string(contents, TextEncoding::parse(from));
    decode_bytes(&bytes, TextEncoding::parse(to))
}

pub fn convert_text_bytes(data: &[u8], from: &str, to: &str) -> Vec<u8> {
    convert_bytes(data, TextEncoding::parse(from), TextEncoding::parse(to))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn utf16le_encode_has_single_bom() {
        let bytes = encode_string("a", TextEncoding::Utf16le);
        assert!(bytes.starts_with(&[0xFF, 0xFE]));
        assert!(bytes.len() >= 4);
        assert_ne!(&bytes[2..4], &[0xFF, 0xFE]);
        assert_eq!(decode_bytes(&bytes, TextEncoding::Utf16le), "a");
    }

    #[test]
    fn utf8_bom_roundtrip() {
        let bytes = encode_string("你好", TextEncoding::Utf8Bom);
        assert!(bytes.starts_with(&[0xEF, 0xBB, 0xBF]));
        assert_eq!(detect_encoding(&bytes), TextEncoding::Utf8Bom);
        assert_eq!(decode_bytes(&bytes, TextEncoding::Utf8Bom), "你好");
    }

    #[test]
    fn detect_follows_bom() {
        assert_eq!(detect_encoding(&[0xEF, 0xBB, 0xBF, b'a']), TextEncoding::Utf8Bom);
        assert_eq!(detect_encoding(&[0xFF, 0xFE, b'a', 0]), TextEncoding::Utf16le);
        assert_eq!(detect_encoding(&[0xFE, 0xFF, 0, b'a']), TextEncoding::Utf16be);
    }

    #[test]
    fn detect_utf8_without_bom() {
        assert_eq!(detect_encoding("hello".as_bytes()), TextEncoding::Utf8);
        assert_eq!(detect_encoding("你好".as_bytes()), TextEncoding::Utf8);
        assert_eq!(detect_encoding(&[]), TextEncoding::Utf8);
    }

    #[test]
    fn detect_windows_unicode_without_bom() {
        let bytes = [b'H', 0, b'i', 0, b'\n', 0];
        assert_eq!(detect_encoding(&bytes), TextEncoding::Utf16le);
    }

    #[test]
    fn detect_ansi_when_not_utf8() {
        let gbk_nihao = [0xC4, 0xE3, 0xBA, 0xC3];
        assert_eq!(detect_encoding(&gbk_nihao), TextEncoding::Ansi);
    }

    #[test]
    fn use_encoding_keeps_original_bytes() {
        let original = "Hello 你好";
        let utf8 = encode_string(original, TextEncoding::Utf8);
        let as_ansi = decode_bytes(&utf8, TextEncoding::Ansi);
        assert_ne!(as_ansi, original);
        assert_eq!(encode_string(&as_ansi, TextEncoding::Ansi), utf8);
        assert_eq!(decode_bytes(&utf8, TextEncoding::Utf8), original);
    }

    #[test]
    fn edit_under_wrong_encoding_preserves_sides() {
        let original = "Hello 你好";
        let utf8 = encode_string(original, TextEncoding::Utf8);
        let as_ansi = decode_bytes(&utf8, TextEncoding::Ansi);
        assert!(as_ansi.starts_with("Hello "));
        let edited = as_ansi.replacen("Hello ", "Hello XXX ", 1);
        let new_bytes = encode_string(&edited, TextEncoding::Ansi);
        let back = decode_bytes(&new_bytes, TextEncoding::Utf8);
        assert!(back.starts_with("Hello XXX "));
        assert!(back.contains("你好"));
    }
}
