import { withUser } from '@/lib/auth-helpers'
import { rateLimit } from '@/lib/rate-limit'
import { runDeterministicOutcomeCheck, stepsFromChatTrace } from '@/lib/platform/run-supervision'
import type { ExecutionStep } from '@/lib/apical/index'

interface AnalyzeBody {
  goal: string
  trace: ExecutionStep[]
  finalAnswer: string
  agentId?: string | null
}

// POST /api/agent/analyze-run — deterministic outcome check for a completed
// chat run. No LLM: the old passive prose review was replaced by autonomous
// run supervision (see run-supervision.ts). This just confirms, at zero cost,
// whether the trace shows real success. Workflows persist only via
// workflow_freeze / workflow_step_append / workflow_update.
export const POST = withUser(async (req, { user }) => {
  const rl = rateLimit(`analyze-run:${user.id}`, 60, 60_000)
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

  const steps = stepsFromChatTrace(trace)
  const stepFailed = steps.some((s) => s.status === 'error' || s.status === 'failed')
  const check = runDeterministicOutcomeCheck({
    steps,
    runStatus: stepFailed ? 'failed' : 'completed',
    workflowGoal: goal || finalAnswer,
  })

  return Response.json({
    success: check.ok,
    outcomeAchieved: check.ok,
    summary: check.summary,
    workflowAutoSaved: false,
  })
})
