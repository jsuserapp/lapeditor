# Lapeditor

Lightweight notepad: **Tauri 2 + Monaco + TextMate**. Language support is folder plugins, not a built-in pack.

## Dev

```bash
pnpm install
pnpm dev
```

`pnpm dev` starts Tauri with `--no-watch`. Editing Rust files does not auto-rebuild; stop and run `pnpm dev` again.

## Portable layout

Runtime files stay beside the executable (repo root during `pnpm dev`):

```
Lapeditor.exe
config/
  settings.json      # zoom and other prefs
  window.json        # position / size
plugin/
  languages/         # TextMate language plugins
data/
  webview/           # WebView2 cache (Windows)
```

## Language plugins

See [`plugin/languages/README.md`](plugin/languages/README.md).

Samples: javascript / python / json / rust / markdown. Add a folder with `language.json` + grammar and restart.

## Current scope

- Multi-tab editor
- Find / Replace (`Ctrl+F` / `Ctrl+H`)
- Open / Save
- Window zoom (`Ctrl+=` / `Ctrl+-` / `Ctrl+0`)
- TextMate highlighting from plugins
