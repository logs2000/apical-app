import { z } from 'zod'
import { db } from '@/lib/db'
import { withAuth } from '@/lib/with-auth'
import { ok, okEnvelope, ApiError } from '@/lib/api/respond'
import { parseBody } from '@/lib/api/validate'
import { saveWorkflowSteps } from '@/lib/platform/workflow-revisions'
import { validateWorkflowForWorkspace } from '@/lib/platform/workflow-validate-server'
import { mapWorkflowV1, findScopedWorkflow } from '@/lib/v1/mappers'

// GET /v1/workflows/{id} — fetch one workflow (raw WorkflowJSON + metadata).
export const GET = withAuth(
  async (req, ctx) => {
    const row = await findScopedWorkflow(ctx.params.id, ctx)
    if (!row) throw new ApiError('not_found', 'Workflow not found.')
    return ok(mapWorkflowV1(row))
  },
  { scope: 'workflows:read', rateLimit: { limit: 120, windowMs: 60_000 } },
)

const PatchWorkflowSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(4000).optional(),
  trigger: z.enum(['manual', 'schedule']).optional(),
  schedule: z.string().nullable().optional(),
  status: z.enum(['draft', 'active', 'paused']).optional(),
  /** Replacement WorkflowJSON document — creates a new revision. */
  workflow: z.unknown().optional(),
  // ---- execution config ----
  runtime: z.enum(['local', 'hosted']).optional(),
  modelPreference: z.string().nullable().optional(),
  confidenceThreshold: z.number().nullable().optional(),
  autoHardenAfter: z.number().nullable().optional(),
  allowedTools: z.array(z.string()).nullable().optional(),
  allowedCredentials: z.array(z.string()).nullable().optional(),
})

// PATCH /v1/workflows/{id} — update metadata and/or replace the steps
// document (validated; step changes create an immutable revision).
export const PATCH = withAuth(
  async (req, ctx) => {
    const row = await findScopedWorkflow(ctx.params.id, ctx)
    if (!row) throw new ApiError('not_found', 'Workflow not found.')
    const body = await parseBody(req, PatchWorkflowSchema)

    const data: Record<string, unknown> = {}
    if (body.name !== undefined) data.name = body.name
    if (body.description !== undefined) data.description = body.description
    if (body.trigger !== undefined) data.trigger = body.trigger
    if (body.schedule !== undefined) data.schedule = body.schedule
    if (body.status !== undefined) data.status = body.status
    if (body.runtime !== undefined) data.runtime = body.runtime
    if (body.modelPreference !== undefined) data.modelPreference = body.modelPreference
    if (body.confidenceThreshold !== undefined) data.confidenceThreshold = body.confidenceThreshold
    if (body.autoHardenAfter !== undefined) data.autoHardenAfter = body.autoHardenAfter
    if (body.allowedTools !== undefined)
      data.allowedToolsJson = body.allowedTools ? JSON.stringify(body.allowedTools) : null
    if (body.allowedCredentials !== undefined)
      data.allowedCredentialsJson = body.allowedCredentials ? JSON.stringify(body.allowedCredentials) : null

    let warnings: unknown[] = []
    if (body.workflow !== undefined) {
      const validation = await validateWorkflowForWorkspace(body.workflow, ctx.workspace.id)
      if (!validation.ok) {
        throw new ApiError('validation_failed', 'Workflow failed validation.', {
          details: { issues: validation.issues, warnings: validation.warnings },
        })
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
    return okEnvelope({ data: mapWorkflowV1(updated!), warnings })
  },
  { scope: 'workflows:write', rateLimit: { limit: 60, windowMs: 60_000 } },
)

// DELETE /v1/workflows/{id}
export const DELETE = withAuth(
  async (req, ctx) => {
    const row = await findScopedWorkflow(ctx.params.id, ctx)
    if (!row) throw new ApiError('not_found', 'Workflow not found.')
    await db.workflow.delete({ where: { id: row.id } })
    return ok({ deleted: true })
  },
  { scope: 'workflows:write', rateLimit: { limit: 60, windowMs: 60_000 } },
)
