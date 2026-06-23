// Apical — F2: Credential vault (refined).
//
// The vault is the spine of Apical's auth model. Every credential, however
// acquired, lands here. Workflow + integration documents reference
// credentials by ID only — secrets are never inlined into any document that
// can be synced, shared, or version-controlled. This invariant is enforced
// by the runtime's `{{cred:<id>.<field>}}` resolver: it looks the credential
// up by ID at execution time and injects the secret into the in-memory
// request, never into the persisted document.
//
// CREDENTIAL KINDS (one enum, every acquisition path maps to one of these):
//
//   oauth_access_token     — OAuth 2.0/2.1 access + refresh tokens (A1/A2-oauth2/A3).
//                            Stored as encrypted blobs in `oauthAccessToken` +
//                            `oauthRefreshToken` columns. Refreshed by F1's cron.
//
//   byoc_client_secret     — Bring-your-own-client OAuth client secrets (A2/A3).
//                            The user's own OAuth app credentials. Stored
//                            encrypted in `metaJson.customClientSecret`.
//
//   api_key                — Static API keys / PATs (A1-static / A2-apiKey).
//                            Stored encrypted in `metaJson.key`.
//
//   mcp_static_token       — Static token for a remote MCP server (A1-static).
//                            Same storage shape as api_key but tagged
//                            distinctly for the MCP UI.
//
//   browser_session        — Persisted browser session cookies (A5, opt-in).
//                            HIGH-RISK: stored encrypted but flagged for
//                            explicit per-integration user acknowledgement.
//                            Default OFF; never auto-select.
//
// STORAGE BACKENDS:
//
//   - Hosted mode (Next.js server): AES-256-GCM at rest via `encrypt()` /
//     `decrypt()` in `platform/vault.ts`. The vault key comes from
//     `APICAL_VAULT_KEY` (PBKDF2-derived). Required for multi-tenant
//     deployments where the server can't reach the user's keychain.
//
//   - Local mode (Tauri desktop shell): the OS keychain is preferred.
//     `tauri-plugin-keyring` (Rust crate `keyring`) writes credentials to
//     macOS Keychain / Windows Credential Manager / libsecret on Linux.
//     The Next.js server-side `encrypt()`/`decrypt()` is then BYPASSED for
//     credentials marked `storage: 'keychain'` — only the keychain handle
//     (a string ID) is persisted in the DB; the secret itself lives in the
//     OS keychain, never in SQLite.
//
//     The Tauri shell exposes a `credential:get` / `credential:set` /
//     `credential:delete` IPC channel that the Next.js runtime calls
//     through the desktop-bridge socket. In hosted mode this channel is
//     absent and the vault falls back to AES-256-GCM. This is invisible
//     to workflow authors — `{{cred:<id>.key}}` resolves either way.

/** The canonical credential kinds. Every Credential row has one of these. */
export type CredentialKind =
  | 'oauth' // OAuth 2.0/2.1 access + refresh tokens (legacy column name, kept for compat)
  | 'apikey' // static API key / PAT
  | 'payment' // payment method (rare; future)
  | 'mcp_token' // static MCP server token
  | 'browser_session' // A5 — persisted browser cookies (opt-in, high-risk)

/** Where the secret actually lives. */
export type CredentialStorage = 'vault' | 'keychain'

/**
 * Resolve a credential reference at execution time. Returns the secret value
 * (decrypted from the vault OR fetched from the OS keychain via the desktop
 * bridge) or null if the credential can't be resolved.
 *
 * The runtime calls this when it encounters `{{cred:<id>.<field>}}` in a
 * step's parameters. The field is one of: `key`, `token`, `secret`,
 * `accesstoken`, `refreshtoken`, `bearer` (alias for accesstoken).
 *
 * This function NEVER returns a value that gets persisted — it's purely for
 * in-memory injection into the request being built.
 */
export interface CredentialResolution {
  /** The resolved secret value, or null if not found. */
  value: string | null
  /** Where the value came from (for logging/debugging). */
  source: 'vault' | 'keychain' | 'not_found'
  /** The credential kind, for the runtime to format the secret correctly. */
  kind: CredentialKind | null
}

/**
 * The keychain interface. In hosted mode, this is a no-op (returns null).
 * In Tauri/local mode, the desktop-bridge socket injects a real implementation
 * that calls the Rust `keyring` crate via IPC.
 *
 * The interface is intentionally minimal: get/set/delete by a string handle.
 * The handle is a stable identifier (e.g. `apical:credential:<id>:access_token`)
 * so the same credential can be retrieved across Tauri restarts.
 */
export interface KeychainBackend {
  get(handle: string): Promise<string | null>
  set(handle: string, value: string): Promise<void>
  delete(handle: string): Promise<void>
}

/**
 * The default keychain backend — a no-op that returns null. Used in hosted
 * mode where the OS keychain isn't available. The vault falls back to
 * AES-256-GCM encryption at rest.
 *
 * In Tauri mode, the desktop-bridge socket replaces this with a real
 * implementation at boot. See `src-tauri/src/keychain.rs` for the Rust side.
 */
export const noopKeychain: KeychainBackend = {
  async get() {
    return null
  },
  async set() {
    // no-op
  },
  async delete() {
    // no-op
  },
}

/**
 * The active keychain backend. Set by the desktop-bridge when it connects.
 * Defaults to `noopKeychain` in hosted mode.
 */
let activeKeychain: KeychainBackend = noopKeychain

/** Replace the active keychain backend (called by the desktop-bridge). */
export function setKeychainBackend(backend: KeychainBackend): void {
  activeKeychain = backend
}

/** Get the active keychain backend. */
export function getKeychainBackend(): KeychainBackend {
  return activeKeychain
}

/**
 * The standard handle format for stashing a credential field in the keychain.
 * Format: `apical:credential:<credentialId>:<field>`
 */
export function keychainHandle(credentialId: string, field: string): string {
  return `apical:credential:${credentialId}:${field}`
}
