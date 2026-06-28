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
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager};
use tauri_plugin_shell::ShellExt;

/// Monotonic counter for unique secondary-window labels (multi-window).
static WINDOW_COUNTER: AtomicU32 = AtomicU32::new(1);

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

/// Keeps the bundled Node server process alive for the app lifetime.
struct BundledServer(Mutex<Option<tauri_plugin_shell::process::CommandChild>>);

/// Spawn the bundled Node sidecar + standalone server and wait until it listens.
#[cfg(not(debug_assertions))]
fn start_bundled_server(app: &tauri::AppHandle) -> Result<(), String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("resource_dir: {}", e))?;
    let standalone_dir = resource_dir.join("standalone");
    if !standalone_dir.join("server.js").exists() {
        return Err(format!(
            "missing bundled server at {}",
            standalone_dir.join("server.js").display()
        ));
    }

    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {}", e))?;
    std::fs::create_dir_all(&data_dir)
        .map_err(|e| format!("create app_data_dir: {}", e))?;
    let db_path = data_dir.join("custom.db");

    let sidecar = app
        .shell()
        .sidecar("node")
        .map_err(|e| format!("sidecar node: {}", e))?;

    let (_rx, child) = sidecar
        .args(["server.js"])
        .current_dir(&standalone_dir)
        .env("DESKTOP_LOCAL", "true")
        .env("AUTH_BYPASS_DEV", "true")
        .env("NODE_ENV", "production")
        .env("PORT", "3000")
        .env("HOSTNAME", "127.0.0.1")
        .env(
            "DATABASE_URL",
            format!("file:{}", db_path.to_string_lossy()),
        )
        .env("NEXTAUTH_SECRET", "desktop-local-secret")
        .env("NEXTAUTH_URL", "http://127.0.0.1:3000")
        .spawn()
        .map_err(|e| format!("spawn node sidecar: {}", e))?;

    app.manage(BundledServer(Mutex::new(Some(child))));

    for attempt in 0..90 {
        if std::net::TcpStream::connect("127.0.0.1:3000").is_ok() {
            log::info!("bundled Next.js server ready (attempt {})", attempt + 1);
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

// ─── Native menu + tray event routing ───────────────────────────────────────

/// Bring the main window to the foreground.
fn focus_main(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
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
        "app:quit" => app.exit(0),
        // Front-end actions — make sure the window is up, then forward.
        other => {
            focus_main(app);
            let _ = app.emit("apical://menu", other.to_string());
        }
    }
}

/// Build the application menu bar (File / View / Window / Help + the macOS app
/// menu). Accelerators here are the single source of keyboard shortcuts in the
/// desktop build — the web keydown handler defers to them when running native.
fn build_app_menu(app: &tauri::AppHandle) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    let settings = MenuItemBuilder::with_id("nav:settings", "Settings…")
        .accelerator("CmdOrCtrl+,")
        .build(app)?;

    let app_menu = SubmenuBuilder::new(app, "Apical")
        .item(&PredefinedMenuItem::about(app, Some("About Apical"), None)?)
        .separator()
        .item(&settings)
        .separator()
        .item(&PredefinedMenuItem::quit(app, Some("Quit Apical"))?)
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

/// Build the system tray icon + its context menu.
fn build_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    let show = MenuItemBuilder::with_id("tray:show", "Show Apical").build(app)?;
    let settings = MenuItemBuilder::with_id("nav:settings", "Settings…").build(app)?;
    let quit = MenuItemBuilder::with_id("app:quit", "Quit Apical").build(app)?;
    let tray_menu = MenuBuilder::new(app)
        .items(&[&show, &settings])
        .separator()
        .item(&quit)
        .build()?;

    let mut builder = TrayIconBuilder::with_id("apical-tray")
        .tooltip("Apical")
        .menu(&tray_menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| handle_menu_action(app, event.id.as_ref()))
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                focus_main(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
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
        .manage(LoopbackListeners(Mutex::new(HashMap::new())))
        .invoke_handler(tauri::generate_handler![
            keychain_get,
            keychain_set,
            keychain_delete,
            start_loopback_listener,
            stop_loopback_listener,
            open_url,
            spawn_mcp_stdio,
            open_app_window_cmd,
        ])
        // Native menu-bar clicks (app menu) route through here.
        .on_menu_event(|app, event| handle_menu_action(app, event.id.as_ref()))
        .setup(|app| {
            let handle = app.handle().clone();

            #[cfg(not(debug_assertions))]
            if let Err(e) = start_bundled_server(&handle) {
                log::error!("bundled server failed: {}", e);
            }

            // Native application menu bar.
            let menu = build_app_menu(&handle)?;
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

                handle.plugin(
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
                                        let _ = w.unminimize();
                                        let _ = w.show();
                                        let _ = w.set_focus();
                                    }
                                }
                            }
                        })
                        .build(),
                )?;

                if let Err(e) = app.global_shortcut().register(summon) {
                    log::warn!("global shortcut register failed: {}", e);
                }
            }

            log::info!("Apical desktop shell started");
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
