use std::net::TcpListener;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};

use tauri::{AppHandle, Manager};

/// Handle to the spawned Node backend. The normal shutdown path is
/// [`SidecarHandle::shutdown`] via `RunEvent::ExitRequested`, which fires on tray
/// Quit and on SIGINT/SIGTERM routed through `install_signal_handlers` in
/// `lib.rs`. The `Drop` impl is a last-resort safety net for panic unwinding —
/// it does not fire on signals, which terminate the runtime without unwinding.
pub struct SidecarHandle {
    pub port: u16,
    child: Option<Child>,
}

impl SidecarHandle {
    pub fn shutdown(&mut self) {
        let Some(mut child) = self.child.take() else {
            return;
        };
        // Try graceful first — the gateway listens for SIGINT/SIGTERM (POSIX)
        // and SIGINT/SIGBREAK (Windows, see src/cli/shutdown-signals.ts).
        // On unix we shell out to `kill -TERM` to avoid pulling in `libc`.
        // On Windows, child.kill() is the only portable option from std.
        #[cfg(unix)]
        {
            let _ = Command::new("kill")
                .arg("-TERM")
                .arg(child.id().to_string())
                .status();
        }
        #[cfg(not(unix))]
        {
            let _ = child.kill();
        }
        let _ = child.wait();
    }
}

impl Drop for SidecarHandle {
    fn drop(&mut self) {
        self.shutdown();
    }
}

/// Spawn the Node backend with `YOJIN_PORT` set to a random free port.
///
/// Resolution order for the entry script:
///   1. `YOJIN_DESKTOP_ENTRY` env var (manual override).
///   2. Tauri resource dir (production builds bundle the script there).
///   3. Walk up from `current_exe` to the monorepo root, then `dist/src/entry.js` (dev mode).
pub fn spawn(app: &AppHandle) -> Result<SidecarHandle, std::io::Error> {
    let port = pick_free_port()?;
    let entry = resolve_entry_script(app)?;
    let node = node_command(app);

    let mut command = Command::new(&node);
    command
        .arg(&entry)
        .arg("start")
        .env("YOJIN_PORT", port.to_string())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .stdin(Stdio::null());

    log::info!(
        "Spawning Yojin backend: {} {} start (YOJIN_PORT={port})",
        node.display(),
        entry.display()
    );
    let child = command.spawn()?;

    Ok(SidecarHandle {
        port,
        child: Some(child),
    })
}

fn pick_free_port() -> std::io::Result<u16> {
    let listener = TcpListener::bind("127.0.0.1:0")?;
    let port = listener.local_addr()?.port();
    drop(listener);
    Ok(port)
}

/// Resolution order for the Node runtime that hosts the backend:
///   1. `YOJIN_DESKTOP_NODE` env var (manual override, takes a full path).
///   2. Bundled binary in the Tauri resource dir (`sidecar/node[.exe]`) — this
///      is what end users get from the installer so they don't need Node on
///      PATH.
///   3. `node` on PATH (dev fallback).
fn node_command(app: &AppHandle) -> PathBuf {
    if let Ok(override_path) = std::env::var("YOJIN_DESKTOP_NODE") {
        return PathBuf::from(override_path);
    }

    if let Ok(resource_dir) = app.path().resource_dir() {
        let bundled = resource_dir.join("sidecar").join(bundled_node_filename());
        if bundled.exists() {
            return bundled;
        }
    }

    PathBuf::from("node")
}

fn bundled_node_filename() -> &'static str {
    if cfg!(windows) { "node.exe" } else { "node" }
}

fn resolve_entry_script(app: &AppHandle) -> std::io::Result<PathBuf> {
    if let Ok(override_path) = std::env::var("YOJIN_DESKTOP_ENTRY") {
        return Ok(PathBuf::from(override_path));
    }

    if let Ok(resource_dir) = app.path().resource_dir() {
        let candidate = resource_dir.join("sidecar").join("dist").join("src").join("entry.js");
        if candidate.exists() {
            return Ok(candidate);
        }
    }

    // Dev fallback: walk up from the desktop crate's manifest dir to find the
    // monorepo root (the directory containing pnpm-workspace.yaml).
    let mut cursor = std::env::current_dir()?;
    loop {
        if cursor.join("pnpm-workspace.yaml").exists() {
            let candidate = cursor.join("dist").join("src").join("entry.js");
            if candidate.exists() {
                return Ok(candidate);
            }
            return Err(std::io::Error::new(
                std::io::ErrorKind::NotFound,
                format!("Found monorepo root at {} but {} is missing — run `pnpm build` first", cursor.display(), candidate.display()),
            ));
        }
        if !cursor.pop() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::NotFound,
                "Could not locate Yojin entry.js — set YOJIN_DESKTOP_ENTRY",
            ));
        }
    }
}
