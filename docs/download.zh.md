# 下载 Lapeditor

[English](download.md) · [中文](download.zh.md)

二进制安装包挂在 **GitHub Releases** 上，那个页面就是下载页。

**[下载最新版本](https://github.com/jsuserapp/lapeditor/releases/latest)**

[查看全部版本](https://github.com/jsuserapp/lapeditor/releases)

## 该下哪个文件？

| 平台 | 下载文件 |
| --- | --- |
| Windows 10 / 11 (x64) | `Lapeditor_x.y.z_x64-setup.exe`（NSIS 安装包） |
| Windows（可选） | 发行页上若有 `.msi` 也可 |
| macOS | 若该版本包含 macOS，则为 `.dmg` 或 `.app.tar.gz` |
| Linux | 若该版本包含 Linux，则为 `.AppImage` 或 `.deb` |

没有特殊需要时，请用 **Latest** 最新版。

安装后仍是便携布局：`config/`、`plugin/`、`data/` 会出现在程序旁边（或首次启动时的工作目录）。

## 校验

在发行页对照资源文件大小。若改为从源码构建，见 [README.zh.md](../README.zh.md#编译发布)。

## 自己编译

```bash
pnpm install
pnpm tauri build
```

安装包在 `src-tauri/target/release/bundle/`。

如何把这些文件挂到 GitHub Releases，见 [publish.zh.md](publish.zh.md)。
