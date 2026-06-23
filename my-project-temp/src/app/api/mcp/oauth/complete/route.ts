import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth-helpers'
import { completeMcpOAuthFlow, type McpOAuthStartResult } from '@/lib/auth/mcp-oauth-client'
import { consumeOAuthState } from '@/lib/oauth-state'

// POST /api/mcp/oauth/complete — complete an MCP OAuth 2.1 flow.
//
// Body:
//   {
//     code: string,           // required — the authorization code from the callback
//     state: string,          // required — the state token from /start
//     start: McpOAuthStartResult, // required — the start result (echoed back from /start)
//   }
//
// Flow:
//   1. Consume the state token (one-shot — prevents replay).
//   2. Verify the state was minted by the current user.
//   3. Exchange the code for tokens (PKCE + resource indicator).
//   4. Persist tokens as a vault credential keyed by "mcp:<serverUrl>".
//   5. Return the credential ID.
//
// Returns: { ok: true, credentialId } or { ok: false, error }.

interface CompleteBody {
  code?: string
  state?: string
  start?: McpOAuthStartResult
}

export async function POST(req: Request) {
  try {
    const user = await getCurrentUser(req)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = (await req.json().catch(() => ({}))) as CompleteBody
    const code = (body.code || '').trim()
    const state = (body.state || '').trim()
    const start = body.start

    if (!code || !state || !start) {
      return NextResponse.json(
        { error: 'code, state, and start are required' },
        { status: 400 },
      )
    }

    // Verify + consume the state.
    const entry = consumeOAuthState(state)
    if (!entry) {
      return NextResponse.json(
        { error: 'Invalid or expired state token' },
        { status: 400 },
      )
    }
    if (entry.userId !== user.id) {
      return NextResponse.json(
        { error: 'State token was not minted by this user' },
        { status: 403 },
      )
    }

    const result = await completeMcpOAuthFlow({
      userId: user.id,
      code,
      start,
      clientId: entry.customClientId || '',
      clientSecret: entry.customClientSecret,
    })

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }

    return NextResponse.json({ ok: true, credentialId: result.credentialId })
  } catch (err) {
    console.error('[api/mcp/oauth/complete] failed:', err)
    return NextResponse.json(
      { error: 'Failed to complete MCP OAuth flow' },
      { status: 500 },
    )
  }
}
