import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withAuth } from '@/lib/with-auth'
import { serializeWorkflowJSON } from '@/lib/apical-server'
import { saveWorkflowSteps } from '@/lib/platform/workflow-revisions'
import { validateWorkflowForWorkspace } from '@/lib/platform/workflow-validate-server'
import { mapWorkflowV1, workflowScopeWhere } from '@/lib/v1/mappers'

// GET /v1/workflows — list the workspace's workflows.
export const GET = withAuth(
  async (req, { workspace, user }) => {
    const url = new URL(req.url)
    const status = url.searchParams.get('status')
    const limit = Math.min(Number(url.searchParams.get('limit')) || 50, 200)
    const rows = await db.workflow.findMany({
      where: {
        ...workflowScopeWhere(workspace.id, user?.id ?? null),
        ...(status ? { status } : {}),
      },
      orderBy: { updatedAt: 'desc' },
      take: limit,
    })
    return NextResponse.json({ workflows: rows.map(mapWorkflowV1) })
  },
  { scope: 'workflows:read' },
)

interface CreateBody {
  name?: string
  description?: string
  trigger?: 'manual' | 'schedule'
  schedule?: string | null
  status?: 'draft' | 'active' | 'paused'
  /** How the workflow came to be — the first-party chat UI passes 'agent'/'chat'. */
  origin?: 'agent' | 'manual' | 'chat'
  /** The raw WorkflowJSON document (see /schemas/workflow/v2.json). */
  workflow?: unknown
}

// POST /v1/workflows — create a workflow from a raw WorkflowJSON document.
// The document is validated (schema + referential + workspace integration
// refs) BEFORE anything is written. Returns 422 with issues on failure.
export const POST = withAuth(
  async (req, { workspace, user }) => {
    const body = (await req.json().catch(() => null)) as CreateBody | null
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
    }
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name) {
      return NextResponse.json({ error: 'name is required.' }, { status: 400 })
    }
    if (!body.workflow) {
      return NextResponse.json(
        { error: 'workflow (a WorkflowJSON document) is required. See /schemas/workflow/v2.json.' },
        { status: 400 },
      )
    }

    const validation = await validateWorkflowForWorkspace(body.workflow, workspace.id)
    if (!validation.ok) {
      return NextResponse.json(
        { error: 'Workflow failed validation.', issues: validation.issues, warnings: validation.warnings },
        { status: 422 },
      )
    }
    const wf = validation.workflow!

    const created = await db.workflow.create({
      data: {
        userId: user?.id ?? null,
        workspaceId: workspace.id,
        name,
        description: typeof body.description === 'string' ? body.description : '',
        stepsJson: serializeWorkflowJSON(wf),
        trigger: body.trigger === 'schedule' ? 'schedule' : 'manual',
        schedule: typeof body.schedule === 'string' ? body.schedule : null,
        status:
          body.status === 'draft' || body.status === 'paused'
            ? body.status
            : 'active',
        origin:
          body.origin === 'agent' || body.origin === 'chat'
            ? body.origin
            : 'manual',
      },
    })
    // An empty document (e.g. a brand-new chat/agent shell) has nothing to
    // version yet — skip the revision write + re-read so creation is a single
    // round-trip. The first real revision lands on workflow_freeze/update.
    if (wf.steps.length === 0) {
      return NextResponse.json(
        { workflow: mapWorkflowV1(created), warnings: validation.warnings },
        { status: 201 },
      )
    }
    await saveWorkflowSteps(created.id, wf, {
      author: 'user',
      note: 'Created via POST /v1/workflows.',
    })
    const row = await db.workflow.findUnique({ where: { id: created.id } })
    return NextResponse.json(
      { workflow: mapWorkflowV1(row!), warnings: validation.warnings },
      { status: 201 },
    )
  },
  { scope: 'workflows:write' },
)
