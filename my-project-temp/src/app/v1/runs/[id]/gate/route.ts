import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withAuth } from '@/lib/with-auth'
import { workflowScopeWhere } from '@/lib/v1/mappers'
import { resumeRunFromGate, ResumeError } from '@/lib/runtime'

// POST /v1/runs/{id}/gate — approve or reject a run paused at a gate step.
// Body: { approve: boolean, note?: string }
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

    const body = (await req.json().catch(() => ({}))) as {
      approve?: boolean
      note?: string
    }
    if (typeof body.approve !== 'boolean') {
      return NextResponse.json(
        { error: 'Body must include approve: boolean.' },
        { status: 400 },
      )
    }

    try {
      const result = await resumeRunFromGate(row.id, {
        approve: body.approve,
        note: body.note,
        actorId: ctx.user?.id ?? undefined,
      })
      return NextResponse.json({ ok: true, status: result.status })
    } catch (err) {
      if (err instanceof ResumeError) {
        return NextResponse.json({ error: err.message }, { status: err.status })
      }
      throw err
    }
  },
  { scope: 'runs:execute' },
)
