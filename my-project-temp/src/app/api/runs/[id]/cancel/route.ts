import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth-helpers'
import { broadcastRun } from '@/lib/relay-client'

interface RouteCtx {
  params: Promise<{ id: string }>
}

// POST /api/runs/[id]/cancel — stop a running workflow run.
export async function POST(req: Request, { params }: RouteCtx) {
  try {
    const user = await getCurrentUser(req)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const { id } = await params

    const row = await db.run.findUnique({
      where: { id },
      include: { workflow: { select: { userId: true } } },
    })
    if (!row || row.workflow?.userId !== user.id) {
      return NextResponse.json({ error: 'Run not found' }, { status: 404 })
    }
    if (row.status !== 'running') {
      return NextResponse.json({ error: 'Run is not running' }, { status: 400 })
    }

    const finishedAt = new Date()
    await db.run.update({
      where: { id },
      data: { status: 'cancelled', finishedAt },
    })
    await db.runStep.updateMany({
      where: { runId: id, status: { in: ['pending', 'running'] } },
      data: { status: 'skipped', finishedAt },
    })

    broadcastRun(id, 'run:completed', { runId: id, status: 'cancelled' })

    return NextResponse.json({ ok: true, status: 'cancelled' })
  } catch (err) {
    console.error('[api/runs/[id]/cancel] failed:', err)
    return NextResponse.json({ error: 'Failed to cancel run' }, { status: 500 })
  }
}
