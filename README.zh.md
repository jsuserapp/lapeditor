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
  <a href="docs/download.zh.md">二进制下载说明</a>
</p>

## 下载

安装包发布在 [GitHub Releases](https://github.com/jsuserapp/lapeditor/releases)，和多数开源桌面软件一样，用发行页提供二进制文件。

- **[最新版本](https://github.com/jsuserapp/lapeditor/releases/latest)** — 推荐
- [全部版本](https://github.com/jsuserapp/lapeditor/releases)
- [该下哪个文件？](docs/download.zh.md)

Windows 10 / 11：下载 `.exe` NSIS 安装包。若某次发行包含 macOS / Linux 构建，也在同一页。

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

## 环境要求

| 工具 | 版本 |
| --- | --- |
| Node.js | 20 或更新 |
| pnpm | 11.8.0（见 `package.json` 的 `packageManager`） |
| Rust | stable（`rustup`） |
| Windows | WebView2（较新的 Windows 10/11 已自带），以及 [Visual Studio C++ 生成工具](https://visualstudio.microsoft.com/visual-cpp-build-tools/) |

Linux 还需要 WebKitGTK 开发包，见 [Tauri Linux 前置条件](https://v2.tauri.app/start/prerequisites/)。

## 调试（开发）

```bash
pnpm install
pnpm dev
```

`pnpm dev` 会启动 Vite 和 Tauri 窗口，并给 Tauri CLI 加上 `--no-watch`：

- **前端**（`src/`、`index.html`、`locale/`、`src/styles.css`）：Vite 热更新。
- **Rust**（`src-tauri/`）：不会自动重编。停掉进程后再执行一次 `pnpm dev`。

常用检查：

```bash
# TypeScript
npx tsc --noEmit

# Rust
cd src-tauri
cargo check
```

调试窗口里可以打开 WebView 开发者工具（右键 → 检查，Windows 上也可试 `Ctrl+Shift+I`）来调前端。

## 编译（发布）

```bash
pnpm install
pnpm tauri build
```

会先做前端类型检查和 Vite 构建，再打 release 二进制和安装包。

Windows 常见输出：

```
src-tauri/target/release/lapeditor.exe
src-tauri/target/release/bundle/nsis/          # 安装包 .exe
src-tauri/target/release/bundle/msi/           # 若生成了 MSI
```

不要把这些二进制提交进仓库。上传方式见 [docs/publish.zh.md](docs/publish.zh.md)。

简要步骤：先把 `main`（含 `.github/workflows/release.yml`）推上去，然后：

```bash
git tag v0.1.0
git push origin v0.1.0
```

GitHub Actions 会按平台构建并把安装包挂到 Release。也可以本机编译后手动上传（同一文档）。

## 便携目录

运行时文件放在可执行文件旁边（`pnpm dev` 时则在仓库根目录）：

```
Lapeditor.exe
config/
  settings.json      # 缩放、主题、语言、资源管理器
  window.json        # 位置 / 大小
  formatters.json    # 缩进和外部格式化命令
plugin/
  languages/         # TextMate 语言插件
data/
  session/           # 打开的标签
  webview/           # WebView2 缓存（Windows）
```

## 语言插件

见 [`plugin/languages/README.md`](plugin/languages/README.md)。

每种语言一个文件夹，内含 `language.json` 和 TextMate 语法。放到 `plugin/languages/` 后重启即可。自带示例：javascript、python、json、rust、markdown。

## 许可

Lapeditor 以 [MIT License](LICENSE) 发布。

项目使用了若干开源组件（Tauri、Monaco Editor、vscode-textmate 等），它们各自保留原许可。详见 [THIRD_PARTY.md](THIRD_PARTY.md)。
