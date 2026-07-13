// Apical — run supervision.
//
// Agent-first execution: the agent owns the outcome of every run. Workflows are
// living accelerators the runtime replays for speed, but when a run fails or
// produces bad output the supervisor diagnoses the cause, patches the workflow,
// reruns from the broken step, and verifies success — autonomously, without
// notifying the user. If no automated fix exists (auth revoked, resource gone,
// gate rejected), it fails the run honestly instead of leaving it broken.
//
// This replaces the old passive `generateRunReview` (a prose write-up) and
// `runFailureOversight` (a chat-thread diagnosis the user had to act on).

import { db } from '@/lib/db'
import { simpleComplete, resolveModelPreferenceForUser } from '@/lib/platform/llm-gateway'
import { broadcastRun } from '@/lib/platform/run-events'
import { saveWorkflowSteps, patchWorkflowStep } from '@/lib/platform/workflow-revisions'
import { normalizeSteps } from '@/lib/deploy'
import type { RunSupervision, SupervisionAttempt, WorkflowStep } from '@/lib/types'

const MAX_SUPERVISION_ATTEMPTS = Number(process.env.RUN_SUPERVISION_MAX_ATTEMPTS ?? 3)
const SUPERVISION_WAIT_TIMEOUT_MS = Number(process.env.RUN_SUPERVISION_WAIT_MS ?? 180_000)
export const SUPERVISION_ENABLED = process.env.RUN_SUPERVISION_ENABLED !== 'false'

// ---------------- Shared deterministic outcome check (no LLM) ----------------

/** A run/trace step in a shape both production RunStep rows and chat traces satisfy. */
export interface OutcomeStep {
  label?: string
  kind?: string
  tool?: string
  status: string
  /** Chat traces carry a plain string; production rows carry JSON. */
  output?: string
  outputJson?: string | null
}

/** Meta-tools whose failure means an automation was never actually set up. */
const META_TOOLS = new Set([
  'workflow_freeze',
  'workflow_update',
  'workflow_improve',
  'workflow_step_append',
  'workflow_step_patch',
  'schedule_agent',
  'agent_create',
])

function stepOutputText(step: OutcomeStep): string {
  if (typeof step.output === 'string') return step.output
  if (!step.outputJson) return ''
  try {
    const parsed = JSON.parse(step.outputJson)
    return typeof parsed === 'string' ? parsed : JSON.stringify(parsed)
  } catch {
    return step.outputJson
  }
}

export function stepFailed(step: OutcomeStep): boolean {
  return step.status === 'failed' || step.status === 'error'
}

export function traceHasFailedSteps(steps: OutcomeStep[]): boolean {
  return steps.some(stepFailed)
}

export function failedStepsSummary(steps: OutcomeStep[]): string {
  return steps
    .filter(stepFailed)
    .map((s) => `${s.tool || s.label || 'step'}: ${(stepOutputText(s) || 'error').slice(0, 120)}`)
    .slice(0, 5)
    .join('; ')
}

export interface OutcomeCheckInput {
  steps: OutcomeStep[]
  runStatus: string
  workflowGoal?: string
}

export interface OutcomeCheckResult {
  ok: boolean
  summary: string
  failureSummary?: string
}

/**
 * Deterministic (no-LLM) judgement of whether a run actually achieved its
 * outcome. Catches failed/errored steps, meta-tool failures, a bad run status,
 * and a terminal step that "completed" but produced no output at all.
 */
export function runDeterministicOutcomeCheck(input: OutcomeCheckInput): OutcomeCheckResult {
  const runBad =
    input.runStatus === 'failed' ||
    input.runStatus === 'cancelled' ||
    input.runStatus === 'stopped'

  const failed = traceHasFailedSteps(input.steps)
  if (failed || runBad) {
    const detail = failedStepsSummary(input.steps)
    return {
      ok: false,
      summary: detail
        ? `Run did not fully succeed — ${detail}.`.slice(0, 400)
        : `Run status: ${input.runStatus}.`,
      failureSummary: detail,
    }
  }

  const metaFailed = input.steps.some(
    (s) => stepFailed(s) && META_TOOLS.has(s.tool ?? ''),
  )
  if (metaFailed) {
    return {
      ok: false,
      summary: 'Automation setup step failed — the workflow was not saved or scheduled.',
    }
  }

  // Terminal step completed but produced nothing — a silent "green but garbage" run.
  const runnable = input.steps.filter((s) => s.status !== 'skipped' && s.status !== 'pending')
  const terminal = runnable[runnable.length - 1]
  if (terminal && terminal.status === 'completed' && stepOutputText(terminal).trim() === '') {
    return {
      ok: false,
      summary: 'Final step completed but produced no output.',
    }
  }

  return { ok: true, summary: 'Run completed successfully.' }
}

/** Map a chat think-loop trace to outcome-check step rows. */
export function stepsFromChatTrace(
  trace: Array<{ action: string; tool?: string; status: string; result?: string }>,
): OutcomeStep[] {
  return trace.map((s) => ({
    label: s.action,
    tool: s.tool,
    status: s.status,
    output: s.result,
  }))
}

