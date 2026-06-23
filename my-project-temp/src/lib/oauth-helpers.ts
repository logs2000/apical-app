// Apical — OAuth helpers shared between the API routes and the runtime.
//
// `getOAuthToken(service)` is the bridge between the credential vault and the
// workflow runtime: when a step references `{{cred:google.key}}` and the
// matching Credential row has an OAuth access token stored, the runtime pulls
// that token and injects it as a Bearer header (or whatever the step's auth
// spec dictates).

import { db } from './db'
import { decrypt, encrypt } from './platform/vault'

/**
 * Best-effort vault decrypt. Returns null if the input isn't a valid
 * vault-encrypted blob (legacy plaintext tokens survive this gracefully).
 * Vault ciphertexts have the shape `<iv>:<authTag>:<ciphertext>` (base64).
 */
function tryDecrypt(stored: string): string | null {
  // Quick shape check — vault blobs always have exactly two colons.
  const parts = stored.split(':')
  if (parts.length !== 3) return null
  try {
    return decrypt(stored)
  } catch {
    return null
  }
}

/** Decrypt helper exported for the runtime (which also reads oauth tokens). */
export function decryptOAuthToken(stored: string | null | undefined): string | null {
  if (!stored || !stored.trim()) return null
  const decrypted = tryDecrypt(stored)
  if (decrypted !== null) return decrypted
  // Legacy plaintext — return as-is so older rows still resolve.
  return stored
}

/**
 * The base URL of the app. Pulled from NEXTAUTH_URL (set by AUTH-1), defaulting
 * to localhost:3000 in dev. Used to build the OAuth redirect URI.
 */
export function getAppUrl(): string {
  return (process.env.NEXTAUTH_URL || 'http://localhost:3000').replace(/\/$/, '')
}

/**
 * The OAuth callback URL the frontend sends to providers. This is the URL the
 * provider redirects back to after the user authorizes.
 *
 * Configure this exact URL in your provider's OAuth client settings
 * (Google Cloud Console, GitHub OAuth Apps, Slack API, etc.).
 */
export function getOAuthRedirectUri(): string {
  return `${getAppUrl()}/api/oauth/callback`
}

/**
 * Read an OAuth access token for a given service from the credential vault.
 * Looks for a Credential with `oauthProvider == service` (case-insensitive),
 * or one whose `service` matches (so existing pre-OAuth credentials still
 * resolve). Returns null if no usable token is found.
 *
 * Used by the workflow runtime's `runHttpStep` to inject `Authorization:
 * Bearer <token>` when a step's auth ref points at an OAuth credential.
 */
export async function getOAuthToken(service: string): Promise<string | null> {
  const svc = service.trim()
  if (!svc) return null
  try {
    const row = await db.credential.findFirst({
      where: {
        OR: [
          { oauthProvider: svc.toLowerCase() },
          { service: { contains: svc } },
        ],
        status: 'active',
      },
      orderBy: { createdAt: 'desc' },
    })
    if (!row) return null
    // Prefer the dedicated OAuth access-token column. Tokens are stored
    // encrypted via vault.encrypt — decrypt before returning. Falls back to
    // plaintext for legacy rows that haven't been re-saved since the vault
    // migration (decryptOAuthToken returns the input as-is on decrypt failure).
    const accessToken = decryptOAuthToken(row.oauthAccessToken)
    if (accessToken) return accessToken.trim()
    // Fall back to metaJson.key / token / apikey / secret (legacy shape).
    try {
      const meta = JSON.parse(row.metaJson || '{}') as Record<string, unknown>
      const candidates = [meta.key, meta.token, meta.apikey, meta.secret, meta.accessToken]
      for (const v of candidates) {
        if (typeof v === 'string' && v.trim()) return v.trim()
      }
    } catch {
      // ignore parse error
    }
    return null
  } catch (err) {
    console.error('[oauth-helpers] getOAuthToken failed:', err)
    return null
  }
}

/**
 * Build the full authorization URL for a provider. Encodes the client_id,
 * redirect_uri, scope, response_type=code, and state.
 *
 * Spec: https://datatracker.ietf.org/doc/html/rfc6749#section-4.1.1
 */
