# Publish binaries to GitHub

[English](publish.md) · [中文](publish.zh.md)

Installers belong on **GitHub Releases**, not in the git tree. Do not commit
`.exe` / `.msi` / `.dmg` / `.AppImage` files.

## Automatic (recommended)

`.github/workflows/release.yml` builds Windows, Linux, and macOS when you push
a version tag, then attaches the installers to a Release.

1. Commit and push the workflow (and the rest of `main`) first. A tag only
   uses the workflow that already exists on the default branch.
2. Make sure `package.json` and `src-tauri/tauri.conf.json` versions match
   the tag (for example `0.1.0` → tag `v0.1.0`).
3. Create and push the tag:

```bash
git tag v0.1.0
git push origin v0.1.0
```

4. Open [Actions](https://github.com/jsuserapp/lapeditor/actions) and wait for
   the **Release** workflow. When it finishes, files appear on
   [Releases](https://github.com/jsuserapp/lapeditor/releases).

To redo a version, delete the GitHub Release and the tag, then push the tag
again.

## Manual (local build)

Use this if you only have a Windows machine, or you want to attach extra files.

1. Build:

```bash
pnpm install
pnpm tauri build
```

2. Collect files from `src-tauri/target/release/bundle/` (NSIS `.exe`, optional
   `.msi`, and `src-tauri/target/release/lapeditor.exe` if you want a portable
   binary).
3. On GitHub: **Releases → Draft a new release**.
   - Tag: `v0.1.0` (create the tag on `main` if it does not exist)
   - Title: `Lapeditor v0.1.0`
   - Drop the installer files into the assets area
   - Publish release

Or with [GitHub CLI](https://cli.github.com/):

```bash
gh release create v0.1.0 `
  --title "Lapeditor v0.1.0" `
  --notes "Windows installer and notes for this version." `
  src-tauri/target/release/bundle/nsis/Lapeditor_0.1.0_x64-setup.exe
```

Adjust the filename to whatever `pnpm tauri build` actually produced.

## After publish

The latest files are at:

https://github.com/jsuserapp/lapeditor/releases/latest

See [download.md](download.md) for which asset end users should pick.
