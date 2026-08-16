<p align="center">
  <img src="src/assets/logo.png" width="256" alt="Lapeditor" />
</p>

<h1 align="center">Lapeditor</h1>

<p align="center">
  Lapeditor 是一个轻量文本编辑工具，提供基础的文本和代码编辑、阅读、查找功能。<br />
  目标是轻量快捷，不提供复杂的 IDE 功能。
</p>

<p align="center">
  <a href="README.md">English</a> · <a href="README.zh.md">中文</a>
  ·
  <a href="https://github.com/jsuserapp/lapeditor/releases/latest">下载</a>
  ·
  <a href="LICENSE">MIT License</a>
</p>

## 下载

安装包在 [GitHub Releases](https://github.com/jsuserapp/lapeditor/releases/latest)。

| 平台 | 文件 |
| --- | --- |
| Windows 10 / 11 (x64) | `Lapeditor_*_x64-setup.exe` |
| macOS | `.dmg` 或 `.app.tar.gz` |
| Linux | `.AppImage` 或 `.deb` |

## 功能

- 多标签编辑，关闭未保存会提示，并会恢复上次会话
- 当前文件查找 / 替换（`Ctrl+F` / `Ctrl+H`）
- 工作区搜索（`Ctrl+Shift+F`），支持匹配选项与可配置的排除规则
- 新建、打开、保存、另存为，支持拖放文件
- 资源管理器：新建 / 删除、文件夹监视，以及外部变更提示
- TextMate 语法高亮；自带预设：JavaScript、Python、JSON、Rust、Markdown
- 可在应用内从目录添加更多语言
- 格式化文档（`Shift+Alt+F`）：网页类语言用 Prettier，其它语言可接 `rustfmt` 等外部命令
- 自动换行、HEX 视图（含撤销 / 重做）、Markdown 分栏预览与阅读模式（KaTeX、Mermaid）
- 编码：ANSI、UTF-8、UTF-8 BOM、UTF-16 BE/LE
- 换行：CRLF / LF
- 浅色 / 深色主题，中英界面
- 页面缩放（`Ctrl+=` / `Ctrl+-` / `Ctrl+0`）
- 便携布局：配置和插件放在可执行文件旁边
- Windows 自定义标题栏（拖工具条移动窗口；最小化 / 最大化 / 关闭）

## 技术组件

| 层级 | 组件 |
| --- | --- |
| 应用壳 | [Tauri 2](https://tauri.app/)（Rust + 系统 WebView） |
| 编辑器 | [Monaco Editor](https://microsoft.github.io/monaco-editor/) |
| 语法高亮 | [vscode-textmate](https://github.com/microsoft/vscode-textmate) + [vscode-oniguruma](https://github.com/microsoft/vscode-oniguruma) |
| Markdown | [marked](https://marked.js.org/)、[KaTeX](https://katex.org/)、[Mermaid](https://mermaid.js.org/) |
| 格式化 | [Prettier](https://prettier.io/)（JS / TS / JSON / CSS / HTML / Markdown）；其它语言可接外部命令 |
| UI 图标 | [Lucide](https://lucide.dev/)（以及内置 PNG） |
| 文件监视 | [notify](https://github.com/notify-rs/notify) |
| 工作区搜索 | [ignore](https://github.com/BurntSushi/ripgrep/tree/master/crates/ignore) + [regex](https://github.com/rust-lang/regex) |
| 编码 | [encoding_rs](https://github.com/hsivonen/encoding_rs) |
| 前端工具链 | TypeScript、Vite、pnpm |

## 构建

需要 Node.js 20+、[pnpm](https://pnpm.io/) 11.8、Rust stable，以及对应系统的 [Tauri 前置条件](https://v2.tauri.app/start/prerequisites/)。

```bash
pnpm install
pnpm dev          # 开发
pnpm tauri build  # 发布安装包
```

## 语言插件

见 [`plugin/languages/README.md`](plugin/languages/README.md)。每种语言一个文件夹，内含 `language.json` 和 TextMate 语法。放到 `plugin/languages/` 后重启即可。

## 许可

[MIT](LICENSE)。第三方组件保留各自许可，见 [THIRD_PARTY.md](THIRD_PARTY.md)。
