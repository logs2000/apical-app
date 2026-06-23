// Apical — F1: Unified OAuth 2.0 / 2.1 engine.
//
// THE central auth asset. Every OAuth path in Apical calls into this module:
//   - A1 (MCP OAuth 2.1 client) — for remote MCP servers behind OAuth
//   - A2 (OpenAPI ingestion with oauth2 securitySchemes) — BYOC path
//   - A3 (first-party OAuth apps, if/when enabled) — same engine, different
//     client credential source
//
// What this engine provides (one parameterized client, no per-provider code):
//   - Authorization-code + PKCE (S256) — RFC 7636
//   - Loopback redirect for local-first: spins up a transient 127.0.0.1
//     listener, captures the callback, shuts down. Pinned to 127.0.0.1
//     (NOT the string "localhost") consistently across authorize + token
//     requests — the mismatch silently breaks token exchange.
//   - Automatic token refresh and rotation (RFC 6749 §6).
//   - Resource Indicators (RFC 8707) — required for the MCP path.
//   - Protected Resource Metadata discovery (RFC 9728) — used by A1 to
//     discover the authorization server for a remote MCP server.
//
// What this engine deliberately does NOT do:
//   - Per-provider connector logic. Auth patterns are a small finite set;
//     providers differ only in endpoints + scopes, which are parameters.
//   - Dynamic Client Registration (DCR). Supported by only a small fraction
//     of authorization servers and being superseded by Client ID Metadata
//     Documents in the July 2026 spec revision. Ship static + OAuth-2.1
//     now; treat DCR/CIMD as a later enhancement.
//
// The engine is transport-agnostic: it works in the Next.js server process
// (HTTP-based redirect) AND in the Tauri desktop shell (loopback listener
// owned by Rust, callback captured by the OS browser). The Tauri path is
// preferred for local-first flows because it doesn't require the Next.js
// server to be reachable from the user's browser.

import { randomBytes, createHash } from 'crypto'
import { createServer, type Server } from 'http'
import { db } from '../db'
import { encrypt, decrypt } from '../platform/vault'

// ─── Types ──────────────────────────────────────────────────────────────────

/** OAuth 2.0 grant types we support. */
export type OAuthGrantType =
  | 'authorization_code' // the standard interactive flow
  | 'refresh_token' // refreshing an expired access token
  | 'client_credentials' // machine-to-machine (rare in our use case)

/** PKCE code challenge method — we always use S256. */
export const PKCE_METHOD = 'S256' as const

/** A PKCE verifier/challenge pair. */
export interface PkcePair {
  /** The verifier — sent to the token endpoint. Random 43-128 char string. */
  verifier: string
  /** The challenge — sent to the authorization endpoint. SHA256(verifier). */
  challenge: string
}

/** Parameters for the authorization-code flow. */
export interface AuthorizationCodeParams {
  /** The provider's authorization endpoint URL. */
  authorizationUrl: string
  /** The provider's token endpoint URL. */
  tokenUrl: string
  /** The OAuth client_id. */
  clientId: string
  /** The OAuth client_secret (empty for public clients using PKCE). */
  clientSecret?: string
  /** Space-separated scopes. */
  scope?: string
  /** The redirect URI. MUST match what's registered with the provider. */
  redirectUri: string
  /**
   * Optional resource parameter (RFC 8707). Required for MCP servers that
   * declare a `resource` in their Protected Resource Metadata.
   */
  resource?: string
  /** Optional state token. If omitted, one is generated. */
  state?: string
  /** Whether to use PKCE (default true — always on for public clients). */
  usePkce?: boolean
  /** Extra params to add to the authorization URL (provider-specific). */
  extraAuthParams?: Record<string, string>
}

/** Result of starting an authorization-code flow. */
export interface AuthorizationCodeStart {
  /** The full URL the browser should be redirected to. */
  authorizationUrl: string
  /** The state token (also embedded in the URL). */
  state: string
  /** The PKCE verifier — must be persisted for the token exchange step. */
  pkceVerifier?: string
  /** The redirect URI used (echoed back for the token exchange). */
  redirectUri: string
}

