# Download Lapeditor

[English](download.md) · [中文](download.zh.md)

Binary builds are attached to **GitHub Releases**. That page is the download site.

**[Get the latest release](https://github.com/jsuserapp/lapeditor/releases/latest)**

[Browse all releases](https://github.com/jsuserapp/lapeditor/releases)

## Which file?

| Platform | File to download |
| --- | --- |
| Windows 10 / 11 (x64) | `Lapeditor_x.y.z_x64-setup.exe` (NSIS installer) |
| Windows (optional) | `.msi` if listed on the release |
| macOS | `.dmg` or `.app.tar.gz` when the release includes macOS |
| Linux | `.AppImage` or `.deb` when the release includes Linux |

Prefer the **Latest** release unless you need an older version.

After install, Lapeditor stays portable: `config/`, `plugin/`, and `data/` are created next to the app (or in the working directory used at first launch).

## Verify

On the release page, compare the file size with the listed asset. If you build from source instead, see [README.md](../README.md#compile-release).

## Build it yourself

```bash
pnpm install
pnpm tauri build
```

Installers land under `src-tauri/target/release/bundle/`.

To attach those files to GitHub Releases, see [publish.md](publish.md).
