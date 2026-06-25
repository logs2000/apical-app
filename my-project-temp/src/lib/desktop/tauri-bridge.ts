// Apical — Tauri bridge (JS side).
//
// Detects whether the app is running inside the Tauri desktop shell and, if
// so, exposes typed wrappers around the Rust IPC commands defined in
// `src-tauri/src/lib.rs`. When NOT running inside Tauri (hosted mode), all
// calls fall through to no-op / null returns so the rest of the app works
// unchanged.
//
// Used by:
//   - F1 OAuth engine — to start a loopback listener owned by Rust (so the
//     OS browser can hit 127.0.0.1 directly without going through the Next.js
//     server).
//   - F2 vault — to read/write secrets from the OS keychain instead of the
//     AES-256-GCM vault (local-first preference).
//   - A1 MCP client — to spawn local stdio MCP servers with vault-injected
//     env vars.

import { setKeychainBackend, type KeychainBackend } from '../auth/vault-interface'

/** True when running inside the Tauri desktop shell. */
export const IS_TAURI =
  typeof window !== 'undefined' &&
  // Tauri 2 injects `window.__TAURI_INTERNALS__` (and `window.__TAURI__` when
  // `withGlobalTauri` is true). We check both.
  (typeof (window as unknown as { __TAURI_INTERNALS__?: unknown })
    .__TAURI_INTERNALS__ !== 'undefined' ||
    typeof (window as unknown as { __TAURI__?: unknown }).__TAURI__ !==
      'undefined')

/** The Tauri `invoke` function, lazy-loaded so this file doesn't crash hosted mode. */
let invokePromise: Promise<typeof import('@tauri-apps/api/core').invoke> | null = null
async function getInvoke() {
  if (!IS_TAURI) return null
  if (!invokePromise) {
    invokePromise = import('@tauri-apps/api/core').then((m) => m.invoke)
  }
  return invokePromise
}

/** The Tauri `listen` function for events. */
let listenPromise: Promise<typeof import('@tauri-apps/api/event').listen> | null = null
async function getListen() {
  if (!IS_TAURI) return null
  if (!listenPromise) {
    listenPromise = import('@tauri-apps/api/event').then((m) => m.listen)
  }
  return listenPromise
}

// ─── Keychain (F2 vault in local mode) ──────────────────────────────────────

/** Tauri-backed keychain backend. Calls Rust `keychain_get/set/delete`. */
const tauriKeychain: KeychainBackend = {
  async get(handle: string): Promise<string | null> {
    const invoke = await getInvoke()
    if (!invoke) return null
    try {
      const v = (await invoke('keychain_get', { handle })) as string | null
      return v
    } catch (err) {
      console.error('[tauri-bridge] keychain_get failed:', err)
      return null
    }
  },
  async set(handle: string, value: string): Promise<void> {
    const invoke = await getInvoke()
    if (!invoke) return
    try {
      await invoke('keychain_set', { handle, value })
    } catch (err) {
      console.error('[tauri-bridge] keychain_set failed:', err)
    }
  },
  async delete(handle: string): Promise<void> {
    const invoke = await getInvoke()
    if (!invoke) return
    try {
      await invoke('keychain_delete', { handle })
    } catch (err) {
      console.error('[tauri-bridge] keychain_delete failed:', err)
    }
  },
}

/**
 * Install the Tauri keychain backend. Called at app boot when IS_TAURI is true.
 * After this call, the vault's `getKeychainBackend()` returns the Tauri
 * backend; credential resolution prefers the OS keychain over AES-256-GCM.
 */
export function installTauriKeychain(): void {
  if (!IS_TAURI) return
  setKeychainBackend(tauriKeychain)
}

// ─── Loopback listener (F1 OAuth engine) ────────────────────────────────────

export interface LoopbackStartResult {
  port: number
  redirect_uri: string
}

/**
 * Start a loopback HTTP listener on 127.0.0.1 (pinned, not "localhost").
 * Returns the bound port + redirect URI to use in the authorize request.
 *
 * The listener emits an `oauth-callback` event when the OS browser hits the
 * callback URL. Subscribe via `onOAuthCallback()`.
 */
export async function startTauriLoopbackListener(port = 0): Promise<LoopbackStartResult | null> {
  const invoke = await getInvoke()
  if (!invoke) return null
  try {
    return (await invoke('start_loopback_listener', { port })) as LoopbackStartResult
  } catch (err) {
    console.error('[tauri-bridge] start_loopback_listener failed:', err)
    return null
  }
}

