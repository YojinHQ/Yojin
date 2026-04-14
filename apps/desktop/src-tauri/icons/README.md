# Tauri icons

Drop the bundle icons here before running `pnpm --filter @yojin/desktop build`. Required filenames (per `tauri.conf.json`):

- `32x32.png`
- `128x128.png`
- `128x128@2x.png`
- `icon.icns` (macOS)
- `icon.ico` (Windows)

Easiest path: keep a 1024×1024 master PNG of the Yojin glyph somewhere in the repo, then run

```bash
pnpm --filter @yojin/desktop tauri icon path/to/yojin-1024.png
```

— Tauri's CLI generates every required size + `.icns` / `.ico` in this directory.
