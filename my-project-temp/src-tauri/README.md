# Apical — Tauri desktop shell

Apical's desktop shell is built with **Tauri 2.0** (not Electron). Tauri uses
the OS's native webview (~30-50 MB) instead of bundling Chromium (~150-200 MB),
and its Rust side provides capabilities the Next.js app can't do alone:

- **OS keychain access** (F2 vault in local mode) — macOS Keychain, Windows
  Credential Manager, libsecret on Linux. The Next.js runtime calls these via
  IPC; secrets never touch SQLite in local mode.
- **Loopback redirect listener** (F1 OAuth engine) — Rust owns the socket on
  127.0.0.1 so the OS browser can hit the OAuth callback directly. This is
  the local-first OAuth path that doesn't require the Next.js server to be
  reachable from the user's browser.
- **Local stdio MCP server spawn** (A1) — spawns MCP server processes with
  vault-injected env vars at spawn time.

## Why Tauri (not Electron)

Apical already ships a Next.js web app — Tauri reuses it as-is, Electron
forces a second rendering process model. Tauri binaries are 3-10 MB vs
Electron's 80-150 MB. Tauri 2.0 has first-class MCP support and a Rust
sidecar pattern that fits "spawn MCP servers locally" better than Electron's
Node main process.

## Layout

```
src-tauri/
├── Cargo.toml              # Rust deps: tauri 2, keyring 3, tokio, reqwest
├── tauri.conf.json         # Tauri config: window, bundle, plugins
├── build.rs                # tauri-build
├── capabilities/
│   └── default.json        # Permissions for the main window
├── icons/                  # App icons (placeholder — replace with real PNG/ICO/ICNS)
└── src/
    ├── main.rs             # Entry point — calls apical_lib::run()
    └── lib.rs              # App builder + IPC command handlers
```

## IPC commands

Defined in `src/lib.rs`, exposed to JS via `@tauri-apps/api`:

| Command                  | Purpose                                            |
|--------------------------|----------------------------------------------------|
| `keychain_get(handle)`   | Read a secret from the OS keychain                 |
| `keychain_set(handle,v)` | Write a secret to the OS keychain                  |
| `keychain_delete(handle)`| Delete a secret from the OS keychain               |
| `start_loopback_listener(port)` | Start a 127.0.0.1 HTTP listener for OAuth   |
| `stop_loopback_listener(port)`  | Stop a loopback listener                    |
| `open_url(url)`          | Open a URL in the OS default browser               |
| `spawn_mcp_stdio(cmd, args, env)` | Spawn a local stdio MCP server            |

JS-side wrappers are in `src/lib/desktop/tauri-bridge.ts`. They auto-detect
Tauri (via `window.__TAURI_INTERNALS__`) and fall through to no-ops in hosted
mode so the rest of the app works unchanged.

## Development

```bash
# Install Rust toolchain (one-time):
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Install Tauri CLI:
bun add -D @tauri-apps/cli   # already in devDependencies

# Run the desktop app in dev mode:
bun run tauri:dev

# Build a production bundle (.app / .exe / .AppImage):
bun run tauri:build
```

`tauri:dev` starts the Next.js dev server (`bun run dev` via
`beforeDevCommand`) and opens a Tauri window pointing at
`http://localhost:3000`. The Rust side loads its IPC handlers; the JS side
detects Tauri and installs the keychain backend.

`tauri:build` runs `bun run build` (producing `.next/standalone/`), bundles
the Next.js standalone server as a Tauri sidecar, and produces a native
installer for the host OS.

## Local-first OAuth flow (Tauri path)

1. The Next.js runtime calls `startTauriLoopbackListener(0)` — Rust binds a
   random port on 127.0.0.1 and returns the redirect URI
   (`http://127.0.0.1:<port>/callback`).
2. The runtime builds the authorize URL with F1's `buildAuthorizationUrl()`,
   using the Tauri-provided redirect URI.
3. The runtime calls `openUrlInBrowser(authorizeUrl)` — Rust opens the OS
   default browser. The user authenticates with the provider.
4. The provider redirects to `http://127.0.0.1:<port>/callback?code=…&state=…`.
   Rust's listener captures the request, emits an `oauth-callback` event with
   the raw request line, then shuts down.
5. The JS side's `onOAuthCallback()` subscription parses the code + state,
   calls `/api/oauth/callback` (or `/api/mcp/oauth/complete` for MCP) to
   exchange the code for tokens.
6. Tokens are persisted via F1's `persistOAuthCredential()` — in Tauri mode,
   the OS keychain is preferred (F2).

## Production bundle

The production bundle ships the Next.js standalone server as a Tauri sidecar
(see `tauri.conf.json` → `plugins.shell.scope`). On first launch, Tauri
spawns the server, waits for it to come up on port 3000, then loads the
webview. The user sees a native window with the full Apical app — no
browser tab needed.

The SQLite database lives at `~/.apical/db/custom.db` (per `DATABASE_URL` in
`.env`). The OS keychain holds the secrets. The app is fully functional
offline (no Apical cloud required).
