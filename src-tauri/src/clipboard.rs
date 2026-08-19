use arboard::{Clipboard, ImageData};
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use png::{BitDepth, ColorType, Encoder};
use std::borrow::Cow;

pub fn read_text() -> Result<String, String> {
    Clipboard::new()
        .map_err(|err| err.to_string())?
        .get_text()
        .map_err(|err| err.to_string())
}

pub fn write_text(text: &str) -> Result<(), String> {
    Clipboard::new()
        .map_err(|err| err.to_string())?
        .set_text(text.to_string())
        .map_err(|err| err.to_string())
}

pub fn write_image_rgba(width: usize, height: usize, rgba: Vec<u8>) -> Result<(), String> {
    let expected = width
        .checked_mul(height)
        .and_then(|n| n.checked_mul(4))
        .ok_or_else(|| "clipboard image too large".to_string())?;
    if rgba.len() != expected {
        return Err(format!(
            "clipboard image size mismatch: {width}x{height} needs {expected} bytes, got {}",
            rgba.len()
        ));
    }
    Clipboard::new()
        .map_err(|err| err.to_string())?
        .set_image(ImageData {
            width,
            height,
            bytes: Cow::Owned(rgba),
        })
        .map_err(|err| err.to_string())
}

pub fn write_image_rgba_base64(width: u32, height: u32, data: &str) -> Result<(), String> {
    let bytes = STANDARD.decode(data).map_err(|e| format!("base64: {e}"))?;
    write_image_rgba(width as usize, height as usize, bytes)
}

pub fn write_image_file(path: &str) -> Result<(), String> {
    let img = image::open(path)
        .map_err(|e| format!("decode image: {e}"))?
        .to_rgba8();
    let width = img.width() as usize;
    let height = img.height() as usize;
    write_image_rgba(width, height, img.into_raw())
}

pub fn has_image() -> Result<bool, String> {
    let mut clipboard = Clipboard::new().map_err(|err| err.to_string())?;
    Ok(clipboard.get_image().is_ok())
}

pub fn read_image_png() -> Result<Option<Vec<u8>>, String> {
    let mut clipboard = Clipboard::new().map_err(|err| err.to_string())?;
    let image = match clipboard.get_image() {
        Ok(image) => image,
        Err(_) => return Ok(None),
    };
    let width = u32::try_from(image.width).map_err(|_| "clipboard image too large".to_string())?;
    let height = u32::try_from(image.height).map_err(|_| "clipboard image too large".to_string())?;
    let bytes = image.bytes.into_owned();
    Ok(Some(encode_png(width, height, &bytes)?))
}

fn encode_png(width: u32, height: u32, rgba: &[u8]) -> Result<Vec<u8>, String> {
    let expected = width as usize * height as usize * 4;
    if rgba.len() != expected {
        return Err(format!(
            "clipboard image size mismatch: {}x{} needs {expected} bytes, got {}",
            width,
            height,
            rgba.len()
        ));
    }
    let mut out = Vec::new();
    let mut encoder = Encoder::new(&mut out, width, height);
    encoder.set_color(ColorType::Rgba);
    encoder.set_depth(BitDepth::Eight);
    let mut writer = encoder.write_header().map_err(|e| e.to_string())?;
    writer.write_image_data(rgba).map_err(|e| e.to_string())?;
    writer.finish().map_err(|e| e.to_string())?;
    Ok(out)
}