export function buildAuthorizationUrl(opts: {
  authorizationUrl: string
  clientId: string
  redirectUri: string
  scopes: string
  state: string
}): string {
  const params = new URLSearchParams({
    client_id: opts.clientId,
    redirect_uri: opts.redirectUri,
    response_type: 'code',
    state: opts.state,
  })
  if (opts.scopes && opts.scopes.trim()) {
    params.set('scope', opts.scopes.trim())
  }
  // Some providers want `access_type=offline` + `prompt=consent` to issue a
  // refresh token (Google). We set it universally — providers that don't
  // recognize these params simply ignore them.
  params.set('access_type', 'offline')
  params.set('prompt', 'consent')
  const sep = opts.authorizationUrl.includes('?') ? '&' : '?'
  return `${opts.authorizationUrl}${sep}${params.toString()}`
}

/**
 * Exchange an authorization code for tokens. POSTs to the provider's token URL
 * with `grant_type=authorization_code`. Returns the parsed JSON (which should
 * contain access_token, refresh_token, expires_in, etc.).
 *
 * Spec: https://datatracker.ietf.org/doc/html/rfc6749#section-4.1.3
 */
export async function exchangeCodeForTokens(opts: {
  tokenUrl: string
  code: string
  redirectUri: string
  clientId: string
  clientSecret: string
}): Promise<{
  access_token?: string
  refresh_token?: string
  expires_in?: number
  token_type?: string
  scope?: string
  id_token?: string
  error?: string
  error_description?: string
  [k: string]: unknown
}> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: opts.code,
    redirect_uri: opts.redirectUri,
    client_id: opts.clientId,
    client_secret: opts.clientSecret,
  })
  const resp = await fetch(opts.tokenUrl, {
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
    return JSON.parse(text)
  } catch {
    const out: Record<string, string> = {}
    for (const pair of text.split('&')) {
      const [k, v] = pair.split('=')
      if (k) out[decodeURIComponent(k)] = decodeURIComponent(v ?? '')
    }
    return out
  }
}

/**
 * Refresh an OAuth access token using a refresh token. POSTs to the provider's
 * token URL with `grant_type=refresh_token`. Returns the parsed JSON.
 *
 * Spec: https://datatracker.ietf.org/doc/html/rfc6749#section-6
 *
 * NOTE: some providers (Google with `access_type=offline` + `prompt=consent`)
 * return a NEW refresh_token on each refresh; others (Slack, GitHub) keep the
 * original. Callers should update the stored refresh_token if a new one is
 * returned, otherwise keep the existing one.
 */
export async function refreshOAuthToken(opts: {
  tokenUrl: string
  refreshToken: string
  clientId: string
  clientSecret: string
  /** Optional scope override (rarely needed; most providers honor the original). */
  scope?: string
}): Promise<{
  access_token?: string
  refresh_token?: string
  expires_in?: number
  token_type?: string
  scope?: string
  error?: string
  error_description?: string
  [k: string]: unknown
}> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: opts.refreshToken,
    client_id: opts.clientId,
    client_secret: opts.clientSecret,
  })
  if (opts.scope && opts.scope.trim()) {
    body.set('scope', opts.scope.trim())
  }
  const resp = await fetch(opts.tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: body.toString(),
  })
  const text = await resp.text()
  try {
    return JSON.parse(text)
  } catch {
    const out: Record<string, string> = {}
    for (const pair of text.split('&')) {
      const [k, v] = pair.split('=')
      if (k) out[decodeURIComponent(k)] = decodeURIComponent(v ?? '')
    }
    return out
  }
}

/**
 * Refresh a single Credential row's OAuth access token using its stored
 * refresh token. Resolves the provider's clientId/clientSecret from the
 * OAuthProvider row (operator-configured) and falls back to the BYO
 * credentials stashed on the Credential's metaJson.
 *
 * On success: updates the Credential row in place with the new access token
 * (encrypted), new expiry, and (if returned) new refresh token. Returns
 * `{ ok: true, credentialId }`. On failure: returns `{ ok: false, error }`
 * and marks the credential `status: 'expired'` if the refresh token itself
 * was rejected (so the user is prompted to re-authenticate).
 */
