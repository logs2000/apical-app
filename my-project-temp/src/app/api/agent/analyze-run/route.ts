import { withUser } from '@/lib/auth-helpers'
import { rateLimit } from '@/lib/rate-limit'
import { db } from '@/lib/db'
import { parseWorkflowJSON } from '@/lib/apical-server'
import { generateRunReview, stepsFromChatTrace } from '@/lib/platform/run-review'
import { persistAgentWorkflowFromChatTrace, WORKFLOW_META_TOOLS } from '@/lib/platform/agent-tools'
import { buildStepsForFreeze } from '@/lib/platform/workflow-distill'
import { workflowStepsFromExecutionTrace, savedWorkflowHasExecutableSteps, type EngineTraceStep } from '@/lib/platform/workflow-trace'
import type { ExecutionStep } from '@/lib/apical/index'

function hasSubstantiveSteps(stepsJson?: string): boolean {
  return savedWorkflowHasExecutableSteps(stepsJson)
}

interface AnalyzeBody {
  goal: string
  trace: ExecutionStep[]
  finalAnswer: string
  agentId?: string | null
}

// POST /api/agent/analyze-run — LLM review of a completed agent chat run.
export const POST = withUser(async (req, { user }) => {
  const rl = rateLimit(`analyze-run:${user.id}`, 30, 60_000)
  if (!rl.ok) {
    return Response.json(
      { error: 'rate_limited', retryAfter: rl.retryAfter },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } },
    )
  }

  const body = (await req.json().catch(() => ({}))) as AnalyzeBody
  const goal = (body.goal || '').trim()
  const finalAnswer = (body.finalAnswer || '').trim()
  const trace = Array.isArray(body.trace) ? body.trace : []

  if (!goal && !finalAnswer) {
    return Response.json({ error: 'goal or finalAnswer is required' }, { status: 400 })
  }

  let agentName = 'Agent'
  let workflowStepsJson: string | undefined
  let modelPreference: string | null | undefined
  let agentDescription = ''

  if (body.agentId) {
    const wf = await db.workflow.findFirst({
      where: { id: body.agentId, userId: user.id },
      select: { name: true, description: true, stepsJson: true, modelPreference: true },
    })
    if (wf) {
      agentName = wf.name
      agentDescription = wf.description
      workflowStepsJson = wf.stepsJson
      modelPreference = wf.modelPreference
    }
  }

  const stepFailed = trace.some((s) => s.status === 'error')
  const review = await generateRunReview({
    userId: user.id,
    runId: `chat-${Date.now()}`,
    agentName,
    agentGoal: goal || finalAnswer,
    runStatus: stepFailed ? 'failed' : 'completed',
    reportSummary: undefined,
    workflowStepsJson,
    modelPreference,
    steps: stepsFromChatTrace(trace),
    finalAnswer,
  })

  const reviewFailed = !review.success || review.outcomeAchieved === false

  // Safety net: if the agent succeeded but never saved an owned workflow, persist
  // the proven trace so future runs can follow it.
  let workflowAutoSaved = false
  if (
    body.agentId &&
    !reviewFailed &&
    !stepFailed
  ) {
    let existingSteps = 0
    try {
      existingSteps = workflowStepsJson ? parseWorkflowJSON(workflowStepsJson).steps.length : 0
    } catch {
      existingSteps = 0
    }
    if (existingSteps === 0 || !hasSubstantiveSteps(workflowStepsJson)) {
      const saved = await persistAgentWorkflowFromChatTrace(
        body.agentId,
        user.id,
        trace,
        agentDescription || `${agentName} workflow`,
      )
      workflowAutoSaved = saved.ok
    }
  }

  return Response.json({ ...review, workflowAutoSaved })
})
