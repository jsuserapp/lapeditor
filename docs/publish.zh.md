# 把二进制上传到 GitHub

[English](publish.md) · [中文](publish.zh.md)

安装包放在 **GitHub Releases**，不要提交进 git 仓库。不要把 `.exe` / `.msi` /
`.dmg` / `.AppImage` 加进版本库。

## 自动发布（推荐）

推送版本标签时，`.github/workflows/release.yml` 会在 Windows、Linux、macOS
上构建，并把安装包挂到 Release。

1. 先把工作流和 `main` 上的代码推上去。标签只会用默认分支上已有的工作流。
2. `package.json` 和 `src-tauri/tauri.conf.json` 里的版本号要和标签一致
   （例如 `0.1.0` 对应标签 `v0.1.0`）。
3. 打标签并推送：

```bash
git tag v0.1.0
git push origin v0.1.0
```

4. 打开 [Actions](https://github.com/jsuserapp/lapeditor/actions)，等
   **Release** 跑完。完成后文件会出现在
   [Releases](https://github.com/jsuserapp/lapeditor/releases)。

若要重发同一版本：先删掉 GitHub 上的 Release 和对应标签，再重新推送标签。

## 手动上传（本机编译）

只有 Windows 机器、或还要额外挂文件时，用这种方式。

1. 编译：

```bash
pnpm install
pnpm tauri build
```

2. 从 `src-tauri/target/release/bundle/` 取出安装包（NSIS 的 `.exe`，若有
   `.msi` 也可；便携版可再带上 `src-tauri/target/release/lapeditor.exe`）。
3. 打开 GitHub：**Releases → Draft a new release**。
   - Tag：`v0.1.0`（没有就在 `main` 上新建）
   - Title：`Lapeditor v0.1.0`
   - 把安装包拖进资源区
   - Publish release

或用 [GitHub CLI](https://cli.github.com/)：

```bash
gh release create v0.1.0 `
  --title "Lapeditor v0.1.0" `
  --notes "本版本的 Windows 安装包与说明。" `
  src-tauri/target/release/bundle/nsis/Lapeditor_0.1.0_x64-setup.exe
```

文件名以 `pnpm tauri build` 实际生成的为准。

## 发布之后

最新下载地址：

https://github.com/jsuserapp/lapeditor/releases/latest

用户该下哪个文件，见 [download.zh.md](download.zh.md)。
