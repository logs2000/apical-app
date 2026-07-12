// Apical — Pipedream REST client.
//
// Deliberately raw REST (no @pipedream/sdk on the server): the SDK's surface
// has churned between createBackendClient and the namespaced PipedreamClient,
// and the REST API is the stable contract. Auth is OAuth client-credentials
// against Pipedream using the project's client id/secret; the short-lived
// access token is cached in module memory with expiry skew.

import { getPipedreamConfig } from './config'

const API_BASE = 'https://api.pipedream.com/v1'
const TOKEN_URL = 'https://api.pipedream.com/v1/oauth/token'
/** Refresh the cached token this many ms before it actually expires. */
const EXPIRY_SKEW_MS = 60_000
const REQUEST_TIMEOUT_MS = 20_000

export interface PdResult<T = unknown> {
  ok: boolean
  status: number
  data: T | null
  error: string | null
}

let cachedToken: { value: string; expiresAt: number } | null = null

/** Acquire (or reuse) a Pipedream API access token via client credentials. */
export async function getPipedreamApiToken(): Promise<string | null> {
  const cfg = getPipedreamConfig()
  if (!cfg) return null
  if (cachedToken && Date.now() < cachedToken.expiresAt - EXPIRY_SKEW_MS) {
    return cachedToken.value
  }
  try {
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'client_credentials',
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (!res.ok) {
      console.error(`[pipedream] token request failed: HTTP ${res.status}`)
      return null
    }
    const body = (await res.json()) as { access_token?: string; expires_in?: number }
    if (!body.access_token) {
      console.error('[pipedream] token response missing access_token')
      return null
    }
    cachedToken = {
      value: body.access_token,
      expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
    }
    return cachedToken.value
  } catch (err) {
    console.error('[pipedream] token request errored:', err)
    return null
  }
}

/**
 * Fetch against the Pipedream API. Never throws — returns `{ok, status, data,
 * error}` (mirrors the mcp-client convention). Injects Bearer auth and
 * X-PD-Environment on every call.
 */
export async function pdFetch<T = unknown>(
  path: string,
  init?: RequestInit & { skipEnvironmentHeader?: boolean },
): Promise<PdResult<T>> {
  const cfg = getPipedreamConfig()
  if (!cfg) {
    return { ok: false, status: 0, data: null, error: 'Pipedream is not configured' }
  }
  const token = await getPipedreamApiToken()
  if (!token) {
    return { ok: false, status: 0, data: null, error: 'Failed to authenticate with Pipedream' }
  }
  try {
    const { skipEnvironmentHeader, ...rest } = init ?? {}
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(skipEnvironmentHeader ? {} : { 'X-PD-Environment': cfg.environment }),
      ...((rest.headers as Record<string, string>) ?? {}),
    }
    const res = await fetch(`${API_BASE}${path}`, {
      ...rest,
      headers,
      signal: rest.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    const text = await res.text()
    let data: T | null = null
    if (text) {
      try {
        data = JSON.parse(text) as T
      } catch {
        // Non-JSON body — surface it as the error on failures.
        if (!res.ok) {
          return { ok: false, status: res.status, data: null, error: text.slice(0, 500) }
        }
      }
    }
    if (!res.ok) {
      const message =
        (data as { error?: string } | null)?.error || `Pipedream API error: HTTP ${res.status}`
      return { ok: false, status: res.status, data, error: message }
    }
    return { ok: true, status: res.status, data, error: null }
  } catch (err) {
    return {
      ok: false,
      status: 0,
      data: null,
      error: err instanceof Error ? err.message : 'Pipedream request failed',
    }
  }
}

/** The project-scoped Connect API prefix, e.g. `/connect/proj_xxx`. */
export function connectPath(suffix: string): string | null {
  const cfg = getPipedreamConfig()
  if (!cfg) return null
  return `/connect/${cfg.projectId}${suffix}`
}
