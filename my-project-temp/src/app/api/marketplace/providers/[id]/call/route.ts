import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth-helpers'
import { marketplaceGate } from '@/lib/marketplace/gate'

// POST /api/marketplace/providers/[id]/call
//
// Proxy a single call to the provider's API. The caller supplies:
//   {
//     path: string,             // path appended to apiBaseUrl (e.g. "/v1/weather")
//     method?: string,          // default "GET"
//     headers?: Record<string,string>,
//     query?: Record<string,string>,
//     body?: unknown,           // JSON body (if method != GET)
//   }
//
// The proxy:
//   1. Looks up the provider (must be active + public, or owned by caller).
//   2. Validates the request shape.
//   3. Forwards the request to apiBaseUrl + path with the supplied method,
//      headers, query, and body. The caller is responsible for including
//      their own API key / Bearer token in `headers` — Apical doesn't add
//      auth (the user authenticates directly with the provider).
//   4. On success, increments the provider's totalCalls + totalRevenueCents.
//      (Stripe Connect integration is the next phase — for now we just track
//      the owed amount; no real charge is made.)
//   5. Returns the upstream response body + status to the caller.
//
// Why a proxy at all (instead of letting the agent call the provider directly)?
//   - Usage tracking: we need to count calls per provider for the revenue split.
//   - Future Stripe integration: the proxy is where we'll inject the Stripe
//     charge once the marketplace goes live.
//   - Rate limiting + abuse protection: we can cap calls per user per minute.
//   - Audit trail: we log who called what, when.

interface RouteCtx {
  params: Promise<{ id: string }>
}

interface CallBody {
  path?: string
  method?: string
  headers?: Record<string, string>
  query?: Record<string, string>
  body?: unknown
}

const UPSTREAM_TIMEOUT_MS = 30_000
const MAX_BODY_BYTES = 256 * 1024 // 256 KB cap on the upstream response

export async function POST(req: Request, { params }: RouteCtx) {
  const gate = marketplaceGate()
  if (gate) return gate

  try {
    const user = await getCurrentUser(req)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params
    const provider = await db.apiProvider.findUnique({ where: { id } })
    if (!provider) {
      return NextResponse.json({ error: 'Provider not found' }, { status: 404 })
    }

    const isOwner = provider.userId === user.id
    if (provider.status !== 'active' && !isOwner) {
      return NextResponse.json(
        { error: `Provider is ${provider.status}` },
        { status: 403 },
      )
    }
    if (!provider.isPublic && !isOwner) {
      return NextResponse.json({ error: 'Provider not found' }, { status: 404 })
    }

    const body = (await req.json().catch(() => ({}))) as CallBody
    const path = (body.path || '').trim()
    if (!path) {
      return NextResponse.json(
        { error: 'path is required' },
        { status: 400 },
      )
    }

    const method = (body.method || 'GET').toUpperCase()
    if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'].includes(method)) {
      return NextResponse.json(
        { error: `Unsupported method: ${method}` },
        { status: 400 },
      )
    }

    // Build the upstream URL.
    const base = provider.apiBaseUrl.replace(/\/$/, '')
    const safePath = path.startsWith('/') ? path : `/${path}`
    let upstreamUrl: string
    try {
      const u = new URL(base + safePath)
      if (body.query && typeof body.query === 'object') {
        for (const [k, v] of Object.entries(body.query)) {
          if (typeof v === 'string') u.searchParams.set(k, v)
        }
      }
      upstreamUrl = u.toString()
    } catch {
      return NextResponse.json(
        { error: 'Failed to build upstream URL' },
        { status: 400 },
      )
    }

    // Build the upstream request.
    const upstreamHeaders: Record<string, string> = {
      Accept: 'application/json, */*',
      ...(body.headers && typeof body.headers === 'object' ? body.headers : {}),
    }
    let upstreamBody: BodyInit | undefined
    if (method !== 'GET' && method !== 'HEAD' && body.body !== undefined) {
      upstreamBody = JSON.stringify(body.body)
      upstreamHeaders['Content-Type'] = upstreamHeaders['Content-Type'] || 'application/json'
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS)

    let upstreamResp: Response
    try {
      upstreamResp = await fetch(upstreamUrl, {
        method,
        headers: upstreamHeaders,
        body: upstreamBody,
        signal: controller.signal,
        redirect: 'follow',
      })
    } catch (err) {
      clearTimeout(timer)
      const msg = err instanceof Error ? err.message : String(err)
      return NextResponse.json(
        { error: `Upstream call failed: ${msg}` },
        { status: 502 },
      )
    }
    clearTimeout(timer)

    // Read the upstream body (capped).
    const upstreamText = await upstreamResp.text()
    const truncated =
      upstreamText.length > MAX_BODY_BYTES
        ? upstreamText.slice(0, MAX_BODY_BYTES) +
          `\n[truncated at ${MAX_BODY_BYTES} bytes]`
        : upstreamText

    // Try to parse as JSON for a clean response; fall back to text.
    let upstreamJson: unknown = null
    let isJson = false
    try {
      upstreamJson = JSON.parse(truncated)
      isJson = true
    } catch {
      // not JSON — that's fine
    }

    // Track usage on success (2xx). On non-2xx we don't charge.
    if (upstreamResp.ok) {
      // Calculate revenue: pricePer1kCalls / 1000 = cents per call.
      const centsPerCall = Math.floor(provider.pricePer1kCalls / 1000)
      const providerShare = Math.floor(
        (centsPerCall * provider.revenueSharePct) / 100,
      )
      await db.apiProvider.update({
        where: { id: provider.id },
        data: {
          totalCalls: { increment: 1 },
          totalRevenueCents: { increment: providerShare },
        },
      })
    }

    return NextResponse.json({
      ok: upstreamResp.ok,
      status: upstreamResp.status,
      statusText: upstreamResp.statusText,
      ...(isJson ? { data: upstreamJson } : { text: truncated }),
      provider: {
        id: provider.id,
        name: provider.name,
        pricePer1kCalls: provider.pricePer1kCalls,
      },
      // Surface the next-step intent so the caller knows what would happen
      // once Stripe is wired up.
      billing: {
        charged: false,
        note:
          'Usage is tracked but no Stripe charge has been made. Stripe Connect integration is the next phase.',
      },
    })
  } catch (err) {
    console.error('[api/marketplace/providers/[id]/call] failed:', err)
    return NextResponse.json(
      { error: 'Failed to proxy call' },
      { status: 500 },
    )
  }
}
