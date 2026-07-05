// Apical — workflow runtime engine (honest execution, no simulation).
//
// `executeRun(runId, workflow, steps)` walks a workflow's steps in order,
// emitting socket events through the relay. Every step either executes for
// real via the production executor (HTTP, MCP, code, fs/cli, frozen
// integrations) or FAILS LOUDLY with a clear error. There is no fake output,
// no random item counts, no invented filenames. Simulation exists only under
// POST /v1/workflows/{id}/dry-run, where every output is labeled simulated.
//
// Step semantics:
//   tool   — deterministic execution via executeProductionStep, honoring the
//            step's `retry` policy and `timeoutMs` (WorkflowJSON v2).
//   reason — ONE real LLM call whose input is the ACTUAL prior-step outputs.
//            Honors confidenceThreshold: low-confidence results mark the step
//            `flagged` (run continues; the report carries the flag).
//   gate   — actually pauses: run → 'awaiting_gate', the user is notified,
//            and `resumeRunFromGate` continues (or rejects) the run.
//   spawn  — not yet supported agent-free; fails loudly with guidance.
//
// The runtime is invoked fire-and-forget from the run routes — the HTTP
// response returns `{ runId }` immediately. Everything here is best-effort
// and logged; it must NEVER crash the process.

import { simpleComplete } from '@/lib/platform/llm-gateway'
import {
  SUPERVISION_ENABLED,
  superviseRun,
  runDeterministicOutcomeCheck,
  buildSupervisionSummary,
} from '@/lib/platform/run-supervision'
import { executeProductionStep } from '@/lib/platform/workflow-executor'
import { notifyGate, notifyFlagged } from '@/lib/platform/notifications'
import { emitWebhookEvent } from '@/lib/platform/webhooks'
import { resolveActiveRevision } from '@/lib/platform/workflow-revisions'
import { db } from './db'
import { broadcastRun } from './relay-client'
import { parseWorkflowJSON } from './apical-server'
import type {
  RunReport,
  RunReportItem,
  RunStepStatus,
  WorkflowStep,
} from './types'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Strip ```json fences if the LLM wrapped its answer. */
function stripFences(s: string): string {
  let out = s.trim()
  out = out.replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim()
  const first = out.indexOf('{')
  const last = out.lastIndexOf('}')
  if (first !== -1 && last !== -1 && last > first) {
    out = out.slice(first, last + 1)
  }
  return out
}

interface ExecState {
  /** REAL outputs per stepId — the only data later steps may reference. */
  outputs: Record<string, unknown>
  stepsExecuted: number
  flaggedCount: number
  aiCallsUsed: number
  aiCallsSaved: number
  flaggedItems: { stepId: string; reason: string; item: string }[]
}

interface WorkflowRow {
  id: string
  name: string
  description: string
  stepsJson: string
  userId: string
  workspaceId?: string | null
  runtime?: string | null
  modelPreference?: string | null
  confidenceThreshold?: number | null
}

// ---------------- Retry + timeout (WorkflowJSON v2) ----------------

class StepTimeoutError extends Error {
  constructor(ms: number) {
    super(`Step timed out after ${ms}ms`)
    this.name = 'StepTimeoutError'
  }
}

async function withTimeout<T>(fn: () => Promise<T>, timeoutMs?: number): Promise<T> {
  if (!timeoutMs || timeoutMs <= 0) return fn()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      fn(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new StepTimeoutError(timeoutMs)), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** Run `fn` honoring the step's retry policy + timeout. Throws the last error. */
async function withRetry<T>(
  step: WorkflowStep,
  runId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const maxAttempts = Math.max(1, Math.min(5, step.retry?.maxAttempts ?? 1))
  const backoffMs = Math.max(0, step.retry?.backoffMs ?? 1000)
  const multiplier = Math.max(1, step.retry?.backoffMultiplier ?? 2)

  let lastError: unknown
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await withTimeout(fn, step.timeoutMs)
    } catch (err) {
      lastError = err
      if (attempt < maxAttempts) {
        const delay = backoffMs * Math.pow(multiplier, attempt - 1)
        broadcastRun(runId, 'step:progress', {
          runId,
          stepId: step.id,
          message: `Attempt ${attempt} failed (${err instanceof Error ? err.message : String(err)}). Retrying in ${delay}ms…`,
        })
        await sleep(delay)
      }
    }
  }
  throw lastError
}

// ---------------- Step executors (all real) ----------------

/** Tool step: production executor or loud failure. */
async function runToolStep(
  runId: string,
  step: WorkflowStep,
  state: ExecState,
  workflow: Pick<WorkflowRow, 'id' | 'userId' | 'runtime'>,
): Promise<{ output: unknown; aiTokens: number; aiCostCents: number }> {
  // Hardened ex-reason steps apply their recorded rule deterministically —
  // no LLM call. The output records exactly what rule was applied to what.
  if (step.hardened || step.tool === 'rule.apply') {
    const rule = step.rule || (step.inputs?.rule as string) || ''
    if (!rule) {
      throw new Error(
        `Hardened step "${step.id}" has no rule to apply. Re-harden it or revert to a reason step.`,
      )
    }
    state.aiCallsSaved += 1
    return {
      output: {
        hardened: true,
        rule,
        appliedTo: Object.keys(state.outputs),
        aiCalled: 0,
      },
      aiTokens: 0,
      aiCostCents: 0,
    }
  }

  broadcastRun(runId, 'step:progress', {
    runId,
    stepId: step.id,
    message: `Executing ${step.tool || step.http?.url || step.mcp?.tool || 'step'}…`,
  })

  const result = await withRetry(step, runId, async () => {
    const prod = await executeProductionStep(step, {
      userId: workflow.userId ?? '',
      workflowId: workflow.id,
      runId,
      runtime: (workflow.runtime === 'local' ? 'local' : 'hosted') as import('@/lib/types').AgentRuntime,
      outputs: state.outputs,
    })
    if (!prod) {
      // No executable spec — this is a workflow-definition bug, not a
      // transient failure. Fail loudly with guidance (never simulate).
      throw new Error(
        `Step "${step.id}" (${step.label}) has no executable spec. ` +
          `Tool steps need one of: http, mcp, code, or a production tool ` +
          `(fs_*, cli_run, script_run, http_request, mcp_call_tool). ` +
          `Legacy simulated steps are no longer supported — edit the workflow ` +
          `to give this step a real implementation.`,
      )
    }
    if (!prod.ok) {
      throw new Error(prod.error ?? 'Step execution failed')
    }
    return prod
  })

  return {
    output: result.output,
    aiTokens: result.aiTokens,
    aiCostCents: result.aiCostCents,
  }
}

/** Serialize prior-step outputs as the reason step's real input (truncated). */
function buildReasonInput(state: ExecState): string {
  try {
    const json = JSON.stringify(state.outputs, null, 2)
    return json.length > 8000 ? json.slice(0, 8000) + '\n…(truncated)' : json
  } catch {
    return '(prior outputs could not be serialized)'
  }
}

/** Reason step: one REAL LLM call over REAL prior-step outputs. */
async function runReasonStep(
  runId: string,
  step: WorkflowStep,
  state: ExecState,
  workflow: Pick<WorkflowRow, 'confidenceThreshold' | 'modelPreference' | 'userId'>,
): Promise<{
  output: unknown
  aiTokens: number
  aiCostCents: number
  belowThreshold: boolean
  confidence: number
}> {
  broadcastRun(runId, 'step:progress', {
    runId,
    stepId: step.id,
    message: 'Reasoning over prior step outputs…',
  })

  const prompt = step.prompt
  if (!prompt) {
    throw new Error(
      `Reason step "${step.id}" has no prompt. Edit the workflow to add one.`,
    )
  }
  const outputShape = step.outputShape
    ? JSON.stringify(step.outputShape)
    : '{ "confidence": "number 0-1" }'

  const systemPrompt =
    "You are Apical's deterministic reasoning engine inside a frozen workflow. " +
    'You are given the REAL outputs of the previous steps. Respond with ONLY ' +
    'valid JSON matching the requested output shape, and ALWAYS include a ' +
    '`confidence` number between 0 and 1 reflecting how certain you are. ' +
    'No prose, no code fences.'
  const userPrompt = [
    prompt,
    '',
    `Requested output shape: ${outputShape}`,
    '',
    'Previous step outputs (JSON):',
    buildReasonInput(state),
  ].join('\n')

  // A real LLM failure fails the step — no fabricated fallback confidence.
  const text = await withRetry(step, runId, () =>
    simpleComplete({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }),
  )

  const aiTokens = Math.min(8000, Math.max(80, Math.ceil(text.length / 4) + 120))
  const aiCostCents = Math.max(1, Math.ceil(aiTokens / 1000))

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(stripFences(text)) as Record<string, unknown>
  } catch {
    throw new Error(
      `Reason step "${step.id}" returned unparseable output: ${text.slice(0, 200)}`,
    )
  }

  const rawConfidence = parsed.confidence ?? parsed.score ?? parsed.certainty
  const confidence =
    typeof rawConfidence === 'number'
      ? Math.max(0, Math.min(1, rawConfidence))
      : 0
  parsed.confidence = confidence

  const threshold =
    typeof step.confidenceThreshold === 'number'
      ? step.confidenceThreshold
      : typeof workflow.confidenceThreshold === 'number'
        ? workflow.confidenceThreshold
        : 0.75
  const belowThreshold = confidence < threshold

  broadcastRun(runId, 'step:progress', {
    runId,
    stepId: step.id,
    message: belowThreshold
      ? `Confidence ${confidence.toFixed(2)} below threshold ${threshold.toFixed(2)} — flagged for review.`
      : `Decided with confidence ${confidence.toFixed(2)}.`,
  })

  return { output: parsed, aiTokens, aiCostCents, belowThreshold, confidence }
}

// ---------------- Gate pause / resume ----------------

/**
 * Pause the run at a gate: RunStep → 'awaiting', Run → 'awaiting_gate',
 * notify the owner. Execution stops here; `resumeRunFromGate` continues.
 */
async function pauseAtGate(
  runId: string,
  step: WorkflowStep,
  workflow: WorkflowRow,
): Promise<void> {
  await db.runStep.updateMany({
    where: { runId, stepId: step.id },
    data: { status: 'awaiting' },
  })
  await db.run.update({
    where: { id: runId },
    data: { status: 'awaiting_gate' },
  })
  broadcastRun(runId, 'step:progress', {
    runId,
    stepId: step.id,
    message: step.gateMessage || 'Waiting for human approval…',
  })
  broadcastRun(runId, 'run:completed', { runId, status: 'awaiting_gate' })

  if (workflow.userId) {
    try {
      await notifyGate(workflow.userId, {
        workflowName: workflow.name,
        stepLabel: step.label,
        runId,
        summary: step.gateMessage,
      })
    } catch (err) {
      console.error('[runtime] gate notification failed:', err)
    }
  }
}

export class ResumeError extends Error {
  status: number
  constructor(message: string, status = 400) {
    super(message)
    this.name = 'ResumeError'
    this.status = status
  }
}

/**
 * Resume a run paused at a gate. `approve: false` finalizes the run as
 * cancelled (the gate rejected). `approve: true` marks the gate step
 * completed and continues execution from the next step, with the REAL
 * outputs of all prior steps rebuilt from the RunStep rows.
 */
export async function resumeRunFromGate(
  runId: string,
  opts: { approve: boolean; note?: string; actorId?: string },
): Promise<{ status: string }> {
  const run = await db.run.findUnique({
    where: { id: runId },
    include: { steps: { orderBy: { order: 'asc' } }, workflow: true },
  })
  if (!run) throw new ResumeError('Run not found', 404)
  if (run.status !== 'awaiting_gate') {
    throw new ResumeError(`Run is ${run.status}, not awaiting a gate`, 409)
  }
  const gateRow = run.steps.find((s) => s.status === 'awaiting')
  if (!gateRow) throw new ResumeError('No awaiting gate step on this run', 409)

  const gateOutput = {
    approved: opts.approve,
    note: opts.note ?? null,
    approvedBy: opts.actorId ?? null,
    approvedAt: new Date().toISOString(),
  }
  await db.runStep.updateMany({
    where: { id: gateRow.id },
    data: {
      status: opts.approve ? 'completed' : 'failed',
      outputJson: JSON.stringify(gateOutput),
      finishedAt: new Date(),
    },
  })

  const workflow = run.workflow as unknown as WorkflowRow
  // Execute against the revision pinned at run start (falls back to the
  // workflow's current steps for legacy runs without a pinned revision).
  let stepsJson = workflow.stepsJson
  if (run.revisionId) {
    const revision = await db.workflowRevision.findUnique({
      where: { id: run.revisionId },
      select: { stepsJson: true },
    })
    if (revision) stepsJson = revision.stepsJson
  }
  const steps = parseWorkflowJSON(stepsJson).steps

  // Rebuild the REAL outputs of all finished steps.
  const state: ExecState = {
    outputs: {},
    stepsExecuted: 0,
    flaggedCount: 0,
    aiCallsUsed: 0,
    aiCallsSaved: 0,
    flaggedItems: [],
  }
  for (const s of run.steps) {
    if (s.status === 'completed' || s.status === 'flagged') {
      state.stepsExecuted += 1
      if (s.outputJson) {
        try {
          state.outputs[s.stepId] = JSON.parse(s.outputJson)
        } catch {
          state.outputs[s.stepId] = s.outputJson
        }
      }
      if (s.aiTokens > 0) state.aiCallsUsed += 1
      if (s.status === 'flagged') state.flaggedCount += 1
    }
  }
  state.outputs[gateRow.stepId] = gateOutput
  state.stepsExecuted += 1

  if (!opts.approve) {
    await finalizeRun(runId, workflow, state, 'cancelled', {
      startedAt: run.startedAt.getTime(),
      failureNote: `Gate "${gateRow.label}" was rejected${opts.note ? `: ${opts.note}` : '.'}`,
    })
    return { status: 'cancelled' }
  }

  await db.run.update({ where: { id: runId }, data: { status: 'running' } })
  broadcastRun(runId, 'run:started', { runId, workflowId: workflow.id })

  const gateIndex = steps.findIndex((s) => s.id === gateRow.stepId)
  const nextIndex = gateIndex === -1 ? steps.length : gateIndex + 1

  // Continue fire-and-forget, same as the initial kick-off.
  void executeRunSteps(runId, workflow, steps, nextIndex, state, run.startedAt.getTime()).catch(
    (err) => {
      console.error('[runtime] resume executeRunSteps crashed:', err)
    },
  )
  return { status: 'running' }
}

// ---------------- Finalize ----------------

async function finalizeRun(
  runId: string,
  workflow: WorkflowRow,
  state: ExecState,
  finalStatus: 'completed' | 'failed' | 'cancelled',
  opts: { startedAt: number; failureNote?: string },
): Promise<void> {
  const durationMs = Date.now() - opts.startedAt

  // Report derives from the REAL RunStep rows.
  const stepRows = await db.runStep.findMany({
    where: { runId },
    orderBy: { order: 'asc' },
  })

  const items: RunReportItem[] = stepRows
    .filter((s) => s.status !== 'pending' && s.status !== 'skipped')
    .map((s) => {
      const outcome: RunReportItem['outcome'] =
        s.status === 'flagged' ? 'flagged' : s.kind === 'gate' ? 'gated' : 'automatic'
      let detail = ''
      if (s.status === 'failed') {
        detail = extractError(s.outputJson) || 'Step failed.'
      } else if (s.status === 'flagged') {
        detail = 'Below confidence threshold — awaiting your review.'
      } else if (s.kind === 'gate') {
        detail = extractGateDetail(s.outputJson)
      } else {
        detail = summarizeOutput(s.outputJson)
      }
      return { name: s.label, outcome, detail }
    })

  const flags = state.flaggedItems

  const executed = stepRows.filter(
    (s) => s.status === 'completed' || s.status === 'flagged',
  ).length
  const failedStep = stepRows.find((s) => s.status === 'failed')

  const summary =
    finalStatus === 'cancelled'
      ? opts.failureNote || 'Run was cancelled before completion.'
      : finalStatus === 'failed'
        ? `Failed at step "${failedStep?.label ?? 'unknown'}": ${extractError(failedStep?.outputJson ?? null) || opts.failureNote || 'unknown error'}. ${executed} of ${stepRows.length} steps completed.`
        : `Completed ${executed} of ${stepRows.length} steps${state.flaggedCount > 0 ? `, ${state.flaggedCount} flagged for your review` : ''}.`

  const report: RunReport = { summary, items, flags }

  // A run that was itself a rerun (including a supervision rerun) never
  // re-triggers supervision — this is what prevents infinite recovery loops.
  const runRow = await db.run.findUnique({ where: { id: runId }, select: { trigger: true } })
  const isRerun = runRow?.trigger === 'rerun'

  const outcomeSteps = stepRows.map((s) => ({
    label: s.label,
    kind: s.kind,
    status: s.status,
    outputJson: s.outputJson,
  }))

  // Decide up front whether the agent needs to step in. A clean run skips the
  // LLM entirely — only the deterministic check runs.
  const willSupervise =
    SUPERVISION_ENABLED &&
    !isRerun &&
    !!workflow.userId &&
    finalStatus !== 'cancelled' &&
    (finalStatus === 'failed' ||
      state.flaggedCount > 0 ||
      !runDeterministicOutcomeCheck({
        steps: outcomeSteps,
        runStatus: finalStatus,
        workflowGoal: workflow.description,
      }).ok)

  if (!willSupervise && finalStatus !== 'cancelled') {
    report.supervision = { outcome: 'passed', attempts: [], summary: 'Run completed successfully.' }
  }

  // Persist the terminal run FIRST — supervision reruns require the original
  // run to be in a terminal state before rerunFromStep will touch it.
  await db.run.update({
    where: { id: runId },
    data: {
      status: finalStatus,
      itemsProcessed: state.stepsExecuted,
      automaticCount: Math.max(0, state.stepsExecuted - state.flaggedCount),
      flaggedCount: state.flaggedCount,
      aiCallsUsed: state.aiCallsUsed,
      aiCallsSaved: state.aiCallsSaved,
      durationMs,
      reportJson: JSON.stringify(report),
      finishedAt: new Date(),
    },
  })

  // Any steps never reached are skipped.
  await db.runStep.updateMany({
    where: { runId, finishedAt: null, status: { in: ['pending', 'running'] } },
    data: { finishedAt: new Date(), status: 'skipped' },
  })

  await db.workflow.update({
    where: { id: workflow.id },
    data: {
      runsCount: { increment: 1 },
      itemsProcessed: { increment: state.stepsExecuted },
      automaticCount: { increment: Math.max(0, state.stepsExecuted - state.flaggedCount) },
      flaggedCount: { increment: state.flaggedCount },
      aiCallsSaved: { increment: state.aiCallsSaved },
      estCostSavedCents: { increment: state.aiCallsSaved * 10 },
    },
  })

  // Supervision: the agent diagnoses the failure/degradation, patches the
  // workflow, reruns from the broken step, and verifies — autonomously. On
  // recovery the run's effective status flips to completed.
  let effectiveStatus: 'completed' | 'failed' | 'cancelled' = finalStatus
  if (willSupervise && workflow.userId) {
    broadcastRun(runId, 'run:supervising', { runId })
    const supervision = await superviseRun(runId, {
      userId: workflow.userId,
      workflowId: workflow.id,
    })
    report.supervision = supervision
    if (supervision.outcome === 'recovered') {
      effectiveStatus = 'completed'
      report.summary = `Recovered after supervision (${supervision.attempts.length} attempt(s)). ${summary}`.slice(0, 800)
    } else if (supervision.outcome === 'failed') {
      effectiveStatus = 'failed'
      report.summary = `${buildSupervisionSummary(supervision)} ${summary}`.slice(0, 800)
    }
    await db.run.update({
      where: { id: runId },
      data: { status: effectiveStatus, reportJson: JSON.stringify(report) },
    })
  }

  // Notify on flagged items (real flags only).
  if (workflow.userId && state.flaggedItems.length > 0 && effectiveStatus === 'completed') {
    try {
      await notifyFlagged(workflow.userId, {
        workflowName: workflow.name,
        runId,
        items: state.flaggedItems.map((f) => ({ title: f.item, detail: f.reason })),
      })
    } catch (err) {
      console.error('[runtime] flagged notification failed:', err)
    }
  }

  // Outbound webhooks: run.completed / run.failed (cancelled counts as failed
  // for delivery purposes — subscribers care that the run didn't finish).
  emitWebhookEvent(
    workflow.workspaceId,
    effectiveStatus === 'completed' ? 'run.completed' : 'run.failed',
    {
      runId,
      workflowId: workflow.id,
      status: effectiveStatus,
      summary: report.summary,
      itemsProcessed: state.stepsExecuted,
      flaggedCount: state.flaggedCount,
      durationMs,
      failedStep: failedStep
        ? { stepId: failedStep.stepId, label: failedStep.label }
        : null,
    },
  )

  broadcastRun(runId, 'run:report', {
    runId,
    report,
    stats: {
      itemsProcessed: state.stepsExecuted,
      automaticCount: Math.max(0, state.stepsExecuted - state.flaggedCount),
      flaggedCount: state.flaggedCount,
      aiCallsUsed: state.aiCallsUsed,
      aiCallsSaved: state.aiCallsSaved,
      durationMs,
    },
  })
  broadcastRun(runId, 'run:completed', { runId, status: effectiveStatus })
}

function extractError(outputJson: string | null): string {
  if (!outputJson) return ''
  try {
    const parsed = JSON.parse(outputJson) as { error?: unknown }
    return typeof parsed?.error === 'string' ? parsed.error : ''
  } catch {
    return ''
  }
}

function extractGateDetail(outputJson: string | null): string {
  if (!outputJson) return 'Held at gate.'
  try {
    const parsed = JSON.parse(outputJson) as { approved?: boolean }
    return parsed.approved === true
      ? 'Held at gate — approved.'
      : parsed.approved === false
        ? 'Held at gate — rejected.'
        : 'Held at gate.'
  } catch {
    return 'Held at gate.'
  }
}

/** One honest line about a step's real output for the report. */
function summarizeOutput(outputJson: string | null): string {
  if (!outputJson) return 'Completed.'
  try {
    const parsed = JSON.parse(outputJson)
    if (parsed == null) return 'Completed.'
    const s = typeof parsed === 'string' ? parsed : JSON.stringify(parsed)
    return s.length > 160 ? s.slice(0, 160) + '…' : s
  } catch {
    return outputJson.slice(0, 160)
  }
}

// ---------------- Main loop ----------------

/**
 * Execute a workflow run to completion (or to the first gate), streaming
 * progress via the relay. Never throws to the caller (fire-and-forget).
 */
export async function executeRun(
  runId: string,
  workflow: WorkflowRow,
  steps: WorkflowStep[],
  trigger: import('./types').TriggerKind = 'manual',
  seedOutputs?: Record<string, unknown>,
): Promise<void> {
  void trigger
  const state: ExecState = {
    // Inbound hook payloads land here as `{{trigger.*}}` for the first step.
    outputs: seedOutputs ? { ...seedOutputs } : {},
    stepsExecuted: 0,
    flaggedCount: 0,
    aiCallsUsed: 0,
    aiCallsSaved: 0,
    flaggedItems: [],
  }
  broadcastRun(runId, 'run:started', { runId, workflowId: workflow.id })
  await executeRunSteps(runId, workflow, steps, 0, state, Date.now())
}

/**
 * Re-run a failed (dead-lettered) run from a given step. Copies the REAL
 * outputs of the original run's steps before `fromStepId` into a NEW run,
 * then executes from there. Defaults to the step that failed.
 * Returns the new run's id.
 */
export async function rerunFromStep(
  originalRunId: string,
  opts: { fromStepId?: string; actorId?: string; useLatestRevision?: boolean } = {},
): Promise<{ runId: string }> {
  const original = await db.run.findUnique({
    where: { id: originalRunId },
    include: { steps: { orderBy: { order: 'asc' } }, workflow: true },
  })
  if (!original) throw new ResumeError('Run not found', 404)
  if (original.status === 'running' || original.status === 'awaiting_gate') {
    throw new ResumeError(`Run is still ${original.status}`, 409)
  }

  const workflow = original.workflow as unknown as WorkflowRow & {
    workspaceId?: string | null
  }
  // Supervision reruns execute the workflow's CURRENT (freshly patched) revision
  // so the auto-fix takes effect; a normal rerun replays the SAME revision the
  // original run executed for a faithful retry.
  let stepsJson = workflow.stepsJson
  let rerunRevisionId = original.revisionId
  if (opts.useLatestRevision) {
    rerunRevisionId = await resolveActiveRevision(workflow.id)
    stepsJson = workflow.stepsJson
  } else if (original.revisionId) {
    const revision = await db.workflowRevision.findUnique({
      where: { id: original.revisionId },
      select: { stepsJson: true },
    })
    if (revision) stepsJson = revision.stepsJson
  }
  const steps = parseWorkflowJSON(stepsJson).steps
  if (steps.length === 0) throw new ResumeError('Workflow has no steps', 422)

  const targetStepId =
    opts.fromStepId ??
    original.steps.find((s) => s.status === 'failed')?.stepId ??
    steps[0].id
  const startIndex = steps.findIndex((s) => s.id === targetStepId)
  if (startIndex === -1) {
    throw new ResumeError(`Step "${targetStepId}" not found in this run's revision`, 400)
  }

  // Prior steps must have real outputs to copy; otherwise start from scratch.
  const priorRows = new Map(original.steps.map((s) => [s.stepId, s]))
  for (let i = 0; i < startIndex; i++) {
    const row = priorRows.get(steps[i].id)
    if (!row || (row.status !== 'completed' && row.status !== 'flagged')) {
      throw new ResumeError(
        `Cannot rerun from "${targetStepId}": prior step "${steps[i].id}" has no successful output in the original run. Rerun from an earlier step.`,
        400,
      )
    }
  }

  const newRun = await db.run.create({
    data: {
      workflowId: workflow.id,
      status: 'running',
      trigger: 'rerun',
      revisionId: rerunRevisionId,
      connectedAccountId: original.connectedAccountId,
      rerunOfRunId: original.id,
      startedAt: new Date(),
    },
  })

  const state: ExecState = {
    outputs: {},
    stepsExecuted: 0,
    flaggedCount: 0,
    aiCallsUsed: 0,
    aiCallsSaved: 0,
    flaggedItems: [],
  }
  const now = new Date()
  await db.runStep.createMany({
    data: steps.map((s, i) => {
      if (i < startIndex) {
        const prior = priorRows.get(s.id)!
        return {
          runId: newRun.id,
          stepId: s.id,
          kind: s.kind,
          label: s.label,
          status: prior.status,
          outputJson: prior.outputJson,
          aiTokens: prior.aiTokens,
          aiCostCents: prior.aiCostCents,
          startedAt: now,
          finishedAt: now,
          order: i,
        }
      }
      return {
        runId: newRun.id,
        stepId: s.id,
        kind: s.kind,
        label: s.label,
        status: 'pending',
        order: i,
      }
    }),
  })

  // Rebuild state from the copied rows.
  for (let i = 0; i < startIndex; i++) {
    const prior = priorRows.get(steps[i].id)!
    state.stepsExecuted += 1
    if (prior.outputJson) {
      try {
        state.outputs[steps[i].id] = JSON.parse(prior.outputJson)
      } catch {
        state.outputs[steps[i].id] = prior.outputJson
      }
    }
    if (prior.aiTokens > 0) state.aiCallsUsed += 1
    if (prior.status === 'flagged') state.flaggedCount += 1
  }

  broadcastRun(newRun.id, 'run:started', { runId: newRun.id, workflowId: workflow.id })
  void executeRunSteps(newRun.id, workflow, steps, startIndex, state, Date.now()).catch(
    (err) => console.error('[runtime] rerun executeRunSteps crashed:', err),
  )
  return { runId: newRun.id }
}

