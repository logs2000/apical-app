import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth-helpers'
import { resumeRunFromGate, ResumeError } from '@/lib/runtime'

interface RouteCtx {
  params: Promise<{ id: string }>
}

// POST /api/runs/[id]/gate — approve or reject a run paused at a gate step.
// Body: { approve: boolean, note?: string }
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

    const body = (await req.json().catch(() => ({}))) as {
      approve?: boolean
      note?: string
    }
    if (typeof body.approve !== 'boolean') {
      return NextResponse.json(
        { error: 'Body must include approve: boolean' },
        { status: 400 },
      )
    }

    const result = await resumeRunFromGate(id, {
      approve: body.approve,
      note: body.note,
      actorId: user.id,
    })
    return NextResponse.json({ ok: true, status: result.status })
  } catch (err) {
    if (err instanceof ResumeError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    console.error('[api/runs/[id]/gate] failed:', err)
    return NextResponse.json({ error: 'Failed to resume run' }, { status: 500 })
  }
}