// ---------------- Supervision loop ----------------

interface FailureDiagnosis {
  diagnosis: string
  fixType: 'patch_step' | 'update_workflow' | 'impossible'
  patch?: { stepId: string; changes: Record<string, unknown> }
  newSteps?: WorkflowStep[]
  affectedStepIds: string[]
}

function stripFences(s: string): string {
  let out = s.trim()
  out = out.replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim()
  const first = out.indexOf('{')
  const last = out.lastIndexOf('}')
  if (first !== -1 && last !== -1 && last > first) out = out.slice(first, last + 1)
  return out
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

const DIAGNOSIS_SYSTEM = `You are the supervisor for an Apical agent automation. A run failed or produced bad output.
Your job: propose ONE minimal fix to the workflow JSON, OR declare fixType "impossible" if no automated fix exists (auth permanently revoked, required resource deleted, gate rejected by user, missing credential with no vault entry).

Respond ONLY with JSON:
{"diagnosis":"...","fixType":"patch_step"|"update_workflow"|"impossible","patch":{"stepId":"s2","changes":{...}},"newSteps":[...],"affectedStepIds":["s2"]}

Rules:
- Prefer patch_step over full update_workflow.
- Never embed secrets — use {{cred:service.field}} or credentialId refs.
- Parameterize with {{stepId.field}} / {{trigger.field}}, never hardcode one-run data.
- If the workflow is empty or missing the failed operation entirely, return fixType "update_workflow" with a complete newSteps array (keep existing step ids where possible).`

async function diagnose(params: {
  userId: string
  workflowName: string
  workflowDescription: string
  workflowStepsJson: string
  stepSummary: string
  reason: string
}): Promise<FailureDiagnosis | null> {
  try {
    const text = await simpleComplete({
      userId: params.userId,
      json: true,
      temperature: 0.1,
      maxTokens: 900,
      messages: [
        { role: 'system', content: DIAGNOSIS_SYSTEM },
        {
          role: 'user',
          content: [
            `Workflow: ${params.workflowName} — ${params.workflowDescription}`,
            `Workflow JSON:\n${params.workflowStepsJson.slice(0, 4000)}`,
            '',
            `Failure: ${params.reason}`,
            '',
            'Run steps (real results):',
            params.stepSummary,
          ].join('\n'),
        },
      ],
    })
    const obj = JSON.parse(stripFences(text)) as Partial<FailureDiagnosis>
    if (!obj.diagnosis || !obj.fixType) return null
    return {
      diagnosis: String(obj.diagnosis).slice(0, 2000),
      fixType:
        obj.fixType === 'patch_step' || obj.fixType === 'update_workflow'
          ? obj.fixType
          : 'impossible',
      patch:
        obj.patch && typeof obj.patch.stepId === 'string'
          ? { stepId: obj.patch.stepId, changes: (obj.patch.changes as Record<string, unknown>) ?? {} }
          : undefined,
      newSteps: Array.isArray(obj.newSteps) ? (obj.newSteps as WorkflowStep[]) : undefined,
      affectedStepIds: Array.isArray(obj.affectedStepIds)
        ? obj.affectedStepIds.map(String).slice(0, 10)
        : [],
    }
  } catch (err) {
    console.error('[run-supervision] diagnosis failed:', err)
    return null
  }
}

function stepRowsToOutcomeSteps(
  rows: Array<{ label: string; kind: string; status: string; outputJson: string | null }>,
): OutcomeStep[] {
  return rows.map((s) => ({
    label: s.label,
    kind: s.kind,
    // Production rows store the tool under kind; the check keys meta-tools off
    // `tool`, so surface the label as a best-effort tool hint too.
    tool: undefined,
    status: s.status,
    outputJson: s.outputJson,
  }))
}

function buildStepSummary(
  rows: Array<{ stepId: string; label: string; kind: string; status: string; outputJson: string | null }>,
): string {
  return rows
    .map((s) => {
      const out = (s.outputJson ?? '').slice(0, 400)
      return `- [${s.status}] ${s.stepId} "${s.label}" (${s.kind})${out ? ` → ${out}` : ''}`
    })
    .join('\n')
}

export function buildSupervisionSummary(supervision: RunSupervision): string {
  if (supervision.outcome === 'recovered') {
    return `Recovered after ${supervision.attempts.length} attempt(s).`
  }
  if (supervision.outcome === 'passed') {
    return 'Run completed successfully.'
  }
  const last = supervision.attempts[supervision.attempts.length - 1]
  if (!last) return 'Supervision found no automated fix.'
  return `Supervision could not recover after ${supervision.attempts.length} attempt(s): ${last.diagnosis}`.slice(0, 400)
}

/**
 * Diagnose a failed/degraded run, patch the workflow, rerun from the broken
 * step, and verify — up to MAX_SUPERVISION_ATTEMPTS. Returns the outcome.
 * Never throws (fire-and-forget safe).
 */
export async function superviseRun(
  runId: string,
  opts: { userId: string; workflowId: string },
): Promise<RunSupervision> {
  const attempts: SupervisionAttempt[] = []

  try {
    const modelId = await resolveModelPreferenceForUser(opts.userId, undefined)
    let currentRunId = runId

    for (let attempt = 1; attempt <= MAX_SUPERVISION_ATTEMPTS; attempt++) {
      const run = await db.run.findUnique({
        where: { id: currentRunId },
        include: { steps: { orderBy: { order: 'asc' } } },
      })
      const workflow = await db.workflow.findUnique({
        where: { id: opts.workflowId },
        select: { name: true, description: true, stepsJson: true },
      })
      if (!run || !workflow) break

      const failedStep = run.steps.find((s) => s.status === 'failed')
      const reason = failedStep
        ? `step ${failedStep.stepId} "${failedStep.label}" failed: ${(failedStep.outputJson ?? 'error').slice(0, 160)}`
        : 'run produced bad or incomplete output'

      if (!modelId) {
        attempts.push({
          attempt,
          reason,
          diagnosis: 'No model configured for automated supervision.',
          actions: [],
          result: 'skipped',
        })
        break
      }

      const diag = await diagnose({
        userId: opts.userId,
        workflowName: workflow.name,
        workflowDescription: workflow.description,
        workflowStepsJson: workflow.stepsJson,
        stepSummary: buildStepSummary(run.steps),
        reason,
      })

      if (!diag || diag.fixType === 'impossible') {
        attempts.push({
          attempt,
          reason,
          diagnosis: diag?.diagnosis ?? 'Could not diagnose an automated fix.',
          actions: [],
          result: 'skipped',
        })
        break
      }

      // Apply the fix to the workflow (creates a new revision).
      const actions: string[] = []
      let rerunFromStepId: string | undefined
      try {
        if (diag.fixType === 'patch_step' && diag.patch?.stepId) {
          await patchWorkflowStep(opts.workflowId, diag.patch.stepId, diag.patch.changes, {
            author: 'agent',
            note: 'supervision auto-fix',
          })
          actions.push(`patched step ${diag.patch.stepId}`)
          rerunFromStepId = diag.affectedStepIds[0] ?? diag.patch.stepId
        } else if (diag.fixType === 'update_workflow' && diag.newSteps?.length) {
          const steps = normalizeSteps(diag.newSteps as unknown[])
          await saveWorkflowSteps(
            opts.workflowId,
            { version: 1, steps },
            { author: 'agent', note: 'supervision auto-fix' },
          )
          actions.push(`rewrote workflow (${steps.length} steps)`)
          // Restructured steps may renumber — rerun from the first step.
          rerunFromStepId = steps[0]?.id
        } else {
          attempts.push({ attempt, reason, diagnosis: diag.diagnosis, actions, result: 'skipped' })
          break
        }
      } catch (err) {
        attempts.push({
          attempt,
          reason,
          diagnosis: diag.diagnosis,
          actions: [`fix failed to apply: ${errMsg(err)}`],
          result: 'failed',
        })
        break
      }

      broadcastRun(runId, 'run:supervision:attempt', { attempt, diagnosis: diag.diagnosis, actions })

      // Rerun against the freshly patched revision.
      let rerunId: string
      try {
        const { rerunFromStep } = await import('@/lib/runtime')
        const res = await rerunFromStep(currentRunId, {
          fromStepId: rerunFromStepId,
          useLatestRevision: true,
        })
        rerunId = res.runId
        actions.push(`rerun from ${rerunFromStepId ?? 'start'}`)
      } catch (err) {
        attempts.push({
          attempt,
          reason,
          diagnosis: diag.diagnosis,
          actions: [...actions, `rerun failed to start: ${errMsg(err)}`],
          result: 'failed',
        })
        break
      }

      const { waitForRun } = await import('@/lib/platform/start-run')
      const waited = await waitForRun(rerunId, SUPERVISION_WAIT_TIMEOUT_MS)

      const rerunSteps = await db.runStep.findMany({
        where: { runId: rerunId },
        orderBy: { order: 'asc' },
      })
      const check = runDeterministicOutcomeCheck({
        steps: stepRowsToOutcomeSteps(rerunSteps),
        runStatus: waited.status,
        workflowGoal: workflow.description,
      })

      if (waited.status === 'completed' && check.ok) {
        attempts.push({ attempt, reason, diagnosis: diag.diagnosis, actions, rerunId, result: 'success' })
        return {
          outcome: 'recovered',
          attempts,
          recoveredRunId: rerunId,
          summary: `Recovered after ${attempt} attempt(s): ${diag.diagnosis}`.slice(0, 300),
        }
      }

      attempts.push({ attempt, reason, diagnosis: diag.diagnosis, actions, rerunId, result: 'failed' })
      // Diagnose the rerun's own failure on the next iteration.
      currentRunId = rerunId
    }
  } catch (err) {
    console.error('[run-supervision] superviseRun crashed:', err)
  }

  const result: RunSupervision = { outcome: 'failed', attempts, summary: '' }
  result.summary = buildSupervisionSummary(result)
  return result
}
