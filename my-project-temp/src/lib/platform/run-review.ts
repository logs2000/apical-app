// Server-side post-run agent review — used after workflow runs and chat think-loops.

import { chat, resolveModelPreferenceForUser } from '@/lib/platform/llm-gateway'
import type { RunReview } from '@/lib/types'

export interface RunReviewInput {
  userId: string
  runId: string
  agentName: string
  agentGoal: string
  runStatus: 'completed' | 'failed' | 'cancelled' | 'stopped'
  durationMs?: number
  reportSummary?: string
  workflowStepsJson?: string
  modelPreference?: string | null
  steps: Array<{
    label: string
    kind?: string
    tool?: string
    status: string
    output?: string
  }>
  finalAnswer?: string
}

function summarizeSteps(steps: RunReviewInput['steps']): string {
  return steps
    .slice(0, 40)
    .map((s, i) => {
      const kind = s.tool || s.kind || 'step'
      const out = (s.output || '').slice(0, 500)
      return `${i + 1}. [${kind}] ${s.label} (${s.status})${out ? `: ${out}` : ''}`
    })
    .join('\n')
}

export function traceHasFailedSteps(steps: RunReviewInput['steps']): boolean {
  return steps.some((s) => s.status === 'failed' || s.status === 'error')
}

export function failedStepsSummary(steps: RunReviewInput['steps']): string {
  return steps
    .filter((s) => s.status === 'failed' || s.status === 'error')
    .map((s) => `${s.tool || s.label || 'step'}: ${(s.output || 'error').slice(0, 120)}`)
    .slice(0, 5)
    .join('; ')
}

/** Override optimistic LLM reviews when the step log shows failures. */
export function enforceReviewGroundTruth(review: RunReview, input: RunReviewInput): RunReview {
  const failed = traceHasFailedSteps(input.steps)
  const runBad =
    input.runStatus === 'failed' || input.runStatus === 'cancelled' || input.runStatus === 'stopped'
  if (!failed && !runBad) return review

  const failedSummary = failedStepsSummary(input.steps)
  const metaFailed = input.steps.some(
    (s) =>
      (s.status === 'error' || s.status === 'failed') &&
      ['workflow_freeze', 'schedule_agent', 'agent_create', 'workflow_update', 'workflow_improve'].includes(
        s.tool ?? '',
      ),
  )

  const suggestions = [...(review.workflowSuggestions ?? [])]
  if (metaFailed && !suggestions.some((s) => /workflow|automation|freeze|schedule/i.test(s))) {
    suggestions.push('Automation setup failed — fix the failed workflow/schedule steps before claiming success.')
  }
  if (failed && !suggestions.some((s) => /failed step/i.test(s))) {
    suggestions.push('Retry or fix the failed tool steps, then re-freeze the workflow if needed.')
  }

  return {
    success: false,
    outcomeAchieved: false,
    summary: failedSummary
      ? `Run did not fully succeed — ${failedSummary}. ${review.summary}`.slice(0, 600)
      : runBad
        ? `Run status: ${input.runStatus}. ${review.summary}`.slice(0, 600)
        : review.summary,
    efficiencyNotes: review.efficiencyNotes,
    workflowSuggestions: suggestions.length ? suggestions.slice(0, 5) : undefined,
  }
}

function fallbackReview(input: RunReviewInput): RunReview {
  const failed = input.runStatus === 'failed' || input.runStatus === 'cancelled' || input.runStatus === 'stopped'
  const stepFailed = input.steps.some((s) => s.status === 'failed' || s.status === 'error')
  return {
    success: !failed && !stepFailed,
    outcomeAchieved: !failed && !stepFailed,
    summary: failed
      ? 'Run did not complete successfully — review the step log manually.'
      : 'Automatic review unavailable — check the step log manually.',
    efficiencyNotes: undefined,
    workflowSuggestions: undefined,
  }
}