/** Stop a loopback listener by port. */
export async function stopTauriLoopbackListener(port: number): Promise<void> {
  const invoke = await getInvoke()
  if (!invoke) return
  try {
    await invoke('stop_loopback_listener', { port })
  } catch (err) {
    console.error('[tauri-bridge] stop_loopback_listener failed:', err)
  }
}

/**
 * Subscribe to OAuth callback events from the loopback listener. Returns an
 * unsubscribe function.
 *
 * The callback receives the raw HTTP request line (e.g.
 * "GET /callback?code=xxx&state=yyy HTTP/1.1"). Parse out the code + state.
 */
export async function onOAuthCallback(
  cb: (requestLine: string) => void,
): Promise<(() => void) | null> {
  const listen = await getListen()
  if (!listen) return null
  try {
    const unlisten = await listen('oauth-callback', (event) => {
      cb(event.payload as string)
    })
    return unlisten
  } catch (err) {
    console.error('[tauri-bridge] onOAuthCallback failed:', err)
    return null
  }
}

// ─── Open URL in OS default browser ─────────────────────────────────────────

/** Open a URL in the OS default browser. Used by the OAuth flow. */
export async function openUrlInBrowser(url: string): Promise<void> {
  const invoke = await getInvoke()
  if (!invoke) {
    // Hosted mode fallback — open in a new tab.
    if (typeof window !== 'undefined') {
      window.open(url, '_blank', 'noopener,noreferrer')
    }
    return
  }
  try {
    await invoke('open_url', { url })
  } catch (err) {
    console.error('[tauri-bridge] open_url failed:', err)
    // Fallback to window.open.
    if (typeof window !== 'undefined') {
      window.open(url, '_blank', 'noopener,noreferrer')
    }
  }
}

// ─── Spawn local stdio MCP server ───────────────────────────────────────────

/**
 * Spawn a local stdio MCP server with vault-injected env vars. Returns the
 * PID. The runtime then connects to the server via stdin/stdout.
 *
 * Per A1: local stdio MCP servers fit local-first directly — the vault /
 * keychain secret is injected as an env var at spawn time.
 */
export async function spawnMcpStdio(
  command: string,
  args: string[],
  env: Record<string, string>,
): Promise<number | null> {
  const invoke = await getInvoke()
  if (!invoke) return null
  try {
    return (await invoke('spawn_mcp_stdio', { command, args, env })) as number
  } catch (err) {
    console.error('[tauri-bridge] spawn_mcp_stdio failed:', err)
    return null
  }
}

// ─── Native menu / tray → front-end actions ─────────────────────────────────

/**
 * Front-end action ids emitted by the native menu bar + tray (see the Rust
 * `handle_menu_action`). Native-only actions (new window, quit, show) are
 * handled in Rust and never reach the webview.
 */
export type MenuAction =
  | 'nav:agents'
  | 'nav:vault'
  | 'nav:data'
  | 'nav:settings'
  | 'view:inspector'
  | 'view:palette'
  | 'help:docs'
  | 'help:shortcuts'

/**
 * Subscribe to native menu / tray actions forwarded from Rust. Returns an
 * unsubscribe function (or null in hosted mode).
 */
export async function onMenuAction(
  cb: (action: MenuAction) => void,
): Promise<(() => void) | null> {
  const listen = await getListen()
  if (!listen) return null
  try {
    const unlisten = await listen('apical://menu', (event) => {
      cb(event.payload as MenuAction)
    })
    return unlisten
  } catch (err) {
    console.error('[tauri-bridge] onMenuAction failed:', err)
    return null
  }
}

// ─── Multi-window ────────────────────────────────────────────────────────────

/**
 * Open a new Apical window (desktop only). No-op in hosted mode. Backed by the
 * Rust `open_app_window_cmd`, which creates a uniquely-labeled webview window.
 *
 * `path` is an app-relative route (must start with "/"). Pop-outs pass a hash
 * route like "/#popout=<conversationId>" so the new window opens focused on
 * that agent. Defaults to "/" (a fresh app window).
 */
export async function openAppWindow(path?: string): Promise<void> {
  const invoke = await getInvoke()
  if (!invoke) return
  try {
    await invoke('open_app_window_cmd', { path: path ?? '/' })
  } catch (err) {
    console.error('[tauri-bridge] open_app_window_cmd failed:', err)
  }
}
