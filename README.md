<p align="center">
  <img src="src/assets/logo.png" width="256" alt="Lapeditor" />
</p>

<h1 align="center">Lapeditor</h1>

<p align="center">
  A lightweight text editor for everyday writing and reading.<br />
  It covers basic text and code editing, reading, and find — fast and simple, not a full IDE.
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
- Find and replace in the current file (`Ctrl+F` / `Ctrl+H`)
- Workspace search across open folders (`Ctrl+Shift+F`), with match options and configurable exclude rules
- New / Open / Save / Save As, plus drag-and-drop files
- File explorer with create / delete, folder watch, and external change prompts
- TextMate syntax highlighting; bundled presets include JavaScript, Python, JSON, Rust, Markdown
- Add more languages from the in-app catalog
- Format document (`Shift+Alt+F`) — Prettier for web languages, external tools such as `rustfmt` for others
- Word wrap, HEX view (with undo / redo), Markdown split preview and reader mode (KaTeX, Mermaid)
- Encodings: ANSI, UTF-8, UTF-8 BOM, UTF-16 BE/LE
- Line endings: CRLF / LF
- Light and dark themes, English / 中文 UI
- Page zoom (`Ctrl+=` / `Ctrl+-` / `Ctrl+0`)
- Portable layout: settings and plugins live next to the executable
- Windows custom title bar (drag the toolbar; minimize / maximize / close)

## Stack

| Layer | Components |
| --- | --- |
| App shell | [Tauri 2](https://tauri.app/) (Rust + system WebView) |
| Editor | [Monaco Editor](https://microsoft.github.io/monaco-editor/) |
| Highlighting | [vscode-textmate](https://github.com/microsoft/vscode-textmate) + [vscode-oniguruma](https://github.com/microsoft/vscode-oniguruma) |
| Markdown | [marked](https://marked.js.org/), [KaTeX](https://katex.org/), [Mermaid](https://mermaid.js.org/) |
| Format | [Prettier](https://prettier.io/) (JS / TS / JSON / CSS / HTML / Markdown); optional external CLIs for other languages |
| UI icons | [Lucide](https://lucide.dev/) (plus bundled PNGs) |
| File watch | [notify](https://github.com/notify-rs/notify) |
| Workspace search | [ignore](https://github.com/BurntSushi/ripgrep/tree/master/crates/ignore) + [regex](https://github.com/rust-lang/regex) |
| Encoding | [encoding_rs](https://github.com/hsivonen/encoding_rs) |
| Frontend tooling | TypeScript, Vite, pnpm |

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
