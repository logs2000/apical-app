import { db } from '@/lib/db'
import { withAuth } from '@/lib/with-auth'
import { ok, ApiError } from '@/lib/api/respond'
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
    if (!row) throw new ApiError('not_found', 'Run not found.')
    return ok(mapRunV1(row, { includeSteps: true }))
  },
  { scope: 'runs:read', rateLimit: { limit: 120, windowMs: 60_000 } },
)
