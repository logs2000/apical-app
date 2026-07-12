import { NextResponse } from 'next/server'
import { withUser } from '@/lib/auth-helpers'
import { db } from '@/lib/db'

// GET /api/agent-runs/[id]/events?afterSeq=N — replay persisted events in
// order. Reconnecting clients backfill with this, then follow the relay room.
export const GET = withUser(async (req, { user, params }) => {
  const run = await db.agentRun.findFirst({
    where: { id: params.id, userId: user.id },
    select: { id: true, status: true },
  })
  if (!run) return NextResponse.json({ error: 'not found' }, { status: 404 })
  const afterSeq = Number(new URL(req.url).searchParams.get('afterSeq') ?? -1)
  const rows = await db.agentRunEvent.findMany({
    where: { agentRunId: run.id, seq: { gt: Number.isFinite(afterSeq) ? afterSeq : -1 } },
    orderBy: { seq: 'asc' },
    take: 500,
  })
  return NextResponse.json({
    status: run.status,
    events: rows.map((r) => ({ seq: r.seq, event: JSON.parse(r.dataJson) })),
  })
})
