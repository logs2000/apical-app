import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withAuth } from '@/lib/with-auth'
import { workflowScopeWhere } from '@/lib/v1/mappers'
import { rerunFromStep, ResumeError } from '@/lib/runtime'

// POST /v1/runs/{id}/rerun — re-execute a failed (dead-lettered) run as a NEW
// run, starting from the failed step (default) or an explicit fromStepId.
// Prior steps' real outputs are carried over; the same pinned revision runs.
// Body: { fromStepId?: string }
export const POST = withAuth(
  async (req, ctx) => {
    const row = await db.run.findFirst({
      where: {
        id: ctx.params.id,
        workflow: workflowScopeWhere(ctx.workspace.id, ctx.user?.id ?? null),
      },
      select: { id: true },
    })
    if (!row) {
      return NextResponse.json({ error: 'Run not found.' }, { status: 404 })
    }

    const body = (await req.json().catch(() => ({}))) as { fromStepId?: string }
    try {
      const { runId } = await rerunFromStep(row.id, {
        fromStepId:
          typeof body.fromStepId === 'string'
            ? body.fromStepId.trim() || undefined
            : undefined,
        actorId: ctx.user?.id ?? undefined,
      })
      return NextResponse.json({ runId, status: 'running' }, { status: 202 })
    } catch (err) {
      if (err instanceof ResumeError) {
        return NextResponse.json({ error: err.message }, { status: err.status })
      }
      throw err
    }
  },
  { scope: 'runs:execute' },
)
