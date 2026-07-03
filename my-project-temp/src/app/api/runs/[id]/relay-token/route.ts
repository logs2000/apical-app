import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth-helpers'
import { mintRunRelayToken } from '@/lib/relay-token'

interface RouteCtx {
  params: Promise<{ id: string }>
}

// POST /api/runs/[id]/relay-token — mint a short-lived signed token that lets
// the browser join the relay room `run:<id>`. Only the owner of the run's
// workflow can mint one. The relay service verifies the token independently
// (same APICAL_RELAY_SECRET) before allowing the join.
export async function POST(req: Request, { params }: RouteCtx) {
  try {
    const user = await getCurrentUser(req)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const { id } = await params
    const run = await db.run.findUnique({
      where: { id },
      select: { id: true, workflow: { select: { userId: true } } },
    })
    // Legacy seed workflows (userId null) pass until the tenancy backfill.
    if (!run || (run.workflow?.userId && run.workflow.userId !== user.id)) {
      return NextResponse.json({ error: 'Run not found' }, { status: 404 })
    }
    const minted = mintRunRelayToken(id)
    if (!minted) {
      return NextResponse.json(
        { error: 'Relay is not configured (APICAL_RELAY_SECRET unset).' },
        { status: 503 },
      )
    }
    return NextResponse.json({ token: minted.token, expiresAt: minted.expiresAt })
  } catch (err) {
    console.error('[api/runs/[id]/relay-token] failed:', err)
    return NextResponse.json(
      { error: 'Failed to mint relay token' },
      { status: 500 },
    )
  }
}
