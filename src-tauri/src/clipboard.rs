pub fn read_text() -> Result<String, String> {
    arboard::Clipboard::new()
        .map_err(|err| err.to_string())?
        .get_text()
        .map_err(|err| err.to_string())
}

pub fn write_text(text: &str) -> Result<(), String> {
    arboard::Clipboard::new()
        .map_err(|err| err.to_string())?
        .set_text(text.to_string())
        .map_err(|err| err.to_string())
}
