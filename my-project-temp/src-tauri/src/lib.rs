// Apical — Tauri library (lib.rs).
//
// Houses the actual Tauri app builder + IPC command handlers. Separated from
// main.rs so the library can be reused (e.g. for tests).
//
// IPC COMMANDS:
//   - keychain_get(handle) -> Option<String>
//   - keychain_set(handle, value) -> ()
//   - keychain_delete(handle) -> ()
//   - start_loopback_listener(port) -> { port, redirect_uri }
//     (Rust owns the socket; the Next.js side tells us when to start it + how
//     to resolve the callback.)
//   - stop_loopback_listener(port) -> ()
//   - open_url(url) -> ()
//     (Opens the OAuth authorize URL in the OS default browser.)
//   - spawn_mcp_stdio(command, args, env) -> { pid }
//     (Spawns a local stdio MCP server with vault-injected env vars.)
//
// The Next.js runtime calls these via `@tauri-apps/api` (when running inside
// the Tauri webview) or via the desktop-bridge socket (when running hosted
// but the user has a connected desktop).

use keyring::Entry;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::menu::{
    CheckMenuItemBuilder, MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder,
};
use tauri::tray::TrayIconBuilder;
use tauri::{Emitter, Manager};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;

/// Monotonic counter for unique secondary-window labels (multi-window).
static WINDOW_COUNTER: AtomicU32 = AtomicU32::new(1);

/// App-wide flags. `is_quitting` distinguishes a real quit (menu/tray Quit)
/// from a window close, so the CloseRequested handler can hide-to-tray on a
/// plain close but still allow an explicit quit to exit the process.
struct AppFlags {
    is_quitting: AtomicBool,
}

/// Last-known tray status reported by the frontend (link state, schedule
/// count, pause toggle). Kept so `update_tray_status` can rebuild the menu.
#[derive(Clone, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct TrayJob {
    id: String,
    name: String,
    status: String,
    next_run_label: String,
}

#[derive(Clone, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct TrayStatus {
    #[serde(default)]
    linked: bool,
    #[serde(default)]
    desktop_online: bool,
    #[serde(default)]
    scheduled_count: u32,
    #[serde(default)]
    automations_paused: bool,
    #[serde(default)]
    local_only: bool,
    #[serde(default)]
    jobs: Vec<TrayJob>,
}

struct TrayState(Mutex<TrayStatus>);

// ─── Keychain (F2 vault in local mode) ──────────────────────────────────────

const KEYCHAIN_SERVICE: &str = "dev.apical.desktop";

/// Get a secret from the OS keychain by handle.
/// Returns null if not found (JS-side null, not Rust Option<T>).
#[tauri::command]
async fn keychain_get(handle: String) -> Result<Option<String>, String> {
    let entry = Entry::new(KEYCHAIN_SERVICE, &handle)
        .map_err(|e| format!("keychain entry create failed: {}", e))?;
    match entry.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("keychain get failed: {}", e)),
    }
}

/// Set a secret in the OS keychain.
#[tauri::command]
async fn keychain_set(handle: String, value: String) -> Result<(), String> {
    let entry = Entry::new(KEYCHAIN_SERVICE, &handle)
        .map_err(|e| format!("keychain entry create failed: {}", e))?;
    entry
        .set_password(&value)
        .map_err(|e| format!("keychain set failed: {}", e))
}

/// Delete a secret from the OS keychain. No-op if not found.
#[tauri::command]
async fn keychain_delete(handle: String) -> Result<(), String> {
    let entry = Entry::new(KEYCHAIN_SERVICE, &handle)
        .map_err(|e| format!("keychain entry create failed: {}", e))?;
    match entry.delete_credential() {
        Ok(_) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("keychain delete failed: {}", e)),
    }
}

// ─── Loopback redirect listener (F1 OAuth engine) ───────────────────────────

/// A registry of active loopback listeners (port → shutdown channel).
/// We keep this in app state so we can stop a listener when the OAuth flow
/// completes or times out.
struct LoopbackListeners(Mutex<HashMap<u16, tokio::sync::oneshot::Sender<()>>>);

