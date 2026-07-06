import { NextResponse } from 'next/server'
import { withUser } from '@/lib/auth-helpers'
import { db } from '@/lib/db'

// POST /api/agent-runs/[id]/cancel — request cancellation. The worker polls
// for 'cancelling' and aborts the loop at the next boundary; queued runs
// cancel immediately.
export const POST = withUser(async (_req, { user, params }) => {
  const run = await db.agentRun.findFirst({
    where: { id: params.id, userId: user.id },
    select: { id: true, status: true },
  })
  if (!run) return NextResponse.json({ error: 'not found' }, { status: 404 })
  if (['completed', 'failed', 'cancelled'].includes(run.status)) {
    return NextResponse.json({ id: run.id, status: run.status })
  }
  if (run.status === 'queued') {
    await db.agentRun.updateMany({
      where: { id: run.id, status: 'queued' },
      data: { status: 'cancelled', finishedAt: new Date() },
    })
    return NextResponse.json({ id: run.id, status: 'cancelled' })
  }
  await db.agentRun.updateMany({
    where: { id: run.id, status: { in: ['running', 'awaiting_input'] } },
    data: { status: 'cancelling' },
  })
  return NextResponse.json({ id: run.id, status: 'cancelling' })
})
