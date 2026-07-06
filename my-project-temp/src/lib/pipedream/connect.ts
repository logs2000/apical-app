// Apical — Pipedream Connect: token minting + connected-account management.
//
// external_user_id is ALWAYS the Apical userId: credentials are userId-scoped
// throughout the runtime (resolveCredentialForAgent, getOAuthToken), so the
// Pipedream identity must match. Connections are personal in v1.

import { getPipedreamConfig } from './config'
import { pdFetch, connectPath } from './client'

export interface ConnectTokenResult {
  token: string
  expiresAt: string | null
  connectLinkUrl: string | null
}

export interface PipedreamAccount {
  id: string
  externalUserId: string | null
  app: string | null
  appName: string | null
  name: string | null
  healthy: boolean
  createdAt: string | null
}

interface RawAccount {
  id?: string
  external_user_id?: string
  external_id?: string
  name?: string
  healthy?: boolean
  created_at?: string
  app?: { name_slug?: string; name?: string } | string
}

function mapAccount(raw: RawAccount): PipedreamAccount {
  const app =
    typeof raw.app === 'string' ? raw.app : raw.app?.name_slug ?? null
  const appName = typeof raw.app === 'string' ? raw.app : raw.app?.name ?? null
  return {
    id: raw.id ?? '',
    externalUserId: raw.external_user_id ?? raw.external_id ?? null,
    app,
    appName,
    name: raw.name ?? null,
    healthy: raw.healthy !== false,
    createdAt: raw.created_at ?? null,
  }
}

/**
 * Mint a short-lived Connect token for a user (the client uses it to open the
 * Pipedream auth iframe/popup). Also returns the hosted Connect Link URL as
 * the SDK-free fallback.
 */
export async function createConnectToken(
  userId: string,
  opts?: { app?: string },
): Promise<{ result: ConnectTokenResult | null; error: string | null }> {
  const cfg = getPipedreamConfig()
  const path = connectPath('/tokens')
  if (!cfg || !path) return { result: null, error: 'Pipedream is not configured' }

  const res = await pdFetch<{
    token?: string
    expires_at?: string
    connect_link_url?: string
  }>(path, {
    method: 'POST',
    body: JSON.stringify({
      external_user_id: userId,
      allowed_origins: cfg.allowedOrigins,
    }),
  })
  if (!res.ok || !res.data?.token) {
    return { result: null, error: res.error || 'Failed to create connect token' }
  }
  let connectLinkUrl = res.data.connect_link_url ?? null
  if (connectLinkUrl && opts?.app) {
    const sep = connectLinkUrl.includes('?') ? '&' : '?'
    connectLinkUrl = `${connectLinkUrl}${sep}app=${encodeURIComponent(opts.app)}`
  }
  return {
    result: {
      token: res.data.token,
      expiresAt: res.data.expires_at ?? null,
      connectLinkUrl,
    },
    error: null,
  }
}

/** Fetch a single connected account by its `apn_...` id. */
export async function getAccount(accountId: string): Promise<PipedreamAccount | null> {
  const path = connectPath(`/accounts/${encodeURIComponent(accountId)}`)
  if (!path) return null
  const res = await pdFetch<{ data?: RawAccount } & RawAccount>(path)
  if (!res.ok || !res.data) return null
  // Some endpoints wrap the resource in `data`, some don't — accept both.
  const raw = (res.data.data ?? res.data) as RawAccount
  if (!raw.id) return null
  return mapAccount(raw)
}

/** List a user's connected accounts, optionally filtered to one app slug. */
export async function listAccounts(
  userId: string,
  app?: string,
): Promise<PipedreamAccount[]> {
  const params = new URLSearchParams({ external_user_id: userId })
  if (app) params.set('app', app)
  const path = connectPath(`/accounts?${params.toString()}`)
  if (!path) return []
  const res = await pdFetch<{ data?: RawAccount[] }>(path)
  if (!res.ok || !Array.isArray(res.data?.data)) return []
  return res.data.data.map(mapAccount).filter((a) => a.id)
}

/** Delete a connected account upstream. Returns true on success or 404. */
export async function deleteAccount(accountId: string): Promise<boolean> {
  const path = connectPath(`/accounts/${encodeURIComponent(accountId)}`)
  if (!path) return false
  const res = await pdFetch(path, { method: 'DELETE' })
  return res.ok || res.status === 404
}
