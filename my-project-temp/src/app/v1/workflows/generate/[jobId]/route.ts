import { db } from '@/lib/db'
import { withAuth } from '@/lib/with-auth'
import { ok, ApiError } from '@/lib/api/respond'

// GET /v1/workflows/generate/{jobId} — poll a generation job.
export const GET = withAuth(
  async (_req, { workspace, params }) => {
    const job = await db.generateJob.findUnique({ where: { id: params.jobId } })
    if (!job || job.workspaceId !== workspace.id) throw new ApiError('not_found', 'Job not found.')

    let issues: unknown = null
    if (job.issuesJson) {
      try {
        issues = JSON.parse(job.issuesJson)
      } catch {
        issues = null
      }
    }

    return ok({
      jobId: job.id,
      status: job.status,
      workflowId: job.workflowId,
      error: job.error,
      issues,
      createdAt: job.createdAt.toISOString(),
      completedAt: job.completedAt?.toISOString() ?? null,
    })
  },
  { scope: 'workflows:read', rateLimit: { limit: 120, windowMs: 60_000 } },
)
