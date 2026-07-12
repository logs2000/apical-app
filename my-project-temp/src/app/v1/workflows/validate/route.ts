import { withAuth } from '@/lib/with-auth'
import { ok, ApiError } from '@/lib/api/respond'

// POST /v1/workflows/validate — validate a WorkflowJSON document without
// saving anything. Checks: JSON Schema (Zod), unique step ids, kind-specific
// requirements, {{stepId.field}} targets earlier steps, integration refs
// exist in the workspace/registry, credential refs resolve (warnings).
import { validateWorkflowForWorkspace } from '@/lib/platform/workflow-validate-server'

export const POST = withAuth(
  async (req, { workspace }) => {
    const body = (await req.json().catch(() => null)) as { workflow?: unknown } | null
    const doc = body && typeof body === 'object' && 'workflow' in body ? body.workflow : body
    if (!doc) {
      throw new ApiError(
        'validation_failed',
        'Provide the WorkflowJSON document as the body or under a "workflow" key.',
      )
    }
    const result = await validateWorkflowForWorkspace(doc, workspace.id)
    return ok({ valid: result.ok, issues: result.issues, warnings: result.warnings })
  },
  { scope: 'workflows:read', rateLimit: { limit: 60, windowMs: 60_000 } },
)
