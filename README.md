# Lapeditor

Lightweight notepad shell: **Tauri 2 + Monaco + TextMate (`vscode-textmate` / `vscode-oniguruma`)**.

Language support is **plugin-based** (folder drop-in), not a heavy built-in pack.

## Dev

```bash
npm install
npm run tauri dev
```

## Language plugins

See [`languages/README.md`](languages/README.md).

Ship a few samples under `languages/` (javascript / python / json / rust / markdown). Add more by copying a folder with `language.json` + `.tmLanguage.json`.

## Current scope

- Multi-tab editor
- Find / Replace via Monaco (`Ctrl+F` / `Ctrl+H`)
- Open / Save
- TextMate highlighting from plugins

Not included yet: session restore, HEX viewer.
