import { z } from 'zod'
import { db } from '@/lib/db'
import { withAuth } from '@/lib/with-auth'
import { ok, ApiError } from '@/lib/api/respond'
import { parseBody } from '@/lib/api/validate'
import { mapRevision, resolveActiveRevision, rollbackToRevision } from '@/lib/platform/workflow-revisions'
import { findScopedWorkflow } from '@/lib/v1/mappers'

// GET /v1/workflows/{id}/revisions — list revisions (newest first).
export const GET = withAuth(
  async (req, ctx) => {
    const row = await findScopedWorkflow(ctx.params.id, ctx)
    if (!row) throw new ApiError('not_found', 'Workflow not found.')
    const activeRevisionId = await resolveActiveRevision(row.id)
    const revisions = await db.workflowRevision.findMany({
      where: { workflowId: row.id },
      orderBy: { number: 'desc' },
    })
    return ok(revisions.map((r) => mapRevision(r, activeRevisionId)))
  },
  { scope: 'workflows:read', rateLimit: { limit: 120, windowMs: 60_000 } },
)

const RollbackSchema = z.object({ rollbackTo: z.number().int().min(1) })

// POST /v1/workflows/{id}/revisions — { rollbackTo: number }. Creates a NEW
// revision copied from the target and activates it (history is append-only).
export const POST = withAuth(
  async (req, ctx) => {
    const row = await findScopedWorkflow(ctx.params.id, ctx)
    if (!row) throw new ApiError('not_found', 'Workflow not found.')
    const { rollbackTo } = await parseBody(req, RollbackSchema)
    const revision = await rollbackToRevision(row.id, rollbackTo)
    if (!revision) throw new ApiError('not_found', `Revision ${rollbackTo} not found.`)
    return ok(mapRevision(revision, revision.id))
  },
  { scope: 'workflows:write', rateLimit: { limit: 60, windowMs: 60_000 } },
)
