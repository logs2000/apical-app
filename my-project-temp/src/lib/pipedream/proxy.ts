// Apical — Pipedream Connect API proxy.
//
// The escape hatch when the curated MCP tools don't cover an endpoint: the
// agent's http_request tool routes here whenever the referenced credential is
// kind="pipedream". Pipedream injects the connected account's auth into the
// upstream request; the third-party token never touches Apical.

import { getPipedreamConfig } from './config'
import { pdFetch, connectPath } from './client'

export interface ProxyRequest {
  url: string
  method?: string
  headers?: Record<string, string>
  body?: string | null
}

export interface ProxyResponse {
  ok: boolean
  status: number
  body: string
  error: string | null
}

/** Base64url-encode the upstream URL (the proxy's addressing scheme). */
function encodeUpstreamUrl(url: string): string {
  return Buffer.from(url, 'utf8').toString('base64url')
}

/**
 * Make an authenticated upstream request on behalf of a connected account.
 * Caller headers are forwarded with the `x-pd-proxy-` prefix per the proxy
 * contract; auth-shaped headers are dropped (Pipedream owns auth injection).
 */
export async function proxyFetch(
  userId: string,
  accountId: string,
  req: ProxyRequest,
): Promise<ProxyResponse> {
  const cfg = getPipedreamConfig()
  if (!cfg) return { ok: false, status: 0, body: '', error: 'Pipedream is not configured' }
  if (!userId || !accountId) {
    return { ok: false, status: 0, body: '', error: 'Missing user or account id for proxy request' }
  }

  const params = new URLSearchParams({
    external_user_id: userId,
    account_id: accountId,
  })
  const path = connectPath(`/proxy/${encodeUpstreamUrl(req.url)}?${params.toString()}`)
  if (!path) return { ok: false, status: 0, body: '', error: 'Pipedream is not configured' }

  const forwarded: Record<string, string> = {}
  for (const [key, value] of Object.entries(req.headers ?? {})) {
    const lower = key.toLowerCase()
    if (lower === 'authorization' || lower === 'cookie' || lower.startsWith('x-pd-')) continue
    forwarded[`x-pd-proxy-${key}`] = value
  }

  const method = (req.method || 'GET').toUpperCase()
  const res = await pdFetch<unknown>(path, {
    method,
    headers: forwarded,
    body: method === 'GET' || method === 'HEAD' ? undefined : req.body ?? undefined,
  })

  const body =
    res.data === null || res.data === undefined
      ? ''
      : typeof res.data === 'string'
        ? res.data
        : JSON.stringify(res.data)

  return { ok: res.ok, status: res.status, body, error: res.error }
}
