// Apical — A1: MCP OAuth 2.1 client (the strategic centerpiece).
//
// Per the governing architecture: Apical is a runtime that authenticates
// against and invokes arbitrary MCP servers — not a connector catalog. The
// MCP ecosystem is 9,000+ servers; we ride it by building ONE competent
// MCP authorization client. This module is that client.
//
// TWO AUTH PATHS (per A1 spec):
//
//   1. Static token (majority of MCP servers today). The user provides an
//      API key / PAT / bearer token. We stash it in the vault as a
//      `mcp_token` credential and inject it as a header on every request.
//      No OAuth dance.
//
//   2. OAuth 2.1 (modern remote MCP servers). The server publishes Protected
//      Resource Metadata (RFC 9728) at
//      /.well-known/oauth-protected-resource. We:
//        a. Discover the metadata → find the authorization server URL.
//        b. Discover the AS metadata (RFC 8414) → find authorize/token URLs.
//        c. Run authorization-code + PKCE (S256) via F1.
//        d. Include the `resource` parameter (RFC 8707) so the AS issues
//           a token scoped to this MCP server specifically.
//        e. Persist tokens in the vault; refresh on expiry via F1's cron.
//
// LOCAL stdio MCP servers fit local-first directly: the vault/keychain
// secret is injected as an ENV VAR at spawn time. No OAuth needed for local
// servers in the vast majority of cases.
//
// What we deliberately do NOT do:
//   - Dynamic Client Registration (DCR). Supported by only a small fraction
//     of authorization servers. Static client credentials + PKCE cover the
//     realistic cases. DCR / Client ID Metadata Documents (July 2026 spec
//     revision) is a later enhancement.
//   - Per-server connector code. The OAuth 2.1 flow is parameterized by
//     the metadata document; we don't write server-specific logic.

import {
  buildAuthorizationUrl,
  exchangeCodeForTokens,
  refreshAccessToken,
  discoverProtectedResourceMetadata,
  discoverAuthorizationServerMetadata,
  generateStateToken,
  persistOAuthCredential,
  refreshAndPersistCredential,
  type ProtectedResourceMetadata,
  type AuthorizationServerMetadata,
  type TokenResponse,
} from './oauth-engine'
import { db } from '../db'
import { encrypt } from '../platform/vault'

// ─── Types ──────────────────────────────────────────────────────────────────

/** The result of probing an MCP server for its auth requirements. */
export interface McpAuthProbeResult {
  /** The MCP server URL that was probed. */
  serverUrl: string
  /** 'static' = server accepts a static token; 'oauth2' = server requires OAuth 2.1. */
  authType: 'static' | 'oauth2' | 'none'
  /** For oauth2: the Protected Resource Metadata (RFC 9728). */
  protectedResourceMetadata?: ProtectedResourceMetadata
  /** For oauth2: the Authorization Server Metadata (RFC 8414). */
  authorizationServerMetadata?: AuthorizationServerMetadata
  /** For oauth2: the resource identifier (RFC 8707) to send in the auth request. */
  resource?: string
  /** For oauth2: the authorization endpoint URL. */
  authorizationUrl?: string
  /** For oauth2: the token endpoint URL. */
  tokenUrl?: string
  /** For oauth2: scopes supported. */
  scopesSupported?: string[]
  /** Error message if the probe failed. */
  error?: string
}

/** Parameters for starting an MCP OAuth 2.1 flow. */
export interface McpOAuthStartParams {
  /** The MCP server URL (the resource we want a token for). */
  serverUrl: string
  /** The OAuth client_id (BYO — user registers their own client with the AS). */
  clientId: string
  /** The OAuth client_secret (empty for public clients using PKCE). */
  clientSecret?: string
  /** The redirect URI (must be a loopback URL for local-first). */
  redirectUri: string
  /** Optional scopes (defaults to whatever the AS metadata declares). */
  scope?: string
  /** Optional: a pre-fetched probe result (skip re-probing). */
  probe?: McpAuthProbeResult
}

/** The result of starting an MCP OAuth 2.1 flow. */
export interface McpOAuthStartResult {
  /** The URL the browser should be redirected to. */
  authorizationUrl: string
  /** The state token (for CSRF verification on callback). */
  state: string
  /** The PKCE verifier (must be persisted for token exchange). */
  pkceVerifier: string
  /** The redirect URI used. */
  redirectUri: string
  /** The resource identifier (RFC 8707) — sent to the AS. */
  resource?: string
  /** The token endpoint URL (for the exchange step). */
  tokenUrl: string
  /** The MCP server URL (the resource). */
  serverUrl: string
}

