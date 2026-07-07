import { z } from 'zod'
import { db } from '@/lib/db'
import { withAuth } from '@/lib/with-auth'
import { ok, apiError, ApiError } from '@/lib/api/respond'
import { codeForStatus } from '@/lib/api/errors'
import { parseBody } from '@/lib/api/validate'
import { workflowScopeWhere } from '@/lib/v1/mappers'
import { resumeRunFromGate, ResumeError } from '@/lib/runtime'

const GateSchema = z.object({ approve: z.boolean(), note: z.string().max(2000).optional() })

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
    if (!row) throw new ApiError('not_found', 'Run not found.')

    const body = await parseBody(req, GateSchema)
    try {
      const result = await resumeRunFromGate(row.id, {
        approve: body.approve,
        note: body.note,
        actorId: ctx.user?.id ?? undefined,
      })
      return ok({ status: result.status })
    } catch (err) {
      if (err instanceof ResumeError) {
        return apiError(codeForStatus(err.status), err.message, { status: err.status })
      }
      throw err
    }
  },
  { scope: 'runs:execute', rateLimit: { limit: 60, windowMs: 60_000 } },
)