/// Start a loopback HTTP listener on 127.0.0.1:<port>.
/// Returns the actual bound port (useful when port=0 → ephemeral) + the
/// redirect URI to use in the authorize request.
///
/// CRITICAL: pinned to 127.0.0.1 (the IP literal), NOT the string "localhost".
/// OAuth providers treat 127.0.0.1 and localhost as different redirect URIs;
/// a mismatch silently breaks token exchange.
#[tauri::command]
async fn start_loopback_listener(
    port: u16,
    state: tauri::State<'_, LoopbackListeners>,
    app: tauri::AppHandle,
) -> Result<LoopbackStartResult, String> {
    let addr = std::net::SocketAddr::from(([127, 0, 0, 1], port));
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .map_err(|e| format!("bind 127.0.0.1:{} failed: {}", port, e))?;
    let bound_port = listener
        .local_addr()
        .map_err(|e| format!("local_addr failed: {}", e))?
        .port();

    let (shutdown_tx, mut shutdown_rx) = tokio::sync::oneshot::channel::<()>();

    // Stash the shutdown sender so stop_loopback_listener can use it.
    {
        let mut map = state.0.lock().map_err(|e| format!("lock failed: {}", e))?;
        map.insert(bound_port, shutdown_tx);
    }

    let app_handle = app.clone();
    tokio::spawn(async move {
        loop {
            tokio::select! {
                _ = &mut shutdown_rx => {
                    // Shutdown signal received.
                    break;
                }
                accept = listener.accept() => {
                    let (mut stream, _) = match accept {
                        Ok(s) => s,
                        Err(_) => continue,
                    };
                    // Read the request (best-effort, small buffer).
                    use tokio::io::AsyncReadExt;
                    let mut buf = [0u8; 4096];
                    let _ = stream.read(&mut buf).await;
                    // Parse the request line + query string.
                    let request_line = std::str::from_utf8(&buf)
                        .ok()
                        .and_then(|s| s.lines().next())
                        .unwrap_or("");
                    // Emit the callback to the JS side (the Next.js runtime
                    // resolves the OAuth state + exchanges the code).
                    let _ = app_handle.emit("oauth-callback", request_line);
                    // Send a friendly response + close.
                    let body = "<html><body><h2>Authorization complete</h2><p>You can close this tab and return to Apical.</p></body></html>";
                    let response = format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                        body.len(),
                        body
                    );
                    use tokio::io::AsyncWriteExt;
                    let _ = stream.write_all(response.as_bytes()).await;
                    let _ = stream.shutdown().await;
                    // One-shot: shut down after the first callback.
                    break;
                }
            }
        }
    });

    Ok(LoopbackStartResult {
        port: bound_port,
        redirect_uri: format!("http://127.0.0.1:{}/callback", bound_port),
    })
}

#[derive(serde::Serialize)]
struct LoopbackStartResult {
    port: u16,
    redirect_uri: String,
}

/// Stop a loopback listener by port.
#[tauri::command]
async fn stop_loopback_listener(
    port: u16,
    state: tauri::State<'_, LoopbackListeners>,
) -> Result<(), String> {
    let tx = {
        let mut map = state.0.lock().map_err(|e| format!("lock failed: {}", e))?;
        map.remove(&port)
    };
    if let Some(tx) = tx {
        let _ = tx.send(());
    }
    Ok(())
}

// ─── Open URL in OS default browser ─────────────────────────────────────────

/// Open a URL in the OS default browser. Used by the OAuth flow to send the
/// user to the provider's authorize endpoint.
#[tauri::command]
async fn open_url(url: String, app: tauri::AppHandle) -> Result<(), String> {
    app.shell()
        .open(url, None)
        .map_err(|e| format!("open_url failed: {}", e))
}

// ─── Spawn local stdio MCP server (A1 local-first path) ────────────────────

/// Spawn a local stdio MCP server. The vault/keychain secret is injected as
/// an env var at spawn time (per A1: local stdio MCP servers fit local-first
/// directly). Returns the PID.
#[tauri::command]
async fn spawn_mcp_stdio(
    command: String,
    args: Vec<String>,
    env: HashMap<String, String>,
    app: tauri::AppHandle,
) -> Result<u32, String> {
    // tauri-plugin-shell's sidecar API requires the command to be pre-scoped
    // in tauri.conf.json. For arbitrary stdio MCP servers (the user installs
    // them on demand), we use std::process::Command directly.
    let mut cmd = std::process::Command::new(&command);
    cmd.args(&args);
    for (k, v) in env.iter() {
        cmd.env(k, v);
    }
    cmd.stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    let child = cmd
        .spawn()
        .map_err(|e| format!("spawn {} failed: {}", command, e))?;
    let pid = child.id();
    // Reap the child in a detached task so it doesn't zombie. The Next.js
    // runtime communicates with the MCP server via stdin/stdout — we don't
    // own that pipe here (it's the runtime's job).
    drop(child);
    let _ = app; // silence unused warning
    Ok(pid)
}

// ─── Bundled Next.js standalone server (production desktop) ─────────────────

const DESKTOP_UI_URL: &str = "http://127.0.0.1:3000/api/auth/desktop-ui";