export async function refreshCredential(credentialId: string): Promise<{
  ok: boolean
  credentialId: string
  error?: string
}> {
  const cred = await db.credential.findUnique({ where: { id: credentialId } })
  if (!cred) return { ok: false, credentialId, error: 'not_found' }
  if (cred.kind !== 'oauth' || !cred.oauthProvider) {
    return { ok: false, credentialId, error: 'not_an_oauth_credential' }
  }
  const refreshToken = decryptOAuthToken(cred.oauthRefreshToken)
  if (!refreshToken) {
    return { ok: false, credentialId, error: 'no_refresh_token' }
  }

  const provider = await db.oAuthProvider.findUnique({
    where: { key: cred.oauthProvider },
  })
  if (!provider) {
    return { ok: false, credentialId, error: 'unknown_provider' }
  }

  // Resolve client credentials: operator-configured first, BYO from metaJson
  // second. The BYO creds were stashed at /api/oauth/start time.
  let clientId = provider.clientId?.trim() || ''
  let clientSecret = provider.clientSecret?.trim() || ''
  if (!clientId || !clientSecret) {
    try {
      const meta = JSON.parse(cred.metaJson || '{}') as Record<string, unknown>
      const byoId = typeof meta.customClientId === 'string' ? meta.customClientId : ''
      const byoSecret =
        typeof meta.customClientSecret === 'string' ? meta.customClientSecret : ''
      if (byoId && byoSecret) {
        clientId = byoId
        clientSecret = byoSecret
      }
    } catch {
      // ignore
    }
  }
  if (!clientId || !clientSecret) {
    return { ok: false, credentialId, error: 'missing_client_credentials' }
  }

  const tokens = await refreshOAuthToken({
    tokenUrl: provider.tokenUrl,
    refreshToken,
    clientId,
    clientSecret,
  })

  if (tokens.error || !tokens.access_token) {
    // If the refresh token was rejected (invalid_grant), mark the credential
    // as expired so the UI can prompt the user to re-authenticate.
    if (
      tokens.error === 'invalid_grant' ||
      tokens.error === 'invalid_token'
    ) {
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

  const expiresAt =
    typeof tokens.expires_in === 'number' && tokens.expires_in > 0
      ? new Date(Date.now() + tokens.expires_in * 1000)
      : null

  // If the provider returned a new refresh token, store it; otherwise keep
  // the existing one.
  const newRefreshEncrypted = tokens.refresh_token
    ? encrypt(tokens.refresh_token)
    : cred.oauthRefreshToken

  // Update metaJson with refreshed-at timestamp (merge).
  let meta: Record<string, unknown> = {}
  try {
    meta = JSON.parse(cred.metaJson || '{}') as Record<string, unknown>
  } catch {
    // ignore
  }
  meta.lastRefreshedAt = new Date().toISOString()

  await db.credential.update({
    where: { id: credentialId },
    data: {
      status: 'active',
      oauthAccessToken: encrypt(tokens.access_token),
      oauthRefreshToken: newRefreshEncrypted,
      oauthExpiresAt: expiresAt,
      metaJson: JSON.stringify(meta),
    },
  })

  return { ok: true, credentialId }
}

/**
 * Find all OAuth credentials whose access tokens expire within the next hour
 * (or have already expired but still have a refresh token) and refresh them.
 * Designed to be called by a cron tick every ~5 minutes.
 *
 * Returns a summary: `{ checked, refreshed, failed, details }`.
 */
export async function refreshExpiringCredentials(withinMs = 60 * 60 * 1000): Promise<{
  checked: number
  refreshed: number
  failed: number
  details: Array<{ credentialId: string; ok: boolean; error?: string }>
}> {
  const cutoff = new Date(Date.now() + withinMs)
  // Find credentials that:
  //   - are OAuth kind
  //   - have a refresh token
  //   - have an expiry within the window OR have already expired
  //   - are currently active (don't touch revoked/expired manually)
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
    const result = await refreshCredential(row.id)
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