/** Token response from the provider. */
export interface TokenResponse {
  access_token: string
  refresh_token?: string
  expires_in?: number
  token_type?: string
  scope?: string
  id_token?: string
  /** RFC 8707: resource parameter echoed back. */
  resource?: string
  error?: string
  error_description?: string
  [k: string]: unknown
}

/** Parameters for refreshing a token. */
export interface RefreshParams {
  tokenUrl: string
  refreshToken: string
  clientId: string
  clientSecret?: string
  /** Optional scope override (rare). */
  scope?: string
  /** Optional resource (RFC 8707) — should match the original. */
  resource?: string
}

// ─── PKCE ───────────────────────────────────────────────────────────────────

/**
 * Generate a PKCE verifier + challenge pair (RFC 7636, S256 method).
 * The verifier is a random 43-128 char string (we use 64 base64url chars).
 * The challenge is base64url( SHA256( verifier ) ).
 */
export function generatePkcePair(): PkcePair {
  const verifier = randomBytes(48).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}

// ─── State token ────────────────────────────────────────────────────────────

/** Generate a random state token (32 bytes, base64url). */
export function generateStateToken(): string {
  return randomBytes(32).toString('base64url')
}

// ─── URL building ───────────────────────────────────────────────────────────

/**
 * Build the full authorization URL for the code flow.
 *
 * Implements:
 *   - response_type=code
 *   - client_id, redirect_uri, scope, state
 *   - code_challenge + code_challenge_method=S256 (when usePkce=true, default)
 *   - resource (RFC 8707) when provided
 *   - access_type=offline + prompt=consent (Google-specific, ignored by others)
 */
export function buildAuthorizationUrl(opts: AuthorizationCodeParams): AuthorizationCodeStart {
  const state = opts.state || generateStateToken()
  const usePkce = opts.usePkce !== false
  const pkcePair = usePkce ? generatePkcePair() : undefined

  const params = new URLSearchParams({
    client_id: opts.clientId,
    redirect_uri: opts.redirectUri,
    response_type: 'code',
    state,
  })
  if (opts.scope && opts.scope.trim()) {
    params.set('scope', opts.scope.trim())
  }
  if (pkcePair) {
    params.set('code_challenge', pkcePair.challenge)
    params.set('code_challenge_method', PKCE_METHOD)
  }
  if (opts.resource) {
    params.set('resource', opts.resource)
  }
  // access_type=offline + prompt=consent — Google needs these to issue a
  // refresh token. Other providers ignore unknown params, so safe to set.
  params.set('access_type', 'offline')
  params.set('prompt', 'consent')
  if (opts.extraAuthParams) {
    for (const [k, v] of Object.entries(opts.extraAuthParams)) {
      params.set(k, v)
    }
  }

  const sep = opts.authorizationUrl.includes('?') ? '&' : '?'
  return {
    authorizationUrl: `${opts.authorizationUrl}${sep}${params.toString()}`,
    state,
    pkceVerifier: pkcePair?.verifier,
    redirectUri: opts.redirectUri,
  }
}

// ─── Token exchange ─────────────────────────────────────────────────────────

/**
 * Exchange an authorization code for tokens. POSTs to the token URL with
 * grant_type=authorization_code. Includes PKCE verifier when present.
 *
 * Spec: https://datatracker.ietf.org/doc/html/rfc6749#section-4.1.3
 * PKCE:  https://datatracker.ietf.org/doc/html/rfc7636#section-4.5
 */
