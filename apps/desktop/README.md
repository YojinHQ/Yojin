# @yojin/desktop

Cross-platform tray app for Yojin. Wraps the existing Node backend (sidecar) and the React web app (webview) in a native shell so end users can download-and-run on macOS and Windows without touching a terminal.

## How it works

```
┌──────────────────────────────────────────────────────────┐
│  Tauri shell (Rust, ~15MB)                               │
│                                                          │
│  ┌────────────────────┐      ┌──────────────────────┐    │
│  │ Tray icon + menu   │      │ Webview window       │    │
│  │  · Open Yojin      │      │  loads               │    │
│  │  · Quit            │      │  http://127.0.0.1:N  │    │
│  └─────────┬──────────┘      └──────────▲───────────┘    │
│            │ spawn                       │               │
│            ▼                             │ HTTP/SSE      │
│  ┌──────────────────────────────────────┴───────────┐    │
│  │ Node sidecar  (`node dist/src/entry.js start`)   │    │
│  │  · GraphQL gateway on YOJIN_PORT=N (random free) │    │
│  │  · Serves apps/web/dist as the UI                │    │
│  └──────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────┘
```

- Random free port at startup → `YOJIN_PORT` env var → sidecar binds 127.0.0.1:N.
- Webview navigates to that URL once the gateway responds to a healthcheck.
- Tray quit → graceful SIGINT to sidecar (SIGBREAK on Windows, see `src/cli/shutdown-signals.ts`) → exit.

## Prerequisites (one-time per machine)

1. **Rust toolchain** (via rustup):
   ```bash
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   ```
2. **System dependencies** — see [Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/) for your OS.
3. **Tauri CLI** is pulled via the workspace's pnpm install — no global install needed.

## Develop

```bash
# from monorepo root
pnpm --filter @yojin/desktop dev
```

This launches `tauri dev`, which:

1. Starts the Rust shell.
2. Shell spawns the Node backend with a random `YOJIN_PORT`.
3. Tray icon appears in the menu bar.
4. Click *Open Yojin* → window opens at `http://127.0.0.1:<port>`.

## Bundled Node runtime

End users don't need Node installed — `pnpm --filter @yojin/desktop build` runs `scripts/bundle-node.mjs` as a `prebuild` step, which downloads the official Node 22.12.0 distribution for the host platform and drops the `node` binary at `src-tauri/sidecar/node` (`node.exe` on Windows). Tauri then ships that file as a bundle resource.

At runtime, `src-tauri/src/sidecar.rs` resolves the Node command in this order:

1. `YOJIN_DESKTOP_NODE` env var (manual override — full path to a `node` binary).
2. Bundled binary in the Tauri resource dir (`sidecar/node[.exe]`) — production path.
3. `node` on `PATH` (dev fallback when no binary has been bundled yet).

Cross-target downloads (CI matrix, releases) — these write platform-suffixed copies (`node-darwin-arm64`, `node-win-x64.exe`, …):

```bash
pnpm --filter @yojin/desktop bundle:node:all          # all supported targets
pnpm --filter @yojin/desktop tauri -- bundle:node --target=darwin-arm64
```

`src-tauri/sidecar/` is gitignored — the binary is downloaded fresh per build.

## Build (per-platform installers)

```bash
# macOS .dmg
pnpm --filter @yojin/desktop build

# Windows .msi (run on a Windows host or via cross-build)
pnpm --filter @yojin/desktop build
```

> **Code signing is not yet wired.** Until Apple Developer ID + Windows OV/EV certs are configured, builds will trigger Gatekeeper / SmartScreen warnings. See the parent `feat/desktop-tray-app` PR for the signing rollout plan.

## Open items

- [ ] Bundle the Node app itself (compiled `dist/` + `node_modules/`) as a resource so the installer is self-contained — `sidecar.rs` already looks for `sidecar/dist/src/entry.js` in the resource dir
- [ ] Lazy-download Playwright browsers on first scrape (keeps installer small per `Workstream B / decision 2`)
- [ ] Codesigning certs (Apple Developer ID + Windows OV)
- [ ] Auto-update channel (Tauri updater plugin)
- [ ] Coexistence story with the legacy `Yojin.app` shipped via `scripts/postinstall-desktop.mjs`