/// Keeps the bundled Node server process alive for the app lifetime.
struct BundledServer(Mutex<Option<tauri_plugin_shell::process::CommandChild>>);

fn append_startup_log(app: &tauri::AppHandle, line: &str) {
    let log_dir = app
        .path()
        .app_log_dir()
        .or_else(|_| app.path().app_data_dir())
        .ok();
    if let Some(dir) = log_dir {
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join("startup.log");
        use std::io::Write;
        if let Ok(mut f) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
        {
            let _ = writeln!(f, "{line}");
        }
    }
    log::info!("{line}");
}

fn server_responds_ok() -> bool {
    use std::io::{Read, Write};
    let addr = "127.0.0.1:3000".parse().unwrap();
    let mut stream = match std::net::TcpStream::connect_timeout(&addr, Duration::from_secs(1)) {
        Ok(s) => s,
        Err(_) => return false,
    };
    let _ = stream.set_read_timeout(Some(Duration::from_secs(3)));
    let req = format!(
        "GET /api/auth/desktop-ui HTTP/1.1\r\nHost: 127.0.0.1:3000\r\nConnection: close\r\n\r\n"
    );
    if stream.write_all(req.as_bytes()).is_err() {
        return false;
    }
    let mut buf = [0u8; 1024];
    let n = stream.read(&mut buf).unwrap_or(0);
    let text = std::str::from_utf8(&buf[..n]).unwrap_or("");
    text.contains("HTTP/1.") && (text.contains(" 200 ") || text.contains(" 302 "))
}

/// Navigate the main window to the local desktop UI. When `show` is false
/// (launched with `--hidden` at login), the window stays hidden and — on
/// macOS — the app runs as a menu-bar accessory (no Dock icon) until the user
/// opens it from the tray.
fn navigate_main_to_desktop_ui(app: &tauri::AppHandle, show: bool) -> Result<(), String> {
    let url = DESKTOP_UI_URL
        .parse()
        .map_err(|e| format!("parse desktop UI url: {e}"))?;
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window missing".to_string())?;
    window
        .navigate(url)
        .map_err(|e| format!("navigate main window: {e}"))?;
    if show {
        let _ = window.show();
        let _ = window.set_focus();
    } else {
        #[cfg(target_os = "macos")]
        {
            let _ = app.set_activation_policy(tauri::ActivationPolicy::Accessory);
        }
    }
    Ok(())
}

/// True when the app was launched with `--hidden` (autostart-at-login), i.e.
/// it should start straight to the tray without showing a window.
fn launched_hidden() -> bool {
    std::env::args().any(|a| a == "--hidden")
}

fn show_startup_error(app: &tauri::AppHandle, message: &str) {
    append_startup_log(app, &format!("startup error: {message}"));
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.set_focus();
    }
    use tauri_plugin_dialog::DialogExt;
    let _ = app
        .dialog()
        .message(message)
        .title("Apical failed to start")
        .blocking_show();
}

fn bundled_standalone_dir(resource_dir: &std::path::Path) -> std::path::PathBuf {
    let nested = resource_dir.join("bundle-resources/standalone");
    if nested.join("server.js").exists() {
        return nested;
    }
    resource_dir.join("standalone")
}

/// Spawn the bundled Node sidecar + standalone server and wait until it listens.
#[cfg(not(debug_assertions))]
fn start_bundled_server(app: &tauri::AppHandle) -> Result<(), String> {
    append_startup_log(app, "starting bundled Next.js server");

    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("resource_dir: {e}"))?;
    let standalone_dir = bundled_standalone_dir(&resource_dir);
    if !standalone_dir.join("server.js").exists() {
        return Err(format!(
            "missing bundled server at {}",
            standalone_dir.join("server.js").display()
        ));
    }

    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?;
    std::fs::create_dir_all(&data_dir)
        .map_err(|e| format!("create app_data_dir: {e}"))?;
    let db_path = data_dir.join("custom.db");

    let sidecar = app
        .shell()
        .sidecar("node")
        .map_err(|e| format!("sidecar node: {e}"))?;

    let (mut rx, child) = sidecar
        .args(["server.js"])
        .current_dir(&standalone_dir)
        .env("DESKTOP_LOCAL", "true")
        .env("NODE_ENV", "production")
        .env("PORT", "3000")
        .env("HOSTNAME", "127.0.0.1")
        .env(
            "DATABASE_URL",
            format!("file:{}", db_path.to_string_lossy()),
        )
        // The bundled server reads desktop-settings.json (remote-access policy,
        // cloud-link.json for the bridge) from here. See
        // src/lib/desktop/desktop-paths.ts.
        .env("APICAL_DESKTOP_DATA_DIR", data_dir.to_string_lossy().to_string())
        .env("NEXTAUTH_SECRET", "desktop-local-secret")
        .env("NEXTAUTH_URL", "http://127.0.0.1:3000")
        .spawn()
        .map_err(|e| format!("spawn node sidecar: {e}"))?;

    let log_app = app.clone();
    std::thread::spawn(move || {
        while let Some(event) = rx.blocking_recv() {
            match event {
                CommandEvent::Stdout(line) | CommandEvent::Stderr(line) => {
                    let text = String::from_utf8_lossy(&line);
                    append_startup_log(&log_app, &format!("node: {text}"));
                }
                CommandEvent::Error(err) => {
                    append_startup_log(&log_app, &format!("node error: {err}"));
                }
                CommandEvent::Terminated(payload) => {
                    append_startup_log(
                        &log_app,
                        &format!("node terminated: code={:?} signal={:?}", payload.code, payload.signal),
                    );
                }
                _ => {}
            }
        }
    });

    app.manage(BundledServer(Mutex::new(Some(child))));

    for attempt in 0..90 {
        if server_responds_ok() {
            append_startup_log(app, &format!("bundled Next.js server ready (attempt {})", attempt + 1));
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(500));
    }

    Err("timed out waiting for bundled Next.js server on :3000".into())
}

