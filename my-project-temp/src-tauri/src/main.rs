// Apical — Tauri desktop shell (main.rs).
//
// Tauri 2.0 entrypoint. The webview loads the Next.js app (dev: localhost:3000,
// prod: bundled standalone server). Rust side provides:
//   - OS keychain access (F2 vault in local mode) via the `keyring` crate.
//   - Loopback redirect listener for OAuth (F1) — Rust owns the socket so the
//     OS browser can hit 127.0.0.1 directly without going through the Next.js
//     server.
//   - Sidecar lifecycle for the bundled Next.js server (production).
//
// Why Tauri over Electron for Apical:
//   - Apical already ships a Next.js web app — Tauri reuses it as-is, Electron
//     forces a second rendering process model.
//   - Tauri binaries are ~3-10 MB vs Electron's ~80-150 MB.
//   - Tauri 2.0 has first-class MCP support (we're building on MCP) and a rust
//     sidecar pattern that fits "spawn MCP servers locally".
//   - Memory: Tauri uses the OS webview (~30-50 MB), Electron bundles
//     Chromium (~150-200 MB).

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    apical_lib::run()
}
