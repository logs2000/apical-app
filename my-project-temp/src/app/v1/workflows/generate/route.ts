import { z } from 'zod'
import { withAuth } from '@/lib/with-auth'
import { ok } from '@/lib/api/respond'
import { parseBody } from '@/lib/api/validate'
import { startGenerateJob } from '@/lib/platform/workflow-generate'

const GenerateSchema = z.object({
  spec: z.string().trim().min(1, 'spec is required').max(5000, 'spec is too long (5000 chars max)'),
  name: z.string().trim().optional(),
})

// POST /v1/workflows/generate — natural-language spec → designed, validated,
// draft workflow. Async: returns { jobId } immediately; poll
// GET /v1/workflows/generate/{jobId} until status is completed/failed.
export const POST = withAuth(
  async (req, { workspace, user }) => {
    const body = await parseBody(req, GenerateSchema)
    const { jobId } = await startGenerateJob({
      workspaceId: workspace.id,
      userId: user?.id ?? null,
      spec: body.spec,
      name: body.name || null,
    })
    return ok({ jobId, status: 'pending', poll: `/v1/workflows/generate/${jobId}` }, { status: 202 })
  },
  { scope: 'workflows:write', rateLimit: { limit: 30, windowMs: 60_000 } },
)
