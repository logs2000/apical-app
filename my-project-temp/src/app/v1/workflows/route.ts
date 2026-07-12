import { z } from 'zod'
import { db } from '@/lib/db'
import { withAuth } from '@/lib/with-auth'
import { okEnvelope, ApiError } from '@/lib/api/respond'
import { parseBody } from '@/lib/api/validate'
import { parsePagination, cursorFilter, cursorOrderBy, paginate } from '@/lib/api/paginate'
import { serializeWorkflowJSON } from '@/lib/apical-server'
import { saveWorkflowSteps } from '@/lib/platform/workflow-revisions'
import { validateWorkflowForWorkspace } from '@/lib/platform/workflow-validate-server'
import { inferRuntimeFromSteps } from '@/lib/workflow-schema'
import { mapWorkflowV1, workflowScopeWhere } from '@/lib/v1/mappers'

// GET /v1/workflows — list the workspace's workflows (cursor-paginated).
// Query: status?, limit? (default 50, max 200), cursor?.
export const GET = withAuth(
  async (req, { workspace, user }) => {
    const url = new URL(req.url)
    const status = url.searchParams.get('status')
    const { limit, cursor } = parsePagination(url)
    const rows = await db.workflow.findMany({
      where: {
        ...workflowScopeWhere(workspace.id, user?.id ?? null),
        ...(status ? { status } : {}),
        ...cursorFilter(cursor),
      },
      orderBy: cursorOrderBy(),
      take: limit + 1,
    })
    const page = paginate(rows, limit)
    return okEnvelope({ data: page.data.map(mapWorkflowV1), page: page.page })
  },
  { scope: 'workflows:read', rateLimit: { limit: 120, windowMs: 60_000 } },
)

const CreateWorkflowSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().max(4000).optional(),
  trigger: z.enum(['manual', 'schedule']).optional(),
  schedule: z.string().nullable().optional(),
  status: z.enum(['draft', 'active', 'paused']).optional(),
  /** How the workflow came to be — the first-party chat UI passes 'agent'/'chat'. */
  origin: z.enum(['agent', 'manual', 'chat']).optional(),
  /** The raw WorkflowJSON document (see /schemas/workflow/v2.json). */
  workflow: z.unknown(),
})

// POST /v1/workflows — create a workflow from a raw WorkflowJSON document.
// The document is validated (schema + referential + workspace integration
// refs) BEFORE anything is written. Returns 422 with issues on failure.
export const POST = withAuth(
  async (req, { workspace, user }) => {
    const body = await parseBody(req, CreateWorkflowSchema)
    if (body.workflow === undefined || body.workflow === null) {
      throw new ApiError(
        'validation_failed',
        'workflow (a WorkflowJSON document) is required. See /schemas/workflow/v2.json.',
      )
    }

    const validation = await validateWorkflowForWorkspace(body.workflow, workspace.id)
    if (!validation.ok) {
      throw new ApiError('validation_failed', 'Workflow failed validation.', {
        details: { issues: validation.issues, warnings: validation.warnings },
      })
    }
    const wf = validation.workflow!
    const runtime = inferRuntimeFromSteps(wf.steps)

    const created = await db.workflow.create({
      data: {
        userId: user?.id ?? null,
        workspaceId: workspace.id,
        name: body.name,
        description: body.description ?? '',
        stepsJson: serializeWorkflowJSON(wf),
        trigger: body.trigger === 'schedule' ? 'schedule' : 'manual',
        schedule: typeof body.schedule === 'string' ? body.schedule : null,
        status: body.status === 'draft' || body.status === 'paused' ? body.status : 'active',
        origin: body.origin === 'agent' || body.origin === 'chat' ? body.origin : 'manual',
        runtime,
      },
    })
    // An empty document (e.g. a brand-new chat/agent shell) has nothing to
    // version yet — skip the revision write + re-read so creation is a single
    // round-trip. The first real revision lands on workflow_freeze/update.
    if (wf.steps.length === 0) {
      return okEnvelope(
        { data: mapWorkflowV1(created), warnings: validation.warnings },
        { status: 201 },
      )
    }
    await saveWorkflowSteps(created.id, wf, { author: 'user', note: 'Created via POST /v1/workflows.' })
    const row = await db.workflow.findUnique({ where: { id: created.id } })
    return okEnvelope(
      { data: mapWorkflowV1(row!), warnings: validation.warnings },
      { status: 201 },
    )
  },
  { scope: 'workflows:write', rateLimit: { limit: 60, windowMs: 60_000 } },
)