// ─── Multi-window ───────────────────────────────────────────────────────────

/// Open a new Apical window. Each window loads the same frontend; the label is
/// unique so multiple can coexist. `path` is an app-relative route (defaults to
/// "/desktop"); pop-outs pass e.g. "/desktop#popout=<conversationId>". Must run on the main
/// thread (window creation is not thread-safe on all platforms), so this is
/// exposed as a *synchronous* command and is also called directly from
/// main-thread menu handlers.
fn open_app_window(app: &tauri::AppHandle, path: Option<&str>) -> Result<(), String> {
    // Only allow app-relative routes — never an absolute/external URL.
    let route = match path {
        Some(p) if p.starts_with('/') => p,
        _ => "/desktop",
    };
    let n = WINDOW_COUNTER.fetch_add(1, Ordering::SeqCst);
    let label = format!("apical-{}", n);
    tauri::WebviewWindowBuilder::new(app, &label, tauri::WebviewUrl::App(route.into()))
        .title("Apical")
        .inner_size(1100.0, 760.0)
        .min_inner_size(900.0, 600.0)
        .build()
        .map_err(|e| format!("open window failed: {}", e))?;
    Ok(())
}

/// JS-invokable wrapper around `open_app_window`. Non-async so Tauri runs it on
/// the main thread.
#[tauri::command]
fn open_app_window_cmd(app: tauri::AppHandle, path: Option<String>) -> Result<(), String> {
    open_app_window(&app, path.as_deref())
}

// ─── Desktop settings (JSON in app_data_dir) ────────────────────────────────
//
// A single JSON blob owned by the desktop app. Read by Rust at startup (for
// keep-running-in-background + the first-time close notification flag) and by
// the bundled Node server (for the remote-access policy — see
// src/lib/desktop/desktop-policy.ts, located via APICAL_DESKTOP_DATA_DIR).
//
// CRITICAL: it is writable ONLY through the `write_desktop_settings` IPC
// command, which is reachable only from the Tauri webview. No web request or
// the local HTTP server can modify it — this is what makes the remote-access
// opt-in trustworthy.

const DESKTOP_SETTINGS_FILE: &str = "desktop-settings.json";

fn desktop_settings_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("create app_data_dir: {e}"))?;
    Ok(dir.join(DESKTOP_SETTINGS_FILE))
}

fn read_desktop_settings_value(app: &tauri::AppHandle) -> serde_json::Value {
    let path = match desktop_settings_path(app) {
        Ok(p) => p,
        Err(_) => return serde_json::json!({}),
    };
    match std::fs::read_to_string(&path) {
        Ok(raw) => serde_json::from_str(&raw).unwrap_or_else(|_| serde_json::json!({})),
        Err(_) => serde_json::json!({}),
    }
}

fn write_desktop_settings_value(
    app: &tauri::AppHandle,
    value: &serde_json::Value,
) -> Result<(), String> {
    let path = desktop_settings_path(app)?;
    let raw = serde_json::to_string_pretty(value).map_err(|e| format!("serialize: {e}"))?;
    std::fs::write(&path, raw).map_err(|e| format!("write settings: {e}"))
}

/// True when the app should hide to the tray on window close (default true).
fn keep_running_in_background(app: &tauri::AppHandle) -> bool {
    read_desktop_settings_value(app)
        .get("keepRunningInBackground")
        .and_then(|v| v.as_bool())
        .unwrap_or(true)
}

