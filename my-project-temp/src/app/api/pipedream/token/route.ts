import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth-helpers'
import { createConnectToken } from '@/lib/pipedream/connect'
import { isPipedreamConfigured } from '@/lib/pipedream/config'

// POST /api/pipedream/token — mint a short-lived Connect token for the
// session user. The browser uses it to open Pipedream's auth iframe/popup;
// the Connect Link URL is the SDK-free fallback.
export async function POST(req: Request) {
  try {
    const user = await getCurrentUser(req)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (!isPipedreamConfigured()) {
      return NextResponse.json({ error: 'Pipedream is not configured' }, { status: 503 })
    }
    const body = (await req.json().catch(() => ({}))) as { app?: string }
    const app = typeof body.app === 'string' ? body.app.trim().toLowerCase() : undefined
    const { result, error } = await createConnectToken(user.id, { app })
    if (!result) {
      return NextResponse.json({ error: error || 'Failed to create token' }, { status: 502 })
    }
    // externalUserId is needed by the browser SDK client; it's the caller's
    // own user id, so returning it leaks nothing.
    return NextResponse.json({ ...result, externalUserId: user.id })
  } catch (err) {
    console.error('[api/pipedream/token] failed:', err)
    return NextResponse.json({ error: 'Failed to create connect token' }, { status: 500 })
  }
}
