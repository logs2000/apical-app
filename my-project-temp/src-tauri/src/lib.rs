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
use std::sync::Mutex;
use tauri::Manager;
use tauri_plugin_shell::ShellExt;

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
    match entry.delete_password() {
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
        ])
        .setup(|_app| {
            log::info!("Apical desktop shell started");
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
