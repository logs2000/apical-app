import { z } from 'zod'
import { db } from '@/lib/db'
import { withAuth } from '@/lib/with-auth'
import { ok, apiError, ApiError } from '@/lib/api/respond'
import { codeForStatus } from '@/lib/api/errors'
import { parseBody } from '@/lib/api/validate'
import { workflowScopeWhere } from '@/lib/v1/mappers'
import { rerunFromStep, ResumeError } from '@/lib/runtime'

const RerunSchema = z.object({ fromStepId: z.string().trim().min(1).optional() })

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
    if (!row) throw new ApiError('not_found', 'Run not found.')

    const body = await parseBody(req, RerunSchema)
    try {
      const { runId } = await rerunFromStep(row.id, {
        fromStepId: body.fromStepId,
        actorId: ctx.user?.id ?? undefined,
      })
      return ok({ runId, status: 'running' }, { status: 202 })
    } catch (err) {
      if (err instanceof ResumeError) {
        return apiError(codeForStatus(err.status), err.message, { status: err.status })
      }
      throw err
    }
  },
  { scope: 'runs:execute', rateLimit: { limit: 30, windowMs: 60_000 } },
)
