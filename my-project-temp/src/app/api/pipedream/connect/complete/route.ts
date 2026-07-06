import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth-helpers'
import { workspaceIdForUser } from '@/lib/integration-scope'
import { materializePipedreamConnection } from '@/lib/pipedream/sync'
import { isPipedreamConfigured } from '@/lib/pipedream/config'

// POST /api/pipedream/connect/complete — called by the browser after the
// Pipedream auth popup reports success. Verifies the account upstream
// (ownership is re-checked server-side; the client-supplied apn_ id is never
// trusted) and materializes the Credential + Integration + tools. Idempotent.
export async function POST(req: Request) {
  try {
    const user = await getCurrentUser(req)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (!isPipedreamConfigured()) {
      return NextResponse.json({ error: 'Pipedream is not configured' }, { status: 503 })
    }
    const body = (await req.json().catch(() => ({}))) as {
      accountId?: string
      app?: string
    }
    const accountId = (body.accountId || '').trim()
    const app = (body.app || '').trim().toLowerCase()
    if (!accountId || !app) {
      return NextResponse.json({ error: 'accountId and app are required' }, { status: 400 })
    }
    const wsId = await workspaceIdForUser(user)
    const { result, error } = await materializePipedreamConnection(
      user.id,
      wsId,
      accountId,
      app,
    )
    if (!result) {
      return NextResponse.json({ error: error || 'Failed to complete connection' }, { status: 400 })
    }
    return NextResponse.json(result)
  } catch (err) {
    console.error('[api/pipedream/connect/complete] failed:', err)
    return NextResponse.json({ error: 'Failed to complete connection' }, { status: 500 })
  }
}