/// Read the full desktop settings JSON (returns "{}" when absent).
#[tauri::command]
fn read_desktop_settings(app: tauri::AppHandle) -> Result<String, String> {
    Ok(read_desktop_settings_value(&app).to_string())
}

/// Overwrite the desktop settings JSON. Only reachable from the webview.
#[tauri::command]
fn write_desktop_settings(app: tauri::AppHandle, settings: String) -> Result<(), String> {
    let value: serde_json::Value =
        serde_json::from_str(&settings).map_err(|e| format!("invalid settings json: {e}"))?;
    write_desktop_settings_value(&app, &value)
}

/// First time we hide to tray, tell the user the app keeps running. Persists a
/// `closeToTraySeen` flag so it only fires once.
fn maybe_show_close_to_tray_notification(app: &tauri::AppHandle) {
    let mut value = read_desktop_settings_value(app);
    let seen = value
        .get("closeToTraySeen")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    if seen {
        return;
    }
    let _ = app
        .notification()
        .builder()
        .title("Apical is still running")
        .body("Apical keeps running in the menu bar so scheduled workflows can run. Quit from the tray menu to fully exit.")
        .show();
    if let Some(obj) = value.as_object_mut() {
        obj.insert("closeToTraySeen".into(), serde_json::Value::Bool(true));
        let _ = write_desktop_settings_value(app, &value);
    }
}

// ─── Native menu + tray event routing ───────────────────────────────────────

