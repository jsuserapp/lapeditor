<p align="center">
  <img src="src/assets/logo.png" width="256" alt="Lapeditor" />
</p>

<h1 align="center">Lapeditor</h1>

<p align="center">
  A lightweight notepad-style editor built with <strong>Tauri 2 + Monaco + TextMate</strong>.<br />
  Language support comes from folder plugins, not a hard-coded pack.
</p>

<p align="center">
  <a href="README.md">English</a> · <a href="README.zh.md">中文</a>
  ·
  <a href="https://github.com/jsuserapp/lapeditor/releases/latest">Download</a>
  ·
  <a href="LICENSE">MIT License</a>
</p>

## Download

Installers are on [GitHub Releases](https://github.com/jsuserapp/lapeditor/releases/latest).

| Platform | File |
| --- | --- |
| Windows 10 / 11 (x64) | `Lapeditor_*_x64-setup.exe` |
| macOS | `.dmg` or `.app.tar.gz` |
| Linux | `.AppImage` or `.deb` |

## Features

- Multi-tab editing with unsaved-change prompts and session restore
- Find and replace (`Ctrl+F` / `Ctrl+H`)
- New / Open / Save / Save As, plus drag-and-drop files
- File explorer with folder watch (create, delete, rename)
- TextMate syntax highlighting from drop-in language plugins
- Bundled presets: JavaScript, Python, JSON, Rust, Markdown
- Add more languages from the in-app catalog
- Format document (`Shift+Alt+F`) — Prettier for web languages, external tools such as `rustfmt` for others
- Word wrap, HEX view, Markdown preview (including KaTeX and Mermaid)
- Encodings: ANSI, UTF-8, UTF-8 BOM, UTF-16 BE/LE
- Line endings: CRLF / LF
- Light and dark themes, English / 中文 UI
- Page zoom (`Ctrl+=` / `Ctrl+-` / `Ctrl+0`)
- Portable layout: settings and plugins live next to the executable
- Windows custom title bar (drag the toolbar; minimize / maximize / close)

## Build

Requires Node.js 20+, [pnpm](https://pnpm.io/) 11.8, a stable Rust toolchain, and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your OS.

```bash
pnpm install
pnpm dev          # development
pnpm tauri build  # release installers
```

## Language plugins

See [`plugin/languages/README.md`](plugin/languages/README.md). Each language is a folder with `language.json` and a TextMate grammar. Drop it under `plugin/languages/` and restart.

## License

[MIT](LICENSE). Third-party components keep their own licenses; see [THIRD_PARTY.md](THIRD_PARTY.md).
