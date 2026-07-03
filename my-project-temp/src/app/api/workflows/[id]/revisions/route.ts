import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth-helpers'
import {
  mapRevision,
  resolveActiveRevision,
  rollbackToRevision,
} from '@/lib/platform/workflow-revisions'

interface RouteCtx {
  params: Promise<{ id: string }>
}

// GET /api/workflows/[id]/revisions — list all revisions (newest first).
export async function GET(req: Request, { params }: RouteCtx) {
  try {
    const user = await getCurrentUser(req)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const { id } = await params
    const workflow = await db.workflow.findUnique({ where: { id } })
    if (!workflow || workflow.userId !== user.id) {
      return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
    }

    // Ensure legacy workflows get revision 1 backfilled before listing.
    const activeRevisionId = await resolveActiveRevision(id)
    const rows = await db.workflowRevision.findMany({
      where: { workflowId: id },
      orderBy: { number: 'desc' },
    })
    return NextResponse.json({
      revisions: rows.map((r) => mapRevision(r, activeRevisionId)),
    })
  } catch (err) {
    console.error('[api/workflows/[id]/revisions] GET failed:', err)
    return NextResponse.json(
      { error: 'Failed to list revisions' },
      { status: 500 },
    )
  }
}

// POST /api/workflows/[id]/revisions — roll back to a prior revision.
// Body: { rollbackTo: number }. Creates a NEW revision copied from the target
// (history is append-only) and activates it.
export async function POST(req: Request, { params }: RouteCtx) {
  try {
    const user = await getCurrentUser(req)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const { id } = await params
    const workflow = await db.workflow.findUnique({ where: { id } })
    if (!workflow || workflow.userId !== user.id) {
      return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
    }

    const body = (await req.json().catch(() => ({}))) as {
      rollbackTo?: number
    }
    const number = Number(body.rollbackTo)
    if (!Number.isInteger(number) || number < 1) {
      return NextResponse.json(
        { error: 'rollbackTo must be a positive revision number' },
        { status: 400 },
      )
    }

    const revision = await rollbackToRevision(id, number)
    if (!revision) {
      return NextResponse.json(
        { error: `Revision ${number} not found` },
        { status: 404 },
      )
    }
    return NextResponse.json({ revision: mapRevision(revision, revision.id) })
  } catch (err) {
    console.error('[api/workflows/[id]/revisions] POST failed:', err)
    return NextResponse.json(
      { error: 'Failed to roll back' },
      { status: 500 },
    )
  }
}