/// Bring the main window to the foreground. On macOS this also restores the
/// regular (Dock-visible) activation policy, which is dropped to Accessory
/// while hidden to tray.
fn focus_main(app: &tauri::AppHandle) {
    #[cfg(target_os = "macos")]
    {
        let _ = app.set_activation_policy(tauri::ActivationPolicy::Regular);
    }
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

/// Mark the app as quitting (so CloseRequested won't hide-to-tray) and exit.
fn trigger_quit(app: &tauri::AppHandle) {
    if let Some(flags) = app.try_state::<AppFlags>() {
        flags.is_quitting.store(true, Ordering::SeqCst);
    }
    app.exit(0);
}

/// Route a menu/tray action. Native-only actions (new window, show, quit) are
/// handled here; front-end actions are forwarded to the webview via the
/// `apical://menu` event so React can react (navigate, open palette, etc.).
fn handle_menu_action(app: &tauri::AppHandle, id: &str) {
    match id {
        "window:new" => {
            if let Err(e) = open_app_window(app, None) {
                log::error!("open_app_window failed: {}", e);
            }
        }
        "tray:show" => focus_main(app),
        "app:quit" => trigger_quit(app),
        // Tray "Pause automations" checkbox — forward to the webview, which
        // calls the cloud pause-all endpoint. The tray reflects state on the
        // next update_tray_status call.
        "tray:pause" => {
            let _ = app.emit("apical://tray", "automations:toggle".to_string());
        }
        // Per-workflow tray actions — handled in the webview without opening the app.
        id if id.starts_with("tray:job:") => {
            if let Some(payload) = id.strip_prefix("tray:job:") {
                if let Some((job_id, action)) = payload.rsplit_once(':') {
                    let _ = app.emit("apical://tray", format!("job:{action}:{job_id}"));
                }
            }
        }
        // Disabled status lines (no action).
        id if id.starts_with("tray:status") => {}
        // Front-end actions — make sure the window is up, then forward.
        other => {
            focus_main(app);
            let _ = app.emit("apical://menu", other.to_string());
        }
    }
}

/// Truncate long workflow names for native menu labels.
fn truncate_menu_label(s: &str, max: usize) -> String {
    let t = s.trim();
    if t.chars().count() <= max {
        return t.to_string();
    }
    format!("{}…", t.chars().take(max.saturating_sub(1)).collect::<String>())
}

/// One submenu per scheduled workflow: Run now / Pause|Resume / Skip next run.
fn build_scheduled_workflow_submenus(
    app: &tauri::AppHandle,
    jobs: &[TrayJob],
) -> tauri::Result<Vec<tauri::menu::Submenu<tauri::Wry>>> {
    let mut out = Vec::new();
    for job in jobs.iter().take(12) {
        let title = truncate_menu_label(
            &format!("{} · {}", job.name, job.next_run_label),
            48,
        );
        let run = MenuItemBuilder::with_id(format!("tray:job:{}:run", job.id), "Run Now")
            .build(app)?;
        let pause_resume = if job.status == "paused" {
            MenuItemBuilder::with_id(format!("tray:job:{}:resume", job.id), "Resume").build(app)?
        } else {
            MenuItemBuilder::with_id(format!("tray:job:{}:pause", job.id), "Pause").build(app)?
        };
        let skip = MenuItemBuilder::with_id(format!("tray:job:{}:skip", job.id), "Skip Next Run")
            .build(app)?;
        let submenu = SubmenuBuilder::new(app, title)
            .item(&run)
            .item(&pause_resume)
            .item(&skip)
            .build()?;
        out.push(submenu);
    }
    Ok(out)
}

/// Build the application menu bar (File / View / Window / Help + the macOS app
/// menu). Accelerators here are the single source of keyboard shortcuts in the
/// desktop build — the web keydown handler defers to them when running native.
fn build_app_menu(
    app: &tauri::AppHandle,
    status: &TrayStatus,
) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    let settings = MenuItemBuilder::with_id("nav:settings", "Settings…")
        .accelerator("CmdOrCtrl+,")
        .build(app)?;

    // Custom quit (not PredefinedMenuItem::quit) so it routes through
    // handle_menu_action → trigger_quit, which sets the is_quitting flag
    // before exiting. Otherwise the CloseRequested handler would swallow it.
    let quit = MenuItemBuilder::with_id("app:quit", "Quit Apical")
        .accelerator("CmdOrCtrl+Q")
        .build(app)?;

    let mut apical_builder = SubmenuBuilder::new(app, "Apical")
        .item(&PredefinedMenuItem::about(app, Some("About Apical"), None)?)
        .separator();
    if status.jobs.is_empty() {
        let empty = MenuItemBuilder::with_id("tray:status:empty", "No scheduled workflows")
            .enabled(false)
            .build(app)?;
        apical_builder = apical_builder.item(&empty);
    } else {
        for submenu in build_scheduled_workflow_submenus(app, &status.jobs)? {
            apical_builder = apical_builder.item(&submenu);
        }
    }
    let app_menu = apical_builder
        .separator()
        .item(&settings)
        .separator()
        .item(&quit)
        .build()?;

    let new_window = MenuItemBuilder::with_id("window:new", "New Window")
        .accelerator("CmdOrCtrl+N")
        .build(app)?;
    let file_menu = SubmenuBuilder::new(app, "File")
        .item(&new_window)
        .separator()
        .item(&PredefinedMenuItem::close_window(app, Some("Close Window"))?)
        .build()?;

    let go_agents = MenuItemBuilder::with_id("nav:agents", "Agents")
        .accelerator("CmdOrCtrl+1")
        .build(app)?;
    let go_vault = MenuItemBuilder::with_id("nav:vault", "Vault")
        .accelerator("CmdOrCtrl+2")
        .build(app)?;
    let go_data = MenuItemBuilder::with_id("nav:data", "Data")
        .accelerator("CmdOrCtrl+3")
        .build(app)?;
    let toggle_inspector = MenuItemBuilder::with_id("view:inspector", "Toggle Inspector")
        .accelerator("CmdOrCtrl+I")
        .build(app)?;
    let palette = MenuItemBuilder::with_id("view:palette", "Command Palette…")
        .accelerator("CmdOrCtrl+K")
        .build(app)?;
    let view_menu = SubmenuBuilder::new(app, "View")
        .item(&go_agents)
        .item(&go_vault)
        .item(&go_data)
        .separator()
        .item(&toggle_inspector)
        .item(&palette)
        .build()?;

    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .item(&PredefinedMenuItem::undo(app, None)?)
        .item(&PredefinedMenuItem::redo(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::cut(app, None)?)
        .item(&PredefinedMenuItem::copy(app, None)?)
        .item(&PredefinedMenuItem::paste(app, None)?)
        .item(&PredefinedMenuItem::select_all(app, None)?)
        .build()?;

    let window_menu = SubmenuBuilder::new(app, "Window")
        .item(&PredefinedMenuItem::minimize(app, Some("Minimize"))?)
        .item(&PredefinedMenuItem::maximize(app, Some("Zoom"))?)
        .build()?;

    let docs = MenuItemBuilder::with_id("help:docs", "Documentation").build(app)?;
    let shortcuts = MenuItemBuilder::with_id("help:shortcuts", "Keyboard Shortcuts").build(app)?;
    let help_menu = SubmenuBuilder::new(app, "Help")
        .item(&docs)
        .item(&shortcuts)
        .build()?;

    MenuBuilder::new(app)
        .items(&[&app_menu, &file_menu, &edit_menu, &view_menu, &window_menu, &help_menu])
        .build()
}

/// Build the tray context menu from the current status. Rebuilt whenever the
/// frontend reports a change via `update_tray_status`.
fn build_tray_menu(
    app: &tauri::AppHandle,
    status: &TrayStatus,
) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    let status_line = if status.local_only {
        "Local-only mode".to_string()
    } else if !status.linked {
        "Not linked to cloud".to_string()
    } else if status.desktop_online {
        "Cloud: linked · Desktop online".to_string()
    } else {
        "Cloud: linked · Desktop offline".to_string()
    };
    let status_item = MenuItemBuilder::with_id("tray:status", status_line)
        .enabled(false)
        .build(app)?;

    let sched_label = match status.scheduled_count {
        0 => "No scheduled workflows".to_string(),
        1 => "1 scheduled workflow".to_string(),
        n => format!("{n} scheduled workflows"),
    };
    let sched_item = MenuItemBuilder::with_id("tray:status:sched", sched_label)
        .enabled(false)
        .build(app)?;

    let show = MenuItemBuilder::with_id("tray:show", "Open Apical").build(app)?;
    let pause = CheckMenuItemBuilder::with_id("tray:pause", "Pause automations")
        .checked(status.automations_paused)
        .enabled(status.linked && !status.local_only)
        .build(app)?;
    let settings = MenuItemBuilder::with_id("nav:settings", "Settings…").build(app)?;
    let quit = MenuItemBuilder::with_id("app:quit", "Quit Apical").build(app)?;

    let mut builder = MenuBuilder::new(app)
        .item(&status_item)
        .item(&sched_item)
        .separator();
    if status.jobs.is_empty() {
        let empty = MenuItemBuilder::with_id("tray:status:empty", "No scheduled workflows")
            .enabled(false)
            .build(app)?;
        builder = builder.item(&empty);
    } else {
        for submenu in build_scheduled_workflow_submenus(app, &status.jobs)? {
            builder = builder.item(&submenu);
        }
    }
    builder
        .separator()
        .item(&show)
        .item(&pause)
        .separator()
        .item(&settings)
        .item(&quit)
        .build()
}

