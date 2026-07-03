import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/with-auth'
import { tryParseWorkflowJSON } from '@/lib/apical-server'
import { validateWorkflowForWorkspace } from '@/lib/platform/workflow-validate-server'
import { findScopedWorkflow } from '@/lib/v1/mappers'
import type { WorkflowStep } from '@/lib/types'

// POST /v1/workflows/{id}/dry-run — walk the workflow WITHOUT executing any
// external effects. Every output is explicitly labeled simulated:true. Use
// this to preview what a run would touch; it is NOT a substitute for a run.
export const POST = withAuth(
  async (req, ctx) => {
    const row = await findScopedWorkflow(ctx.params.id, ctx)
    if (!row) {
      return NextResponse.json({ error: 'Workflow not found.' }, { status: 404 })
    }

    const doc = tryParseWorkflowJSON(row.stepsJson)
    const validation = await validateWorkflowForWorkspace(doc, ctx.workspace.id)

    const steps = doc.steps.map((step) => ({
      stepId: step.id,
      kind: step.kind,
      label: step.label,
      simulated: true as const,
      wouldDo: describeStep(step),
    }))

    return NextResponse.json({
      simulated: true,
      note: 'Dry run: no external calls were made, no LLM reasoning ran, no data was written. Outputs describe what a real run WOULD do.',
      valid: validation.ok,
      issues: validation.ok ? [] : validation.issues,
      warnings: validation.warnings,
      steps,
    })
  },
  { scope: 'workflows:read' },
)

function describeStep(step: WorkflowStep): Record<string, unknown> {
  switch (step.kind) {
    case 'tool':
      if (step.http) {
        return {
          action: 'http_request',
          method: step.http.method,
          url: step.http.url,
          usesCredential: step.http.auth?.ref ?? null,
        }
      }
      if (step.mcp) {
        return {
          action: 'mcp_call',
          integrationId: step.mcp.integrationId,
          tool: step.mcp.tool,
        }
      }
      if (step.code) {
        return {
          action: 'run_code',
          language: step.code.language,
          sourcePreview: step.code.source.slice(0, 200),
        }
      }
      return { action: 'named_tool', tool: step.tool ?? null, inputs: step.inputs ?? {} }
    case 'reason':
      return {
        action: 'llm_reasoning',
        promptPreview: (step.prompt ?? '').slice(0, 200),
        outputShape: step.outputShape ?? null,
        confidenceThreshold: step.confidenceThreshold ?? null,
      }
    case 'gate':
      return {
        action: 'pause_for_human_approval',
        gateMessage: step.gateMessage ?? 'Approval required.',
      }
    case 'spawn':
      return {
        action: 'delegate_to_subagent',
        taskPreview: (step.spawnPrompt ?? '').slice(0, 200),
      }
  }
}
