use std::net::TcpListener;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};

use tauri::AppHandle;

/// Handle to the spawned Node backend. Dropping this struct does **not** kill
/// the child — call [`SidecarHandle::shutdown`] explicitly from a quit path.
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

/// Spawn the Node backend with `YOJIN_PORT` set to a random free port.
///
/// Resolution order for the entry script:
///   1. `YOJIN_DESKTOP_ENTRY` env var (manual override).
///   2. Tauri resource dir (production builds bundle the script there).
///   3. Walk up from `current_exe` to the monorepo root, then `dist/src/entry.js` (dev mode).
pub fn spawn(app: &AppHandle) -> Result<SidecarHandle, std::io::Error> {
    let port = pick_free_port()?;
    let entry = resolve_entry_script(app)?;

    let mut command = Command::new(node_command());
    command
        .arg(&entry)
        .arg("start")
        .env("YOJIN_PORT", port.to_string())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .stdin(Stdio::null());

    log::info!("Spawning Yojin backend: node {} start (YOJIN_PORT={port})", entry.display());
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

fn node_command() -> String {
    // For dev builds we expect `node` on PATH.
    // For prod builds we'll later switch to a bundled Node binary in
    // resources/sidecar/. Tracked in `apps/desktop/README.md` open items.
    std::env::var("YOJIN_DESKTOP_NODE").unwrap_or_else(|_| "node".to_string())
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