export async function exchangeCodeForTokens(opts: {
  tokenUrl: string
  code: string
  redirectUri: string
  clientId: string
  clientSecret?: string
  pkceVerifier?: string
  /** RFC 8707 resource — must match the authorize request. */
  resource?: string
}): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: opts.code,
    redirect_uri: opts.redirectUri,
    client_id: opts.clientId,
  })
  if (opts.clientSecret) {
    body.set('client_secret', opts.clientSecret)
  }
  if (opts.pkceVerifier) {
    body.set('code_verifier', opts.pkceVerifier)
  }
  if (opts.resource) {
    body.set('resource', opts.resource)
  }
  return postToTokenEndpoint(opts.tokenUrl, body)
}

/**
 * Refresh an access token using a refresh token. POSTs grant_type=refresh_token.
 *
 * Spec: https://datatracker.ietf.org/doc/html/rfc6749#section-6
 *
 * NOTE: some providers (Google with access_type=offline + prompt=consent)
 * return a NEW refresh_token on each refresh; others keep the original.
 * Callers should update the stored refresh_token if a new one is returned.
 */
export async function refreshAccessToken(opts: RefreshParams): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: opts.refreshToken,
    client_id: opts.clientId,
  })
  if (opts.clientSecret) {
    body.set('client_secret', opts.clientSecret)
  }
  if (opts.scope && opts.scope.trim()) {
    body.set('scope', opts.scope.trim())
  }
  if (opts.resource) {
    body.set('resource', opts.resource)
  }
  return postToTokenEndpoint(opts.tokenUrl, body)
}

/** POST a URLSearchParams body to a token endpoint, parse the response. */
async function postToTokenEndpoint(
  tokenUrl: string,
  body: URLSearchParams,
): Promise<TokenResponse> {
  const resp = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: body.toString(),
  })
  const text = await resp.text()
  // Most providers return JSON; some return form-encoded. Try JSON first.
  try {
    return JSON.parse(text) as TokenResponse
  } catch {
    const out: Record<string, string> = {}
    for (const pair of text.split('&')) {
      const [k, v] = pair.split('=')
      if (k) out[decodeURIComponent(k)] = decodeURIComponent(v ?? '')
    }
    return out as unknown as TokenResponse
  }
}

// ─── Loopback redirect (local-first) ────────────────────────────────────────

/**
 * Loopback redirect listener for local-first OAuth.
 *
 * Spins up a transient HTTP server on 127.0.0.1:<random port>, returns the
 * redirect URI the caller should use, and resolves with the authorization
 * code when the browser hits the callback. The server shuts down immediately
 * after capturing the code (one-shot).
 *
 * CRITICAL: we pin to 127.0.0.1 (the IP literal), NOT the string "localhost".
 * OAuth providers treat 127.0.0.1 and localhost as different redirect URIs,
 * and a mismatch between the registered URI and the request URI silently
 * breaks token exchange with a "redirect_uri_mismatch" error. This is a
 * classic time-sink bug.
 *
 * In Tauri, this listener is owned by Rust (tauri-plugin-shell) and the
 * browser opens via the OS default handler. In the Next.js server context,
 * the listener runs in-process and the user opens the auth URL in their
 * browser manually.
 *
 * The listener times out after `timeoutMs` (default 5 minutes) if no
 * callback arrives.
 */
export interface LoopbackCallback {
  /** The authorization code, if the user authorized. */
  code?: string
  /** The state token from the callback. */
  state?: string
  /** The error, if the user denied or the provider returned an error. */
  error?: string
  error_description?: string
}

export interface LoopbackListener {
  /** The redirect URI to use in the authorize request. */
  redirectUri: string
  /** The port the listener is bound to. */
  port: number
  /** A promise that resolves with the callback result. */
  callback: Promise<LoopbackCallback>
  /** Force-shutdown the listener (e.g. if the user cancels). */
  close: () => void
}

/**
 * Start a loopback listener. Returns immediately with the redirect URI + a
 * promise that resolves when the callback arrives. The listener auto-closes
 * after the first callback OR after `timeoutMs`, whichever comes first.
 */
