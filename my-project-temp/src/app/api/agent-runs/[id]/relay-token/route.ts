import { NextResponse } from 'next/server'
import { withUser } from '@/lib/auth-helpers'
import { db } from '@/lib/db'
import { mintRunRelayToken } from '@/lib/relay-token'

// POST /api/agent-runs/[id]/relay-token — mint a signed room token so the
// browser can join relay room `run:agentrun:<id>` (subscribe with runId
// `agentrun:<id>`). Owner-only; the relay verifies the token independently.
export const POST = withUser(async (_req, { user, params }) => {
  const run = await db.agentRun.findFirst({
    where: { id: params.id, userId: user.id },
    select: { id: true },
  })
  if (!run) return NextResponse.json({ error: 'not found' }, { status: 404 })
  const minted = mintRunRelayToken(`agentrun:${run.id}`)
  if (!minted) {
    return NextResponse.json(
      { error: 'Relay is not configured (APICAL_RELAY_SECRET unset).' },
      { status: 503 },
    )
  }
  return NextResponse.json({ token: minted.token, expiresAt: minted.expiresAt, runId: `agentrun:${run.id}` })
})