/// Build the system tray icon + its (initial) context menu.
fn build_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    let status = app
        .try_state::<TrayState>()
        .map(|s| s.0.lock().map(|g| g.clone()).unwrap_or_default())
        .unwrap_or_default();
    let tray_menu = build_tray_menu(app, &status)?;

    let mut builder = TrayIconBuilder::with_id("apical-tray")
        .tooltip("Apical")
        .menu(&tray_menu)
        // Left-click shows the workflow menu; use "Open Apical" inside to show the window.
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| handle_menu_action(app, event.id.as_ref()));

    // Menu-bar / system-tray icon: backgroundless centered mark.
    // macOS: black template → system tints white on dark menu bar, black on light.
    #[cfg(target_os = "macos")]
    {
        builder = builder
            .icon(tauri::include_image!("icons/tray-template.png"))
            .icon_as_template(true);
    }
    // Windows: dark glyph for the default light taskbar; white variant on dark taskbars
    // is handled by the shell where supported — tray-dark is the fallback.
    #[cfg(target_os = "windows")]
    {
        builder = builder.icon(tauri::include_image!("icons/tray-light.png"));
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        builder = builder.icon(tauri::include_image!("icons/tray-dark.png"));
    }

    builder.build(app)?;
    Ok(())
}

/// Update the tray menu from a JSON status blob reported by the frontend.
/// Rust stays dumb — it renders exactly what the webview reports.
#[tauri::command]
fn update_tray_status(app: tauri::AppHandle, status_json: String) -> Result<(), String> {
    let status: TrayStatus =
        serde_json::from_str(&status_json).map_err(|e| format!("invalid tray status: {e}"))?;
    if let Some(state) = app.try_state::<TrayState>() {
        if let Ok(mut guard) = state.0.lock() {
            *guard = status.clone();
        }
    }
    let menu = build_tray_menu(&app, &status).map_err(|e| format!("build tray menu: {e}"))?;
    if let Some(tray) = app.tray_by_id("apical-tray") {
        tray.set_menu(Some(menu))
            .map_err(|e| format!("set tray menu: {e}"))?;
    }
    let app_menu = build_app_menu(&app, &status).map_err(|e| format!("build app menu: {e}"))?;
    app.set_menu(app_menu)
        .map_err(|e| format!("set app menu: {e}"))?;
    Ok(())
}

