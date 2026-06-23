import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { mapWorkflow, mapExecutionPattern } from '@/lib/mappers'
import { parseWorkflowJSON, serializeWorkflowJSON } from '@/lib/apical-server'
import type { WorkflowStep } from '@/lib/types'

interface RouteCtx {
  params: Promise<{ id: string }>
}

interface HardenBody {
  stepId?: string
  rule?: string
}

// POST /api/workflows/[id]/harden — flip a `reason` step into a deterministic
// `tool` rule (self-optimization). Also upserts the matching ExecutionPattern
// and bumps the workflow's savings counters.
export async function POST(req: Request, { params }: RouteCtx) {
  try {
    const { id } = await params
    const body = (await req.json()) as HardenBody
    const stepId = (body.stepId || '').trim()
    const rule = (body.rule || '').trim()
    if (!stepId || !rule) {
      return NextResponse.json(
        { error: 'stepId and rule are required' },
        { status: 400 },
      )
    }

    const existing = await db.workflow.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json(
        { error: 'Workflow not found' },
        { status: 404 },
      )
    }

    const wfJson = parseWorkflowJSON(existing.stepsJson)
    const idx = wfJson.steps.findIndex((s) => s.id === stepId)
    if (idx === -1) {
      return NextResponse.json(
        { error: 'Step not found' },
        { status: 404 },
      )
    }
    const step = wfJson.steps[idx]
    if (step.kind !== 'reason') {
      return NextResponse.json(
        { error: `Only reason steps can be hardened (got kind=${step.kind})` },
        { status: 400 },
      )
    }
    if (step.hardened) {
      return NextResponse.json(
        { error: 'Step is already hardened' },
        { status: 400 },
      )
    }

    // Flip the step into a hardened `tool` step. Keep the label so the UI
    // shows continuity; strip the reason-only fields.
    const hardened: WorkflowStep = {
      id: step.id,
      kind: 'tool',
      label: step.label,
      tool: 'rule.apply',
      inputs: { rule },
      hardened: true,
      rule,
      note:
        step.note ||
        `Hardened from a reason step. Applies rule deterministically; no AI cost.`,
    }
    wfJson.steps[idx] = hardened

    const updated = await db.workflow.update({
      where: { id },
      data: {
        stepsJson: serializeWorkflowJSON(wfJson),
        aiCallsSaved: { increment: 50 },
        estCostSavedCents: { increment: 500 },
      },
    })

    // Upsert the execution pattern for this step + signature 'rule'.
    const existingPattern = await db.executionPattern.findFirst({
      where: { workflowId: id, stepId, signature: 'rule' },
    })
    let patternRow
    if (existingPattern) {
      patternRow = await db.executionPattern.update({
        where: { id: existingPattern.id },
        data: {
          hardened: true,
          ruleJson: JSON.stringify({ match: rule }),
          occurrences: { increment: 1 },
        },
      })
    } else {
      patternRow = await db.executionPattern.create({
        data: {
          workflowId: id,
          stepId,
          signature: 'rule',
          outputJson: JSON.stringify({ ruleApplied: true }),
          occurrences: 1,
          hardened: true,
          ruleJson: JSON.stringify({ match: rule }),
        },
      })
    }

    return NextResponse.json({
      workflow: mapWorkflow(updated),
      pattern: mapExecutionPattern(patternRow),
    })
  } catch (err) {
    console.error('[api/workflows/[id]/harden] failed:', err)
    return NextResponse.json(
      { error: 'Failed to harden step' },
      { status: 500 },
    )
  }
}