export function startLoopbackListener(opts?: {
  timeoutMs?: number
  /** Optional: a fixed port to bind (default: random ephemeral). */
  port?: number
  /** Optional: a path for the callback (default: /callback). */
  path?: string
}): LoopbackListener {
  const timeoutMs = opts?.timeoutMs ?? 5 * 60 * 1000
  const path = opts?.path ?? '/callback'
  const port = opts?.port ?? 0 // 0 = ephemeral

  let server: Server | null = null
  let timer: NodeJS.Timeout | null = null
  let resolveFn: ((v: LoopbackCallback) => void) | null = null

  const callback = new Promise<LoopbackCallback>((resolve) => {
    resolveFn = resolve

    server = createServer((req, res) => {
      const url = new URL(req.url || '/', `http://127.0.0.1`)
      if (url.pathname !== path) {
        res.statusCode = 404
        res.end('Not found')
        return
      }
      const code = url.searchParams.get('code') || undefined
      const state = url.searchParams.get('state') || undefined
      const error = url.searchParams.get('error') || undefined
      const error_description =
        url.searchParams.get('error_description') || undefined

      // Send a friendly HTML response so the user sees something.
      res.statusCode = 200
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      if (error) {
        res.end(
          `<html><body><h2>Authorization denied</h2><p>${escapeHtml(error)}${error_description ? ': ' + escapeHtml(error_description) : ''}</p><p>You can close this tab and return to Apical.</p></body></html>`,
        )
      } else if (code) {
        res.end(
          '<html><body><h2>Authorization complete</h2><p>You can close this tab and return to Apical.</p></body></html>',
        )
      } else {
        res.end(
          '<html><body><h2>Waiting for authorization…</h2></body></html>',
        )
      }

      // Resolve + shut down. One-shot.
      if (resolveFn) {
        resolveFn({ code, state, error, error_description })
        resolveFn = null
      }
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      if (server) {
        server.close()
        server = null
      }
    })

    server.listen(port, '127.0.0.1', () => {
      // Listener is up.
    })

    timer = setTimeout(() => {
      if (resolveFn) {
        resolveFn({ error: 'timeout', error_description: 'Loopback listener timed out waiting for callback.' })
        resolveFn = null
      }
      if (server) {
        server.close()
        server = null
      }
    }, timeoutMs)
  })

  // Determine the actual bound port (ephemeral). The listener may still be
  // in the process of binding when we reach this point, so we read the
  // address defensively. We use a type assertion because TS's flow analysis
  // can't see that the Promise executor assigned `server` synchronously
  // (createServer's listen callback is async, but the Server object is
  // assigned immediately).
  let boundPort = port
  const serverAny = server as Server | null
  if (serverAny) {
    try {
      const addr = serverAny.address()
      if (addr && typeof addr === 'object' && typeof addr.port === 'number') {
        boundPort = addr.port
      }
    } catch {
      // ignore — fall back to the requested port
    }
  }
  const redirectUri = `http://127.0.0.1:${boundPort}${path}`

  const close = () => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    if (server) {
      server.close()
      server = null
    }
    if (resolveFn) {
      resolveFn({ error: 'cancelled' })
      resolveFn = null
    }
  }

  return { redirectUri, port: boundPort, callback, close }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// ─── RFC 9728: OAuth 2.0 Protected Resource Metadata ────────────────────────

/**
 * Protected Resource Metadata (RFC 9728). Returned by the
 * `/.well-known/oauth-protected-resource` endpoint of a resource server
 * (e.g. a remote MCP server). Tells the client where the authorization
 * server is + what scopes/resources are required.
 */
export interface ProtectedResourceMetadata {
  /** The resource identifier (RFC 8707). Sent as `resource` in the auth request. */
  resource?: string
  /** URLs of authorization servers protecting this resource. */
  authorization_servers?: string[]
  /** Scopes required to access this resource. */
  scopes_supported?: string[]
  /** Bearer token methods supported. */
  bearer_methods_supported?: string[]
  /** JWK set URL for validating resource-signed tokens (rare). */
  jwks_uri?: string
  /** Other fields per RFC 9728. */
  [k: string]: unknown
}

