# Third-party software

Lapeditor is MIT-licensed. It depends on other open-source projects; those
projects keep their own copyright and license terms. Full texts ship with the
packages (`node_modules/`, crates.io / `Cargo.lock`).

## Frontend (npm)

| Package | License |
| --- | --- |
| [@tauri-apps/api](https://github.com/tauri-apps/tauri) | MIT OR Apache-2.0 |
| [@tauri-apps/plugin-dialog](https://github.com/tauri-apps/plugins-workspace) | MIT OR Apache-2.0 |
| [@tauri-apps/plugin-opener](https://github.com/tauri-apps/plugins-workspace) | MIT OR Apache-2.0 |
| [monaco-editor](https://github.com/microsoft/monaco-editor) | MIT |
| [vscode-textmate](https://github.com/microsoft/vscode-textmate) | MIT |
| [vscode-oniguruma](https://github.com/microsoft/vscode-oniguruma) | MIT |
| [prettier](https://github.com/prettier/prettier) | MIT |
| [marked](https://github.com/markedjs/marked) | MIT |
| [katex](https://github.com/KaTeX/KaTeX) | MIT |
| [marked-katex-extension](https://github.com/markedjs/marked-katex-extension) | MIT |
| [mermaid](https://github.com/mermaid-js/mermaid) | MIT |

Dev tools: [TypeScript](https://github.com/microsoft/TypeScript) (Apache-2.0),
[Vite](https://github.com/vitejs/vite) (MIT),
[@tauri-apps/cli](https://github.com/tauri-apps/tauri) (MIT OR Apache-2.0).

## Rust (crates)

Most crates used by the Tauri backend (including `tauri`, `serde`, `reqwest`,
`windows`) are **MIT OR Apache-2.0**. See `src-tauri/Cargo.toml` and
`src-tauri/Cargo.lock` for the exact set.

## Bundled language grammars

Sample TextMate grammars under `plugin/languages/` follow the licenses of their
upstream sources (typically MIT, as used by Visual Studio Code).