// ─── Probe ──────────────────────────────────────────────────────────────────

/**
 * Probe an MCP server to determine its auth requirements.
 *
 * Flow:
 *   1. GET /.well-known/oauth-protected-resource (RFC 9728).
 *      - 200 + JSON → server requires OAuth 2.1. Metadata tells us the AS URL.
 *      - 404 → server doesn't implement RFC 9728. Assume static token.
 *   2. (If OAuth 2.1) GET <AS>/.well-known/oauth-authorization-server (RFC 8414).
 *      - 200 + JSON → AS metadata with authorize/token URLs.
 *      - 404 → fall back to static token (server's OAuth isn't discoverable).
 *
 * This is non-destructive: it never modifies state, just reads metadata.
 */
export async function probeMcpAuth(serverUrl: string): Promise<McpAuthProbeResult> {
  let baseUrl: URL
  try {
    baseUrl = new URL(serverUrl)
  } catch {
    return { serverUrl, authType: 'none', error: `Invalid URL: ${serverUrl}` }
  }

  // Step 1: Protected Resource Metadata.
  const prm = await discoverProtectedResourceMetadata(baseUrl.toString())
  if (!prm) {
    // No RFC 9728 metadata → assume static token.
    return { serverUrl, authType: 'static' }
  }

  // Step 2: Authorization Server Metadata.
  // The PRM may list one or more authorization_servers; we use the first.
  const asUrl = prm.authorization_servers?.[0]
  if (!asUrl) {
    // PRM exists but no AS listed → treat as static (broken metadata).
    return {
      serverUrl,
      authType: 'static',
      protectedResourceMetadata: prm,
      error: 'PRM has no authorization_servers',
    }
  }

  const asm = await discoverAuthorizationServerMetadata(asUrl)
  if (!asm || !asm.authorization_endpoint || !asm.token_endpoint) {
    return {
      serverUrl,
      authType: 'static',
      protectedResourceMetadata: prm,
      error: 'AS metadata missing authorization_endpoint or token_endpoint',
    }
  }

  return {
    serverUrl,
    authType: 'oauth2',
    protectedResourceMetadata: prm,
    authorizationServerMetadata: asm,
    resource: prm.resource,
    authorizationUrl: asm.authorization_endpoint,
    tokenUrl: asm.token_endpoint,
    scopesSupported: asm.scopes_supported,
  }
}

// ─── Start OAuth 2.1 flow ───────────────────────────────────────────────────

/**
 * Start an MCP OAuth 2.1 flow. Probes the server (if not pre-probed), then
 * builds the authorization URL with PKCE + resource indicator.
 *
 * Returns the URL the browser should be redirected to + the PKCE verifier
 * (which the caller must persist for the token exchange step).
 */
export async function startMcpOAuthFlow(
  params: McpOAuthStartParams,
): Promise<{ ok: true; result: McpOAuthStartResult } | { ok: false; error: string }> {
  const probe = params.probe || (await probeMcpAuth(params.serverUrl))
  if (probe.authType !== 'oauth2' || !probe.authorizationUrl || !probe.tokenUrl) {
    return {
      ok: false,
      error: probe.error || 'MCP server does not require OAuth 2.1 (use static token instead).',
    }
  }

  const scope = params.scope || (probe.scopesSupported || []).join(' ')
  const start = buildAuthorizationUrl({
    authorizationUrl: probe.authorizationUrl,
    tokenUrl: probe.tokenUrl,
    clientId: params.clientId,
    clientSecret: params.clientSecret,
    scope,
    redirectUri: params.redirectUri,
    resource: probe.resource,
    usePkce: true,
  })

  return {
    ok: true,
    result: {
      authorizationUrl: start.authorizationUrl,
      state: start.state,
      pkceVerifier: start.pkceVerifier!,
      redirectUri: start.redirectUri,
      resource: probe.resource,
      tokenUrl: probe.tokenUrl,
      serverUrl: params.serverUrl,
    },
  }
}

// ─── Complete OAuth 2.1 flow (token exchange + persist) ─────────────────────

/**
 * Complete an MCP OAuth 2.1 flow: exchange the authorization code for tokens
 * and persist them as a vault credential.
 *
 * The caller passes the code (from the callback), the start result (from
 * startMcpOAuthFlow), and the BYO client credentials. We exchange the code
 * with PKCE + resource indicator, then persist the tokens.
 *
 * Returns the credential ID on success.
 */