// ─── App entrypoint ─────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info"))
        .format_timestamp(None)
        .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_notification::init())
        // Launch-at-login. The `--hidden` arg makes the login launch start
        // straight to the tray without popping a window.
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--hidden"]),
        ))
        .manage(LoopbackListeners(Mutex::new(HashMap::new())))
        .manage(AppFlags {
            is_quitting: AtomicBool::new(false),
        })
        .manage(TrayState(Mutex::new(TrayStatus::default())))
        .invoke_handler(tauri::generate_handler![
            keychain_get,
            keychain_set,
            keychain_delete,
            start_loopback_listener,
            stop_loopback_listener,
            open_url,
            spawn_mcp_stdio,
            open_app_window_cmd,
            read_desktop_settings,
            write_desktop_settings,
            update_tray_status,
        ])
        // Native menu-bar clicks (app menu) route through here.
        .on_menu_event(|app, event| handle_menu_action(app, event.id.as_ref()))
        // Close-to-tray: a plain close of the main window hides it (keeping the
        // bundled server + bridge alive for scheduled runs) unless the user
        // turned off "keep running in background" or is really quitting.
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() != "main" {
                    return; // secondary windows close normally
                }
                let app = window.app_handle();
                let quitting = app
                    .try_state::<AppFlags>()
                    .map(|f| f.is_quitting.load(Ordering::SeqCst))
                    .unwrap_or(false);
                if quitting || !keep_running_in_background(app) {
                    return; // allow the close → process exits
                }
                api.prevent_close();
                let _ = window.hide();
                #[cfg(target_os = "macos")]
                {
                    let _ = app.set_activation_policy(tauri::ActivationPolicy::Accessory);
                }
                maybe_show_close_to_tray_notification(app);
            }
        })
        .setup(|app| {
            let handle = app.handle().clone();
            let hidden = launched_hidden();

            #[cfg(not(debug_assertions))]
            {
                match start_bundled_server(&handle) {
                    Ok(()) => {
                        if let Err(e) = navigate_main_to_desktop_ui(&handle, !hidden) {
                            show_startup_error(
                                &handle,
                                &format!("Server started but the window could not load:\n{e}"),
                            );
                        }
                    }
                    Err(e) => {
                        show_startup_error(
                            &handle,
                            &format!(
                                "The bundled server failed to start.\n\n{e}\n\nIf you are on an Intel Mac, download the Intel build from apical-app.vercel.app."
                            ),
                        );
                    }
                }
            }

            #[cfg(debug_assertions)]
            {
                if hidden {
                    #[cfg(target_os = "macos")]
                    {
                        let _ = handle.set_activation_policy(tauri::ActivationPolicy::Accessory);
                    }
                } else if let Some(w) = handle.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            }

            // Native application menu bar.
            let menu = build_app_menu(&handle, &TrayStatus::default())?;
            app.set_menu(menu)?;

            // System tray.
            if let Err(e) = build_tray(&handle) {
                log::error!("tray setup failed: {}", e);
            }

            // Global (OS-level) shortcut: summon/hide Apical from anywhere.
            #[cfg(desktop)]
            {
                use tauri_plugin_global_shortcut::{
                    Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState,
                };

                // Cmd/Ctrl + Shift + A.
                let summon = Shortcut::new(
                    Some(Modifiers::SUPER | Modifiers::SHIFT),
                    Code::KeyA,
                );
                let summon_for_handler = summon;

                if let Err(e) = handle.plugin(
                    tauri_plugin_global_shortcut::Builder::new()
                        .with_handler(move |app, shortcut, event| {
                            if shortcut == &summon_for_handler
                                && event.state() == ShortcutState::Pressed
                            {
                                if let Some(w) = app.get_webview_window("main") {
                                    let visible = w.is_visible().unwrap_or(false);
                                    let focused = w.is_focused().unwrap_or(false);
                                    if visible && focused {
                                        let _ = w.hide();
                                    } else {
                                        #[cfg(target_os = "macos")]
                                        {
                                            let _ = app.set_activation_policy(
                                                tauri::ActivationPolicy::Regular,
                                            );
                                        }
                                        let _ = w.unminimize();
                                        let _ = w.show();
                                        let _ = w.set_focus();
                                    }
                                }
                            }
                        })
                        .build(),
                ) {
                    log::warn!("global shortcut plugin init failed: {e}");
                } else if let Err(e) = app.global_shortcut().register(summon) {
                    log::warn!("global shortcut register failed: {e}");
                }
            }

            log::info!("Apical desktop shell started");
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            // Tauri exits when the last window closes unless we intercept this.
            if let tauri::RunEvent::ExitRequested { api, code, .. } = event {
                let quitting = app_handle
                    .try_state::<AppFlags>()
                    .map(|f| f.is_quitting.load(Ordering::SeqCst))
                    .unwrap_or(false);
                if !quitting && keep_running_in_background(&app_handle) && code.is_none() {
                    api.prevent_exit();
                }
            }
        });
}