/**
 * Fetch + parse the Protected Resource Metadata for a resource server.
 * Returns null if the endpoint returns 404 (server doesn't implement RFC 9728)
 * or the response is unparseable.
 *
 * Spec: https://datatracker.ietf.org/doc/html/rfc9728
 */
export async function discoverProtectedResourceMetadata(
  resourceUrl: string,
): Promise<ProtectedResourceMetadata | null> {
  let baseUrl: URL
  try {
    baseUrl = new URL(resourceUrl)
  } catch {
    return null
  }
  const metadataUrl = `${baseUrl.origin}/.well-known/oauth-protected-resource`

  try {
    const resp = await fetch(metadataUrl, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    })
    if (!resp.ok) return null
    return (await resp.json()) as ProtectedResourceMetadata
  } catch {
    return null
  }
}

/**
 * Authorization Server Metadata (RFC 8414). Returned by the authorization
 * server's `/.well-known/oauth-authorization-server` endpoint. Tells the
 * client the authorize/token URLs + supported features.
 */
export interface AuthorizationServerMetadata {
  issuer?: string
  authorization_endpoint?: string
  token_endpoint?: string
  registration_endpoint?: string // DCR — we don't use this
  scopes_supported?: string[]
  response_types_supported?: string[]
  grant_types_supported?: string[]
  code_challenge_methods_supported?: string[]
  /** RFC 8707 — does the AS support resource indicators? */
  resource_indicators?: boolean
  [k: string]: unknown
}

/**
 * Fetch + parse the Authorization Server Metadata.
 * Returns null if the endpoint returns 404 or is unparseable.
 *
 * Spec: https://datatracker.ietf.org/doc/html/rfc8414
 */
export async function discoverAuthorizationServerMetadata(
  authorizationServerUrl: string,
): Promise<AuthorizationServerMetadata | null> {
  let baseUrl: URL
  try {
    baseUrl = new URL(authorizationServerUrl)
  } catch {
    return null
  }
  const metadataUrl = `${baseUrl.origin}/.well-known/oauth-authorization-server`

  try {
    const resp = await fetch(metadataUrl, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    })
    if (!resp.ok) return null
    return (await resp.json()) as AuthorizationServerMetadata
  } catch {
    return null
  }
}

// ─── Vault integration ──────────────────────────────────────────────────────

/**
 * Persist a token response as a Credential row owned by `userId`.
 *
 * The access + refresh tokens are encrypted via the vault (AES-256-GCM).
 * The Credential references the provider by key (e.g. "google", "github",
 * or for MCP: "mcp:<server-url>"). If an existing active credential exists
 * for the same (userId, provider, kind=oauth), it's updated in place.
 *
 * Returns the credential ID.
 */