export async function completeMcpOAuthFlow(opts: {
  userId: string
  code: string
  start: McpOAuthStartResult
  clientId: string
  clientSecret?: string
}): Promise<{ ok: true; credentialId: string } | { ok: false; error: string }> {
  const tokens = await exchangeCodeForTokens({
    tokenUrl: opts.start.tokenUrl,
    code: opts.code,
    redirectUri: opts.start.redirectUri,
    clientId: opts.clientId,
    clientSecret: opts.clientSecret,
    pkceVerifier: opts.start.pkceVerifier,
    resource: opts.start.resource,
  })

  if (tokens.error || !tokens.access_token) {
    return {
      ok: false,
      error: tokens.error_description || tokens.error || 'no_access_token',
    }
  }

  // Persist as a credential keyed by the MCP server URL.
  // The provider key is "mcp:<server-url>" so multiple MCP servers don't collide.
  const providerKey = `mcp:${opts.start.serverUrl}`
  const meta = {
    mcpServerUrl: opts.start.serverUrl,
    resource: opts.start.resource,
    tokenUrl: opts.start.tokenUrl,
    customClientId: opts.clientId,
    customClientSecret: opts.clientSecret || '',
    scopes: tokens.scope || '',
  }

  const credentialId = await persistOAuthCredential({
    userId: opts.userId,
    providerKey,
    label: `MCP — ${opts.start.serverUrl}`,
    tokens,
    meta,
  })

  return { ok: true, credentialId }
}

// ─── Static token path ──────────────────────────────────────────────────────

/**
 * Persist a static token for an MCP server. Used by A1's static-token path
 * (the majority of MCP servers today authenticate with a static API key /
 * PAT / bearer token rather than full OAuth).
 *
 * The token is stored as an `mcp_token` credential in the vault. The runtime
 * injects it as `Authorization: Bearer <token>` (or a custom header) on
 * every request to this MCP server.
 */
export async function persistMcpStaticToken(opts: {
  userId: string
  serverUrl: string
  /** The static token (API key / PAT / bearer). */
  token: string
  /** Optional: a custom header name (default: "Authorization"). */
  headerName?: string
  /** Optional: a custom header value prefix (default: "Bearer "). */
  headerPrefix?: string
  /** Optional: a human label for the credential. */
  label?: string
}): Promise<string> {
  const providerKey = `mcp:${opts.serverUrl}`
  const encToken = encrypt(opts.token)
  const headerName = opts.headerName || 'Authorization'
  const headerPrefix = opts.headerPrefix ?? 'Bearer '

  const meta = {
    mcpServerUrl: opts.serverUrl,
    authType: 'static',
    headerName,
    headerPrefix,
    connectedVia: 'static_token',
    connectedAt: new Date().toISOString(),
  }

  // Upsert: if a credential for this (userId, providerKey, kind=mcp_token)
  // already exists, update it; otherwise create.
  const existing = await db.credential.findFirst({
    where: {
      userId: opts.userId,
      oauthProvider: providerKey,
      kind: 'mcp_token',
    },
    orderBy: { createdAt: 'desc' },
  })

  if (existing) {
    await db.credential.update({
      where: { id: existing.id },
      data: {
        status: 'active',
        // We stash the encrypted static token in oauthAccessToken for
        // uniformity with the OAuth path — the runtime resolves both
        // through the same `{{cred:<id>.key}}` resolver.
        oauthAccessToken: encToken,
        metaJson: JSON.stringify(meta),
      },
    })
    return existing.id
  }

  const created = await db.credential.create({
    data: {
      userId: opts.userId,
      service: providerKey,
      label: opts.label || `MCP — ${opts.serverUrl}`,
      kind: 'mcp_token',
      status: 'active',
      oauthProvider: providerKey,
      oauthAccessToken: encToken,
      metaJson: JSON.stringify(meta),
      agentProvisioned: false,
      canPay: false,
    },
  })
  return created.id
}

// ─── Refresh (delegates to F1) ──────────────────────────────────────────────

/**
 * Refresh an MCP OAuth 2.1 credential's access token. Delegates to F1's
 * `refreshAndPersistCredential` — MCP credentials are stored in the same
 * Credential table with the same shape, so the same refresh path works.
 */
export async function refreshMcpCredential(credentialId: string): Promise<{
  ok: boolean
  credentialId: string
  error?: string
}> {
  return refreshAndPersistCredential(credentialId)
}

// ─── TokenResponse re-export (for callers) ──────────────────────────────────

export type { TokenResponse }
