import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth-helpers'
import { mapRun } from '@/lib/mappers'

interface RouteCtx {
  params: Promise<{ id: string }>
}

// GET /api/runs/[id] — one run with its steps (parsed).
// Only the owner of the run's workflow may view it.
export async function GET(req: Request, { params }: RouteCtx) {
  try {
    const user = await getCurrentUser(req)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const { id } = await params
    const row = await db.run.findUnique({
      where: { id },
      include: {
        workflow: { select: { name: true, userId: true } },
        steps: { orderBy: { order: 'asc' } },
      },
    })
    if (!row || row.workflow?.userId !== user.id) {
      return NextResponse.json({ error: 'Run not found' }, { status: 404 })
    }
    return NextResponse.json(mapRun(row, row.workflow?.name || 'Unknown'))
  } catch (err) {
    console.error('[api/runs/[id]] GET failed:', err)
    return NextResponse.json(
      { error: 'Failed to load run' },
      { status: 500 },
    )
  }
}
