import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withAuth } from '@/lib/with-auth'
import { mapRunV1, workflowScopeWhere } from '@/lib/v1/mappers'

// GET /v1/runs/{id} — one run with its steps and report.
export const GET = withAuth(
  async (req, ctx) => {
    const row = await db.run.findFirst({
      where: {
        id: ctx.params.id,
        workflow: workflowScopeWhere(ctx.workspace.id, ctx.user?.id ?? null),
      },
      include: { steps: true },
    })
    if (!row) {
      return NextResponse.json({ error: 'Run not found.' }, { status: 404 })
    }
    return NextResponse.json({ run: mapRunV1(row, { includeSteps: true }) })
  },
  { scope: 'runs:read' },
)
