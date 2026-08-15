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
  <a href="docs/download.md">Binary downloads</a>
</p>

## Download

Installers are published on the [GitHub Releases](https://github.com/jsuserapp/lapeditor/releases) page — the same pattern used by most open-source desktop apps.

- **[Latest release](https://github.com/jsuserapp/lapeditor/releases/latest)** — recommended
- [All versions](https://github.com/jsuserapp/lapeditor/releases)
- [Which file should I pick?](docs/download.md)

Windows 10 / 11: download the `.exe` NSIS installer. macOS and Linux builds appear on the same page when a release includes them.

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

## Requirements

| Tool | Version |
| --- | --- |
| Node.js | 20 or newer |
| pnpm | 11.8.0 (see `packageManager` in `package.json`) |
| Rust | stable toolchain (`rustup`) |
| Windows | WebView2 (preinstalled on recent Windows 10/11), plus [Visual Studio C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) |

On Linux you also need WebKitGTK development packages (see the [Tauri Linux prerequisites](https://v2.tauri.app/start/prerequisites/)).

## Debug (development)

```bash
pnpm install
pnpm dev
```

`pnpm dev` starts Vite and the Tauri window. It passes `--no-watch` to the Tauri CLI:

- **Frontend** (`src/`, `index.html`, `locale/`, `src/styles.css`): Vite hot-reloads.
- **Rust** (`src-tauri/`): no auto-rebuild. Stop the process and run `pnpm dev` again.

Useful checks:

```bash
# TypeScript
npx tsc --noEmit

# Rust
cd src-tauri
cargo check
```

In a debug window you can open WebView DevTools (right-click → Inspect, or `Ctrl+Shift+I` on Windows) to debug the frontend.

## Compile (release)

```bash
pnpm install
pnpm tauri build
```

This type-checks the frontend, runs Vite, then builds a release binary and installers.

Typical Windows output:

```
src-tauri/target/release/lapeditor.exe
src-tauri/target/release/bundle/nsis/          # installer .exe
src-tauri/target/release/bundle/msi/           # MSI, if produced
```

Do not commit those binaries. Upload them as a GitHub Release — see [docs/publish.md](docs/publish.md).

Short version: push `main` (including `.github/workflows/release.yml`), then:

```bash
git tag v0.1.0
git push origin v0.1.0
```

GitHub Actions builds each platform and attaches the installers. You can also build locally and upload the files by hand (same doc).

## Portable layout

Runtime files stay beside the executable (repo root during `pnpm dev`):

```
Lapeditor.exe
config/
  settings.json      # zoom, theme, locale, explorer
  window.json        # position / size
  formatters.json    # format indent and external commands
plugin/
  languages/         # TextMate language plugins
data/
  session/           # open tabs
  webview/           # WebView2 cache (Windows)
```

## Language plugins

See [`plugin/languages/README.md`](plugin/languages/README.md).

Each language is a folder with `language.json` and a TextMate grammar. Drop it under `plugin/languages/` and restart. Bundled samples: javascript, python, json, rust, markdown.

## License

Lapeditor is released under the [MIT License](LICENSE).

It uses other open-source components (Tauri, Monaco Editor, vscode-textmate, and more). Those projects keep their own licenses; see [THIRD_PARTY.md](THIRD_PARTY.md).
