mod sidecar;

use std::sync::Mutex;
use std::time::Duration;

use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
use tokio::time::sleep;

use sidecar::SidecarHandle;

const HEALTH_POLL_INTERVAL: Duration = Duration::from_millis(250);
const HEALTH_POLL_TIMEOUT: Duration = Duration::from_secs(60);
const WEBVIEW_LABEL: &str = "main";

pub struct AppState {
    pub sidecar: Mutex<Option<SidecarHandle>>,
    pub gateway_url: Mutex<Option<String>>,
}

pub fn run() {
    env_logger::init();

    tauri::Builder::default()
        .manage(AppState {
            sidecar: Mutex::new(None),
            gateway_url: Mutex::new(None),
        })
        .setup(|app| {
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                if let Err(err) = launch_sidecar(app_handle.clone()).await {
                    log::error!("Failed to launch Yojin backend: {err}");
                }
            });

            install_signal_handlers(app.handle().clone());
            build_tray(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            // Hide the window on close instead of quitting — the tray keeps running.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == WEBVIEW_LABEL {
                    let _ = window.hide();
                    api.prevent_close();
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building Yojin desktop")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { .. } = event {
                shutdown_sidecar(app);
            }
        });
}

fn build_tray(app: &mut tauri::App) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open Yojin", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &quit])?;

    TrayIconBuilder::with_id("yojin-tray")
        .icon(app.default_window_icon().cloned().expect("default icon"))
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => {
                let handle = app.clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(err) = open_main_window(handle).await {
                        log::error!("Failed to open Yojin window: {err}");
                    }
                });
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .build(app)?;

    Ok(())
}

async fn launch_sidecar(app: AppHandle) -> Result<(), String> {
    let handle = sidecar::spawn(&app).map_err(|e| e.to_string())?;
    let gateway_url = format!("http://127.0.0.1:{}", handle.port);

    {
        let state = app.state::<AppState>();
        *state.sidecar.lock().expect("sidecar mutex") = Some(handle);
        *state.gateway_url.lock().expect("url mutex") = Some(gateway_url.clone());
    }

    wait_for_gateway(&gateway_url).await
}

async fn wait_for_gateway(base_url: &str) -> Result<(), String> {
    let deadline = std::time::Instant::now() + HEALTH_POLL_TIMEOUT;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
        .map_err(|e| e.to_string())?;

    while std::time::Instant::now() < deadline {
        match client.get(base_url).send().await {
            Ok(resp) if resp.status().is_success() || resp.status().is_redirection() => {
                log::info!("Gateway responding at {base_url}");
                return Ok(());
            }
            _ => sleep(HEALTH_POLL_INTERVAL).await,
        }
    }
    Err(format!("Gateway at {base_url} did not become ready within {HEALTH_POLL_TIMEOUT:?}"))
}

async fn open_main_window(app: AppHandle) -> Result<(), String> {
    let state = app.state::<AppState>();
    let url = state.gateway_url.lock().expect("url mutex").clone();

    let url = url.ok_or_else(|| "Backend has not started yet".to_string())?;

    if let Some(window) = app.get_webview_window(WEBVIEW_LABEL) {
        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }

    let parsed = tauri::Url::parse(&url).map_err(|e| e.to_string())?;
    WebviewWindowBuilder::new(&app, WEBVIEW_LABEL, WebviewUrl::External(parsed))
        .title("Yojin")
        .inner_size(1280.0, 800.0)
        .min_inner_size(960.0, 600.0)
        .build()
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// Install SIGINT/SIGTERM handlers (Ctrl-C on Windows) that route termination
/// through `app.exit(0)` so the normal `RunEvent::ExitRequested` → `shutdown_sidecar`
/// path runs. Without this, a targeted signal to the desktop process would
/// terminate the Rust runtime without unwinding — Drop impls don't fire on
/// signals — and the Node sidecar would orphan.
fn install_signal_handlers(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        #[cfg(unix)]
        {
            use tokio::signal::unix::{signal, SignalKind};
            let mut sigint = match signal(SignalKind::interrupt()) {
                Ok(s) => s,
                Err(err) => {
                    log::error!("Failed to install SIGINT handler: {err}");
                    return;
                }
            };
            let mut sigterm = match signal(SignalKind::terminate()) {
                Ok(s) => s,
                Err(err) => {
                    log::error!("Failed to install SIGTERM handler: {err}");
                    return;
                }
            };
            tokio::select! {
                _ = sigint.recv() => log::info!("Received SIGINT — shutting down"),
                _ = sigterm.recv() => log::info!("Received SIGTERM — shutting down"),
            }
        }
        #[cfg(not(unix))]
        {
            if let Err(err) = tokio::signal::ctrl_c().await {
                log::error!("Failed to install Ctrl-C handler: {err}");
                return;
            }
            log::info!("Received Ctrl-C — shutting down");
        }
        app.exit(0);
    });
}

fn shutdown_sidecar(app: &AppHandle) {
    let state = app.state::<AppState>();
    let mut guard = state.sidecar.lock().expect("sidecar mutex");
    if let Some(mut handle) = guard.take() {
        handle.shutdown();
    }
}
