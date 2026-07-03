import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withAuth } from '@/lib/with-auth'
import { saveWorkflowSteps } from '@/lib/platform/workflow-revisions'
import { validateWorkflowForWorkspace } from '@/lib/platform/workflow-validate-server'
import { mapWorkflowV1, findScopedWorkflow } from '@/lib/v1/mappers'

// GET /v1/workflows/{id} — fetch one workflow (raw WorkflowJSON + metadata).
export const GET = withAuth(
  async (req, ctx) => {
    const row = await findScopedWorkflow(ctx.params.id, ctx)
    if (!row) {
      return NextResponse.json({ error: 'Workflow not found.' }, { status: 404 })
    }
    return NextResponse.json({ workflow: mapWorkflowV1(row) })
  },
  { scope: 'workflows:read' },
)

interface PatchBody {
  name?: string
  description?: string
  trigger?: 'manual' | 'schedule'
  schedule?: string | null
  status?: 'draft' | 'active' | 'paused'
  /** Replacement WorkflowJSON document — creates a new revision. */
  workflow?: unknown
  // ---- execution config ----
  runtime?: 'local' | 'hosted'
  modelPreference?: string | null
  confidenceThreshold?: number | null
  autoHardenAfter?: number | null
  allowedTools?: string[] | null
  allowedCredentials?: string[] | null
}

// PATCH /v1/workflows/{id} — update metadata and/or replace the steps
// document (validated; step changes create an immutable revision).
export const PATCH = withAuth(
  async (req, ctx) => {
    const row = await findScopedWorkflow(ctx.params.id, ctx)
    if (!row) {
      return NextResponse.json({ error: 'Workflow not found.' }, { status: 404 })
    }
    const body = (await req.json().catch(() => null)) as PatchBody | null
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
    }

    const data: Record<string, unknown> = {}
    if (typeof body.name === 'string' && body.name.trim()) data.name = body.name.trim()
    if (typeof body.description === 'string') data.description = body.description
    if (body.trigger === 'manual' || body.trigger === 'schedule') data.trigger = body.trigger
    if (typeof body.schedule === 'string' || body.schedule === null) data.schedule = body.schedule
    if (body.status === 'draft' || body.status === 'active' || body.status === 'paused')
      data.status = body.status
    if (body.runtime === 'local' || body.runtime === 'hosted') data.runtime = body.runtime
    if (typeof body.modelPreference === 'string' || body.modelPreference === null)
      data.modelPreference = body.modelPreference
    if (typeof body.confidenceThreshold === 'number' || body.confidenceThreshold === null)
      data.confidenceThreshold = body.confidenceThreshold
    if (typeof body.autoHardenAfter === 'number' || body.autoHardenAfter === null)
      data.autoHardenAfter = body.autoHardenAfter
    if (Array.isArray(body.allowedTools) || body.allowedTools === null)
      data.allowedToolsJson = body.allowedTools ? JSON.stringify(body.allowedTools) : null
    if (Array.isArray(body.allowedCredentials) || body.allowedCredentials === null)
      data.allowedCredentialsJson = body.allowedCredentials
        ? JSON.stringify(body.allowedCredentials)
        : null

    let warnings: unknown[] = []
    if (body.workflow !== undefined) {
      const validation = await validateWorkflowForWorkspace(body.workflow, ctx.workspace.id)
      if (!validation.ok) {
        return NextResponse.json(
          { error: 'Workflow failed validation.', issues: validation.issues, warnings: validation.warnings },
          { status: 422 },
        )
      }
      warnings = validation.warnings
      await saveWorkflowSteps(row.id, validation.workflow!, {
        author: 'user',
        note: 'Updated via PATCH /v1/workflows.',
      })
    }
    if (Object.keys(data).length > 0) {
      await db.workflow.update({ where: { id: row.id }, data })
    }
    const updated = await db.workflow.findUnique({ where: { id: row.id } })
    return NextResponse.json({ workflow: mapWorkflowV1(updated!), warnings })
  },
  { scope: 'workflows:write' },
)

// DELETE /v1/workflows/{id}
export const DELETE = withAuth(
  async (req, ctx) => {
    const row = await findScopedWorkflow(ctx.params.id, ctx)
    if (!row) {
      return NextResponse.json({ error: 'Workflow not found.' }, { status: 404 })
    }
    await db.workflow.delete({ where: { id: row.id } })
    return NextResponse.json({ deleted: true })
  },
  { scope: 'workflows:write' },
)