export async function persistOAuthCredential(opts: {
  userId: string
  /** Provider key — for MCP, use "mcp:<server-url>". */
  providerKey: string
  /** Display name for the credential (e.g. "Google — OAuth"). */
  label: string
  tokens: TokenResponse
  /** Non-secret metadata (scopes, token type, connected-at, etc.). */
  meta?: Record<string, unknown>
  /** Optional: existing credential ID to update (instead of upserting). */
  existingCredentialId?: string
}): Promise<string> {
  const expiresAt =
    typeof opts.tokens.expires_in === 'number' && opts.tokens.expires_in > 0
      ? new Date(Date.now() + opts.tokens.expires_in * 1000)
      : null

  const meta: Record<string, unknown> = {
    provider: opts.providerKey,
    tokenType: opts.tokens.token_type || 'Bearer',
    scopes: opts.tokens.scope || '',
    connectedVia: 'oauth',
    connectedAt: new Date().toISOString(),
    ...(opts.meta || {}),
  }

  const encAccessToken = encrypt(opts.tokens.access_token)
  const encRefreshToken = opts.tokens.refresh_token
    ? encrypt(opts.tokens.refresh_token)
    : null

  // Upsert: if existingCredentialId is provided, update; otherwise look up
  // by (userId, providerKey, kind=oauth) and update or create.
  if (opts.existingCredentialId) {
    await db.credential.update({
      where: { id: opts.existingCredentialId },
      data: {
        status: 'active',
        oauthAccessToken: encAccessToken,
        oauthRefreshToken: encRefreshToken,
        oauthExpiresAt: expiresAt,
        metaJson: JSON.stringify(meta),
      },
    })
    return opts.existingCredentialId
  }

  const existing = await db.credential.findFirst({
    where: {
      userId: opts.userId,
      oauthProvider: opts.providerKey,
      kind: 'oauth',
    },
    orderBy: { createdAt: 'desc' },
  })

  if (existing) {
    // If the new response doesn't include a refresh_token, keep the existing
    // one (some providers only return refresh_token on the first authorize).
    const finalRefresh = encRefreshToken ?? existing.oauthRefreshToken
    await db.credential.update({
      where: { id: existing.id },
      data: {
        status: 'active',
        oauthAccessToken: encAccessToken,
        oauthRefreshToken: finalRefresh,
        oauthExpiresAt: expiresAt,
        metaJson: JSON.stringify(meta),
      },
    })
    return existing.id
  }

  const created = await db.credential.create({
    data: {
      userId: opts.userId,
      service: opts.providerKey,
      label: opts.label,
      kind: 'oauth',
      status: 'active',
      oauthProvider: opts.providerKey,
      oauthAccessToken: encAccessToken,
      oauthRefreshToken: encRefreshToken,
      oauthExpiresAt: expiresAt,
      metaJson: JSON.stringify(meta),
      agentProvisioned: false,
      canPay: false,
    },
  })
  return created.id
}

/**
 * Resolve an OAuth credential by ID and return the decrypted refresh token.
 * Used by the refresh path.
 */
export async function loadOAuthCredential(credentialId: string): Promise<{
  ok: boolean
  accessToken?: string
  refreshToken?: string
  expiresAt?: Date
  providerKey?: string
  clientId?: string
  clientSecret?: string
  tokenUrl?: string
  resource?: string
  error?: string
}> {
  const cred = await db.credential.findUnique({ where: { id: credentialId } })
  if (!cred) return { ok: false, error: 'not_found' }
  if (cred.kind !== 'oauth' || !cred.oauthProvider) {
    return { ok: false, error: 'not_an_oauth_credential' }
  }

  const accessToken = cred.oauthAccessToken
    ? tryDecrypt(cred.oauthAccessToken)
    : null
  const refreshToken = cred.oauthRefreshToken
    ? tryDecrypt(cred.oauthRefreshToken)
    : null

  // Resolve the provider's tokenUrl + client credentials. For non-MCP
  // providers, look up OAuthProvider. For MCP, the metadata is in metaJson.
  const provider = await db.oAuthProvider.findUnique({
    where: { key: cred.oauthProvider },
  })

  let clientId = provider?.clientId?.trim() || ''
  let clientSecret = provider?.clientSecret?.trim() || ''
  let tokenUrl = provider?.tokenUrl || ''
  let resource: string | undefined

  // BYO client credentials stashed in metaJson.
  let meta: Record<string, unknown> = {}
  try {
    meta = JSON.parse(cred.metaJson || '{}') as Record<string, unknown>
  } catch {
    // ignore
  }
  if (!clientId && typeof meta.customClientId === 'string') {
    clientId = meta.customClientId
  }
  if (!clientSecret && typeof meta.customClientSecret === 'string') {
    clientSecret = meta.customClientSecret
  }
  if (typeof meta.tokenUrl === 'string') tokenUrl = meta.tokenUrl
  if (typeof meta.resource === 'string') resource = meta.resource

  return {
    ok: true,
    accessToken: accessToken || undefined,
    refreshToken: refreshToken || undefined,
    expiresAt: cred.oauthExpiresAt || undefined,
    providerKey: cred.oauthProvider,
    clientId,
    clientSecret,
    tokenUrl,
    resource,
  }
}