function parseReviewJson(raw: string): RunReview {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
  const parsed = JSON.parse(cleaned) as Partial<RunReview>
  const review: RunReview = {
    success: Boolean(parsed.success),
    outcomeAchieved: parsed.outcomeAchieved !== undefined ? Boolean(parsed.outcomeAchieved) : Boolean(parsed.success),
    summary: String(parsed.summary || 'Run review complete.').slice(0, 600),
    efficiencyNotes: parsed.efficiencyNotes ? String(parsed.efficiencyNotes).slice(0, 600) : undefined,
    workflowSuggestions: Array.isArray(parsed.workflowSuggestions)
      ? parsed.workflowSuggestions.map((s) => String(s).slice(0, 300)).slice(0, 5)
      : undefined,
  }
  if (review.workflowSuggestions?.length === 0) delete review.workflowSuggestions
  return review
}

/** LLM review: was the desired outcome achieved efficiently and effectively? */
export async function generateRunReview(input: RunReviewInput): Promise<RunReview> {
  const modelId =
    (await resolveModelPreferenceForUser(input.userId, input.modelPreference)) ?? undefined
  if (!modelId) return fallbackReview(input)

  const workflowContext = input.workflowStepsJson
    ? `\nAgent workflow JSON:\n${input.workflowStepsJson.slice(0, 4000)}`
    : ''

  const prompt = `Review this agent run critically. Determine whether the task actually succeeded, the desired outcome was achieved, and whether the run was efficient and effective. Suggest concrete workflow improvements when warranted.

IMPORTANT: If ANY step has status "error" or "failed", success and outcomeAchieved MUST be false — even if the agent's final message claims success. If workflow_freeze, schedule_agent, or agent_create failed, the automation was NOT set up.

Agent: ${input.agentName}
Agent purpose / goal:
${input.agentGoal || '(not specified)'}

Run status: ${input.runStatus}
Duration: ${input.durationMs != null ? `${Math.round(input.durationMs / 1000)}s` : 'unknown'}

Run report:
${input.reportSummary || '(none)'}

Step log:
${summarizeSteps(input.steps) || '(empty)'}

${input.finalAnswer ? `Final response to user:\n${input.finalAnswer.slice(0, 2000)}` : ''}
${workflowContext}

Workflow lifecycle rules:
- Phase 1 ACCOMPLISH: agent does the task with real tools first.
- Phase 2 LEARN: observe paths, APIs, scripts, integrations needed.
- Phase 3 DESIGN: workflow_freeze saves n8n-style deterministic automation (code, HTTP, MCP, integrations).
- Phase 4 OVERSEE: runtime executes automation; agent uses workflow_monitor + workflow_update when runs fail.
- On repeat runs the runtime executes the saved automation — the agent does NOT re-run tools unless fixing failures.
- After failures or inefficiency, suggest workflow_update / workflow_improve edits.

Respond with JSON only:
{
  "success": boolean,
  "outcomeAchieved": boolean,
  "summary": "1-2 sentences: did the run succeed and achieve the intended outcome?",
  "efficiencyNotes": "1-2 sentences on efficiency/effectiveness — redundant steps, wasted calls, bottlenecks, or confirm it ran well",
  "workflowSuggestions": ["optional concrete edits — e.g. 'call workflow_freeze to save this process' if no workflow exists yet, or 'update step s2 to use http_request with credentialId' if workflow exists"]
}`

  try {
    const result = await chat({
      userId: input.userId,
      modelId,
      source: 'workflow',
      refId: input.runId,
      temperature: 0.2,
      maxTokens: 700,
      messages: [
        {
          role: 'system',
          content:
            'You are a rigorous agent run reviewer. Judge actual outcomes, not just whether steps ran without errors. Be concise and practical. workflowSuggestions should be actionable edits only when something failed, was incomplete, inefficient, or clearly improvable.',
        },
        { role: 'user', content: prompt },
      ],
    })
    return enforceReviewGroundTruth(parseReviewJson(result.content), input)
  } catch (err) {
    console.error('[run-review] generateRunReview failed:', err)
    return fallbackReview(input)
  }
}

/** Map chat think-loop trace to review step rows. */
export function stepsFromChatTrace(
  trace: Array<{ action: string; tool?: string; status: string; result?: string }>,
): RunReviewInput['steps'] {
  return trace.map((s) => ({
    label: s.action,
    tool: s.tool,
    status: s.status,
    output: s.result,
  }))
}
