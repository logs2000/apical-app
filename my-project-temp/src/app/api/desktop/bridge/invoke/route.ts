import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withUser } from '@/lib/auth-helpers'
import { isKnownTool } from '@/lib/platform/desktop-tools'

// POST /api/desktop/bridge/invoke — proxy an MCP tool invocation to the
// desktop-bridge mini-service on port 3005.
//
// Body: { sessionId, tool, args?, timeoutMs? }
//
// Steps:
//   1. Validate the session exists AND belongs to the calling user.
//   2. Validate the tool name is in the MCP catalog (defense in depth).
//   3. POST to http://localhost:3005/invoke with the same shape.
//   4. Forward the mini-service's response back. Status codes from the
//      mini-service are mapped:
//        503 desktop_offline → 503 desktop_offline
//        504 timeout         → 504 timeout
//        200 ok:true         → 200 { ok, result }
//        200 ok:false        → 200 { ok:false, error }   (tool ran but failed)
//        400 / 404 / 500     → 502 bad_gateway (unexpected from the bridge)
//
// This route is what hosted agents actually call. They never talk to port 3005
// directly — Caddy only exposes 3000.

const BRIDGE_URL = 'http://localhost:3005/invoke'

interface InvokeBody {
  sessionId?: string
  tool?: string
  args?: unknown
  timeoutMs?: number
}

export const POST = withUser(async (req, { user }) => {
  let body: InvokeBody = {}
  try {
    body = (await req.json()) as InvokeBody
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
  const tool = typeof body.tool === 'string' ? body.tool : ''
  const args =
    body.args && typeof body.args === 'object' && !Array.isArray(body.args)
      ? (body.args as Record<string, unknown>)
      : {}
  const timeoutMs =
    typeof body.timeoutMs === 'number' && body.timeoutMs > 0
      ? Math.min(body.timeoutMs, 120_000)
      : 30_000

  if (!sessionId) {
    return NextResponse.json(
      { ok: false, error: 'sessionId is required' },
      { status: 400 },
    )
  }
  if (!tool) {
    return NextResponse.json(
      { ok: false, error: 'tool is required' },
      { status: 400 },
    )
  }

  // Ownership check — load + verify before hitting the bridge.
  const session = await db.desktopSession.findUnique({ where: { id: sessionId } })
  if (!session || session.userId !== user.id) {
    return NextResponse.json(
      { ok: false, error: 'session_not_found' },
      { status: 404 },
    )
  }

  if (!isKnownTool(tool)) {
    return NextResponse.json(
      { ok: false, error: `unknown_tool: ${tool}` },
      { status: 400 },
    )
  }

  // Forward to the desktop-bridge mini-service.
  let bridgeRes: Response
  try {
    bridgeRes = await fetch(BRIDGE_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId, tool, args, timeoutMs }),
      // Don't let the fetch itself hang beyond the timeout + slack.
      signal: AbortSignal.timeout(timeoutMs + 5_000),
    })
  } catch (err) {
    console.error('[desktop-bridge/invoke] fetch to bridge failed:', err)
    return NextResponse.json(
      { ok: false, error: 'bridge_unreachable' },
      { status: 502 },
    )
  }

  // The mini-service always responds with JSON.
  const payload = (await bridgeRes.json().catch(() => ({}))) as {
    ok?: boolean
    result?: unknown
    error?: string
  }

  // Map the mini-service's status codes 1:1 for the two caller-visible cases.
  if (bridgeRes.status === 503) {
    return NextResponse.json(
      { ok: false, error: payload.error || 'desktop_offline' },
      { status: 503 },
    )
  }
  if (bridgeRes.status === 504) {
    return NextResponse.json(
      { ok: false, error: payload.error || 'timeout' },
      { status: 504 },
    )
  }
  if (bridgeRes.status === 200) {
    return NextResponse.json(payload, { status: 200 })
  }

  // Anything else (400/404/500 from the bridge) is unexpected — surface as
  // 502 bad_gateway with the original error so the caller can debug.
  return NextResponse.json(
    { ok: false, error: payload.error || 'bad_gateway', status: bridgeRes.status },
    { status: 502 },
  )
})