/** Best-effort vault decrypt — returns null on non-vault-shaped input. */
function tryDecrypt(stored: string): string | null {
  const parts = stored.split(':')
  if (parts.length !== 3) return null
  try {
    return decrypt(stored)
  } catch {
    return null
  }
}

// ─── Full refresh-and-persist cycle ─────────────────────────────────────────

/**
 * Refresh a credential's access token AND persist the new tokens to the vault.
 * This is the high-level entry point used by the scheduler cron + the manual
 * refresh route. Returns `{ ok, credentialId, error? }`.
 *
 * On `invalid_grant` (refresh token rejected by the provider), marks the
 * credential `status: 'expired'` so the UI can prompt the user to re-auth.
 */
export async function refreshAndPersistCredential(credentialId: string): Promise<{
  ok: boolean
  credentialId: string
  error?: string
}> {
  const loaded = await loadOAuthCredential(credentialId)
  if (!loaded.ok) {
    return { ok: false, credentialId, error: loaded.error }
  }
  if (!loaded.refreshToken) {
    return { ok: false, credentialId, error: 'no_refresh_token' }
  }
  if (!loaded.clientId) {
    return { ok: false, credentialId, error: 'missing_client_credentials' }
  }
  if (!loaded.tokenUrl) {
    return { ok: false, credentialId, error: 'missing_token_url' }
  }

  const tokens = await refreshAccessToken({
    tokenUrl: loaded.tokenUrl,
    refreshToken: loaded.refreshToken,
    clientId: loaded.clientId,
    clientSecret: loaded.clientSecret,
    resource: loaded.resource,
  })

  if (tokens.error || !tokens.access_token) {
    if (tokens.error === 'invalid_grant' || tokens.error === 'invalid_token') {
      await db.credential.update({
        where: { id: credentialId },
        data: { status: 'expired' },
      })
    }
    return {
      ok: false,
      credentialId,
      error: tokens.error_description || tokens.error || 'no_access_token',
    }
  }

  await persistOAuthCredential({
    userId: (await db.credential.findUnique({ where: { id: credentialId }, select: { userId: true } }))?.userId || '',
    providerKey: loaded.providerKey || '',
    label: '', // unused on update
    tokens,
    existingCredentialId: credentialId,
  })

  return { ok: true, credentialId }
}

/**
 * Bulk refresh every active OAuth credential whose access token expires within
 * `withinMs` (default 1 hour) or has already expired. Returns a summary.
 */
export async function refreshExpiringCredentials(
  withinMs = 60 * 60 * 1000,
): Promise<{
  checked: number
  refreshed: number
  failed: number
  details: Array<{ credentialId: string; ok: boolean; error?: string }>
}> {
  const cutoff = new Date(Date.now() + withinMs)
  const rows = await db.credential.findMany({
    where: {
      kind: 'oauth',
      status: 'active',
      oauthProvider: { not: null },
      oauthRefreshToken: { not: null },
      OR: [
        { oauthExpiresAt: { lte: cutoff } },
        { oauthExpiresAt: null },
      ],
    },
  })

  const details: Array<{ credentialId: string; ok: boolean; error?: string }> = []
  let refreshed = 0
  let failed = 0

  for (const row of rows) {
    const result = await refreshAndPersistCredential(row.id)
    details.push({
      credentialId: row.id,
      ok: result.ok,
      error: result.ok ? undefined : result.error,
    })
    if (result.ok) refreshed++
    else failed++
  }

  return { checked: rows.length, refreshed, failed, details }
}
