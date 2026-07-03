import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/with-auth'
import { validateWorkflowForWorkspace } from '@/lib/platform/workflow-validate-server'

// POST /v1/workflows/validate — validate a WorkflowJSON document without
// saving anything. Checks: JSON Schema (Zod), unique step ids, kind-specific
// requirements, {{stepId.field}} targets earlier steps, integration refs
// exist in the workspace/registry, credential refs resolve (warnings).
export const POST = withAuth(
  async (req, { workspace }) => {
    const body = (await req.json().catch(() => null)) as
      | { workflow?: unknown }
      | null
    const doc = body && typeof body === 'object' && 'workflow' in body ? body.workflow : body
    if (!doc) {
      return NextResponse.json(
        { error: 'Provide the WorkflowJSON document as the body or under a "workflow" key.' },
        { status: 400 },
      )
    }
    const result = await validateWorkflowForWorkspace(doc, workspace.id)
    return NextResponse.json({
      valid: result.ok,
      issues: result.issues,
      warnings: result.warnings,
    })
  },
  { scope: 'workflows:read' },
)
