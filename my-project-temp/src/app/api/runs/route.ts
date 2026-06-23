import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth-helpers'
import { mapRun } from '@/lib/mappers'

// GET /api/runs?limit=20 — recent runs (scoped to the current user's workflows)
// with their steps (parsed).
export async function GET(req: Request) {
  try {
    const user = await getCurrentUser(req)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const url = new URL(req.url)
    const limitRaw = url.searchParams.get('limit')
    const limit = Math.min(100, Math.max(1, Number(limitRaw) || 20))

    const rows = await db.run.findMany({
      where: { workflow: { userId: user.id } },
      take: limit,
      orderBy: { startedAt: 'desc' },
      include: {
        workflow: { select: { name: true } },
        steps: { orderBy: { order: 'asc' } },
      },
    })

    const runs = rows.map((r) => mapRun(r, r.workflow?.name || 'Unknown'))
    return NextResponse.json(runs)
  } catch (err) {
    console.error('[api/runs] GET failed:', err)
    return NextResponse.json(
      { error: 'Failed to load runs' },
      { status: 500 },
    )
  }
}
