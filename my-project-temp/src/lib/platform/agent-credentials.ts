// Apical — credential resolution for agent tools.
//
// SECURITY MODEL (the "proxy/insulation" the user asked about):
//
//   The LLM NEVER sees raw secrets. When the agent needs to call an API that
//   requires auth, it passes a `credentialId` (a vault reference) in the tool
//   input. The server resolves the credentialId → secret server-side, injects
//   it into the request headers, and returns ONLY the response body to the
//   LLM. The secret never enters the LLM's context window.
//
//   This is the same pattern the workflow runtime uses (resolveCredRefs +
//   applyAuthToHeaders in src/lib/runtime.ts), exposed as a reusable helper
//   for the agent tools.
//
//   The agent tools that make network calls (http_request, web_read) accept
//   an optional `credentialId` parameter. When provided:
//     1. The server looks up the Credential row by id (scoped to the user).
//     2. Decrypts the secret from the vault (AES-256-GCM at rest).
//     3. Injects it into the request headers as Bearer / X-Api-Key / etc.
//        based on the credential's `kind` + `metaJson.headerName`.
//     4. STRIPS any auth-shaped headers the LLM tried to set directly
//        (Authorization, X-Api-Key, X-Auth-Token, etc.) so the LLM can't
//        exfiltrate keys via the headers parameter.
//
//   When `credentialId` is NOT provided, the call proceeds with whatever
//   headers the LLM specified — but auth-shaped headers are still stripped
//   (the LLM has no legitimate reason to set Authorization itself; if it
//   tries, that's a prompt-injection signal).

import { db } from '@/lib/db'
import { decrypt } from '@/lib/platform/vault'

/** Header names the LLM is NOT allowed to set directly. */
const STRIPPED_HEADER_NAMES = new Set([
  'authorization',
  'x-api-key',
  'x-auth-token',
  'x-auth',
  'proxy-authorization',
  'cookie',
  'set-cookie',
])

/** Best-effort vault decrypt. Returns null on non-vault-shaped input. */
function tryDecrypt(stored: string): string | null {
  const parts = stored.split(':')
  if (parts.length !== 3) return null
  try {
    return decrypt(stored)
  } catch {
    return null
  }
}

export interface ResolvedCredential {
  /** The decrypted secret value (NEVER returned to the LLM). */
  secret: string
  /** The credential kind — drives how the secret is injected. */
  kind: string
  /** The header name to inject into (for apikey kind). Default 'Authorization'. */
  headerName: string
  /** The header value prefix (for bearer/oauth). Default 'Bearer '. */
  headerPrefix: string
}

/**
 * Resolve a credentialId to a usable secret + injection metadata.
 * Returns null if the credential doesn't exist, isn't owned by the user,
 * or has no usable secret.
 */
export async function resolveCredentialForAgent(
  credentialId: string,
  userId: string,
): Promise<ResolvedCredential | null> {
  if (!credentialId || !userId) return null
  const row = await db.credential.findFirst({
    where: { id: credentialId, userId },
    select: {
      id: true,
      kind: true,
      status: true,
      oauthAccessToken: true,
      oauthProvider: true,
      metaJson: true,
    },
  })
  if (!row || row.status !== 'active') return null

  // Resolve the secret: prefer oauthAccessToken (decrypted); fall back to
  // metaJson.key / token / apikey / secret.
  let secret = ''
  if (row.oauthAccessToken) {
    secret = tryDecrypt(row.oauthAccessToken) || row.oauthAccessToken
  }
  if (!secret) {
    try {
      const meta = JSON.parse(row.metaJson || '{}') as Record<string, unknown>
      const candidates = [
        meta.key,
        meta.token,
        meta.apikey,
        meta.secret,
        meta.accessToken,
        meta.bearer,
      ]
      for (const v of candidates) {
        if (typeof v === 'string' && v.trim()) {
          // Values saved via the in-chat credential box are encrypted at rest.
          // Fall back to the raw value for legacy/plaintext rows.
          secret = (tryDecrypt(v.trim()) || v.trim()).trim()
          break
        }
      }
      // Also pick up the header name + prefix from meta if present.
      if (typeof meta.headerName === 'string') {
        // deferred to below
      }
    } catch {
      // ignore
    }
  }
  if (!secret) return null

  // Determine injection metadata based on kind + metaJson.
  let headerName = 'Authorization'
  let headerPrefix = 'Bearer '
  try {
    const meta = JSON.parse(row.metaJson || '{}') as Record<string, unknown>
    if (typeof meta.headerName === 'string' && meta.headerName.trim()) {
      headerName = meta.headerName.trim()
    }
    if (typeof meta.headerPrefix === 'string') {
      headerPrefix = meta.headerPrefix
    }
  } catch {
    // ignore
  }

  // kind-specific overrides.
  if (row.kind === 'apikey' || row.kind === 'mcp_token') {
    // apikey/mcp_token: inject as the configured header (default X-Api-Key
    // for apikey, Authorization for mcp_token — but metaJson.headerName wins).
    if (row.kind === 'apikey' && headerName === 'Authorization') {
      headerName = 'X-Api-Key'
      headerPrefix = ''
    }
  }

  return { secret, kind: row.kind, headerName, headerPrefix }
}

/**
 * Build the final headers for an agent tool's network call.
 *
 * 1. Strip any auth-shaped headers the LLM tried to set directly (security).
 * 2. If credentialId provided, resolve it + inject the secret.
 * 3. Return the merged headers.
 *
 * The secret is in the returned headers but NEVER returned to the LLM — the
 * caller (http_request / web_read) only returns the response body.
 */
export async function buildSecureHeaders(
  llmHeaders: Record<string, string> | undefined,
  credentialId: string | undefined,
  userId: string,
): Promise<{ headers: Record<string, string>; hadCredential: boolean }> {
  // 1. Strip auth-shaped headers the LLM tried to set.
  const headers: Record<string, string> = {}
  if (llmHeaders && typeof llmHeaders === 'object') {
    for (const [k, v] of Object.entries(llmHeaders)) {
      if (typeof v !== 'string') continue
      if (STRIPPED_HEADER_NAMES.has(k.toLowerCase())) continue
      headers[k] = v
    }
  }

  // 2. Resolve credential + inject.
  if (credentialId) {
    const cred = await resolveCredentialForAgent(credentialId, userId)
    if (cred) {
      headers[cred.headerName] = `${cred.headerPrefix}${cred.secret}`.trim()
      return { headers, hadCredential: true }
    }
    // Credential not found — surface a clear error to the LLM via the headers
    // (the caller will see the 401/403 and report it).
    return { headers, hadCredential: false }
  }

  return { headers, hadCredential: false }
}

/**
 * List the user's available credentials (for the agent to know what it can
 * reference by credentialId). Returns ONLY non-secret metadata — id, label,
 * kind, service, oauthProvider. NEVER the secret.
 *
 * Used by the `credential_list` agent tool.
 */
export async function listCredentialsForAgent(userId: string): Promise<
  Array<{
    id: string
    label: string
    kind: string
    service: string
    oauthProvider: string | null
    status: string
  }>
> {
  const rows = await db.credential.findMany({
    where: { userId, status: 'active' },
    select: {
      id: true,
      label: true,
      kind: true,
      service: true,
      oauthProvider: true,
      status: true,
    },
    orderBy: { createdAt: 'desc' },
  })
  return rows
}
