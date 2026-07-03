import { withUser } from '@/lib/auth-helpers'
import { rateLimit } from '@/lib/rate-limit'
import { db } from '@/lib/db'
import { generateRunReview, stepsFromChatTrace } from '@/lib/platform/run-review'
import type { ExecutionStep } from '@/lib/apical/index'

interface AnalyzeBody {
  goal: string
  trace: ExecutionStep[]
  finalAnswer: string
  agentId?: string | null
}

// POST /api/agent/analyze-run — LLM review of a completed agent chat run.
//
// Review only: the old "safety net" that auto-saved a workflow from the
// client-supplied trace was removed (client data is unverifiable, and silent
// saves violate the explicit-freeze rule). Workflows persist only via
// workflow_freeze / workflow_update.
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

  if (body.agentId) {
    const wf = await db.workflow.findFirst({
      where: { id: body.agentId, userId: user.id },
      select: { name: true, stepsJson: true, modelPreference: true },
    })
    if (wf) {
      agentName = wf.name
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

  return Response.json({ ...review, workflowAutoSaved: false })
})