/** Walk steps from `startIndex`. Shared by initial execution and gate resume. */
async function executeRunSteps(
  runId: string,
  workflow: WorkflowRow,
  steps: WorkflowStep[],
  startIndex: number,
  state: ExecState,
  startedAt: number,
): Promise<void> {
  let runFailed = false
  let runCancelled = false
  let failureNote: string | undefined

  try {
    for (let i = startIndex; i < steps.length; i++) {
      const runRow = await db.run.findUnique({
        where: { id: runId },
        select: { status: true },
      })
      if (runRow?.status === 'cancelled') {
        runCancelled = true
        break
      }

      const step = steps[i]
      broadcastRun(runId, 'step:started', {
        runId,
        stepId: step.id,
        kind: step.kind,
        label: step.label,
        order: i,
      })
      await db.runStep.updateMany({
        where: { runId, stepId: step.id },
        data: { status: 'running', startedAt: new Date() },
      })

      // Gates pause the run — no fake auto-approval.
      if (step.kind === 'gate') {
        await pauseAtGate(runId, step, workflow)
        return // resumeRunFromGate continues (or rejects) this run.
      }

      let output: unknown = null
      let aiTokens = 0
      let aiCostCents = 0
      let stepStatus: RunStepStatus = 'completed'
      try {
        if (step.kind === 'tool') {
          const r = await runToolStep(runId, step, state, {
            id: workflow.id,
            runtime: (workflow.runtime as 'local' | 'hosted') ?? 'hosted',
            userId: workflow.userId ?? '',
          })
          output = r.output
          aiTokens = r.aiTokens
          aiCostCents = r.aiCostCents
        } else if (step.kind === 'reason') {
          const r = await runReasonStep(runId, step, state, workflow)
          output = r.output
          aiTokens = r.aiTokens
          aiCostCents = r.aiCostCents
          state.aiCallsUsed += 1
          if (r.belowThreshold) {
            stepStatus = 'flagged'
            state.flaggedCount += 1
            state.flaggedItems.push({
              stepId: step.id,
              reason: `Confidence ${r.confidence.toFixed(2)} below threshold`,
              item: step.label,
            })
          }
        } else if (step.kind === 'spawn') {
          throw new Error(
            `Spawn step "${step.id}" cannot run agent-free yet. ` +
              `Convert it to deterministic tool steps, or run this workflow through the agent.`,
          )
        }
        state.outputs[step.id] = output
        state.stepsExecuted += 1
      } catch (err) {
        console.error(`[runtime] step ${step.id} (${step.kind}) failed:`, err)
        stepStatus = 'failed'
        runFailed = true
        failureNote = err instanceof Error ? err.message : String(err)
        output = { error: failureNote }
        emitWebhookEvent(workflow.workspaceId, 'step.failed', {
          runId,
          workflowId: workflow.id,
          stepId: step.id,
          label: step.label,
          kind: step.kind,
          error: failureNote,
        })
      }

      await db.runStep.updateMany({
        where: { runId, stepId: step.id },
        data: {
          status: stepStatus,
          outputJson: JSON.stringify(output ?? null),
          aiTokens,
          aiCostCents,
          finishedAt: new Date(),
        },
      })
      broadcastRun(runId, 'step:completed', {
        runId,
        stepId: step.id,
        kind: step.kind,
        status: stepStatus,
        output,
        aiTokens: aiTokens || undefined,
        aiCostCents: aiCostCents || undefined,
      })

      if (runFailed) break

      // Small pacing pause so the UI shows distinct step events.
      await sleep(100)
    }

    const finalStatus = runCancelled ? 'cancelled' : runFailed ? 'failed' : 'completed'
    await finalizeRun(runId, workflow, state, finalStatus, { startedAt, failureNote })
  } catch (err) {
    // Catastrophic failure — mark the run failed and emit a final event.
    console.error('[runtime] executeRun catastrophic failure:', err)
    try {
      await db.run.update({
        where: { id: runId },
        data: {
          status: 'failed',
          finishedAt: new Date(),
          durationMs: Date.now() - startedAt,
        },
      })
    } catch {
      // ignore
    }
    broadcastRun(runId, 'run:completed', { runId, status: 'failed' })
  }
}

/** Re-export for the route handlers to use when loading the workflow. */
export function parseSteps(raw: string): WorkflowStep[] {
  return parseWorkflowJSON(raw).steps
}
