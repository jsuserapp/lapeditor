<p align="center">
  <img src="src/assets/logo.png" width="256" alt="Lapeditor" />
</p>

<h1 align="center">Lapeditor</h1>

<p align="center">
  轻量记事本风格编辑器，技术栈为 <strong>Tauri 2 + Monaco + TextMate</strong>。<br />
  语言支持来自文件夹插件，而不是写死在程序里的语言包。
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
- 查找 / 替换（`Ctrl+F` / `Ctrl+H`）
- 新建、打开、保存、另存为，支持拖放文件
- 资源管理器，监视文件夹中的创建、删除、重命名
- 用 TextMate 语法做高亮，语言以插件目录形式加载
- 自带预设：JavaScript、Python、JSON、Rust、Markdown
- 可在应用内从目录添加更多语言
- 格式化文档（`Shift+Alt+F`）：网页类语言用 Prettier，其它语言可接 `rustfmt` 等外部命令
- 自动换行、HEX 视图、Markdown 预览（含 KaTeX、Mermaid）
- 编码：ANSI、UTF-8、UTF-8 BOM、UTF-16 BE/LE
- 换行：CRLF / LF
- 浅色 / 深色主题，中英界面
- 页面缩放（`Ctrl+=` / `Ctrl+-` / `Ctrl+0`）
- 便携布局：配置和插件放在可执行文件旁边
- Windows 自定义标题栏（拖工具条移动窗口；最小化 / 最大化 / 关闭）

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
