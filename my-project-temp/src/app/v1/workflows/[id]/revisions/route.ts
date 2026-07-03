import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withAuth } from '@/lib/with-auth'
import {
  mapRevision,
  resolveActiveRevision,
  rollbackToRevision,
} from '@/lib/platform/workflow-revisions'
import { findScopedWorkflow } from '@/lib/v1/mappers'

// GET /v1/workflows/{id}/revisions — list revisions (newest first).
export const GET = withAuth(
  async (req, ctx) => {
    const row = await findScopedWorkflow(ctx.params.id, ctx)
    if (!row) {
      return NextResponse.json({ error: 'Workflow not found.' }, { status: 404 })
    }
    const activeRevisionId = await resolveActiveRevision(row.id)
    const revisions = await db.workflowRevision.findMany({
      where: { workflowId: row.id },
      orderBy: { number: 'desc' },
    })
    return NextResponse.json({
      revisions: revisions.map((r) => mapRevision(r, activeRevisionId)),
    })
  },
  { scope: 'workflows:read' },
)

// POST /v1/workflows/{id}/revisions — { rollbackTo: number }. Creates a NEW
// revision copied from the target and activates it (history is append-only).
export const POST = withAuth(
  async (req, ctx) => {
    const row = await findScopedWorkflow(ctx.params.id, ctx)
    if (!row) {
      return NextResponse.json({ error: 'Workflow not found.' }, { status: 404 })
    }
    const body = (await req.json().catch(() => ({}))) as { rollbackTo?: number }
    const number = Number(body.rollbackTo)
    if (!Number.isInteger(number) || number < 1) {
      return NextResponse.json(
        { error: 'rollbackTo must be a positive revision number.' },
        { status: 400 },
      )
    }
    const revision = await rollbackToRevision(row.id, number)
    if (!revision) {
      return NextResponse.json(
        { error: `Revision ${number} not found.` },
        { status: 404 },
      )
    }
    return NextResponse.json({ revision: mapRevision(revision, revision.id) })
  },
  { scope: 'workflows:write' },
)
