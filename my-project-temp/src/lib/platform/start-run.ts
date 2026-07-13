// Apical — shared run-start logic. One code path for every trigger surface:
// /api/workflows/[id]/run (UI + scheduler), /v1/workflows/{id}/run (public
// API), and /api/dev/run (legacy dev surface).

import { db } from '@/lib/db'
import { executeRun, parseSteps } from '@/lib/runtime'
import { broadcastRun } from '@/lib/platform/run-events'
import { resolveActiveRevision } from '@/lib/platform/workflow-revisions'
import type { Workflow } from '@prisma/client'

export class StartRunError extends Error {
  status: number
  constructor(message: string, status = 400) {
    super(message)
    this.name = 'StartRunError'
    this.status = status
  }
}

export interface StartRunOptions {
  trigger: 'manual' | 'schedule' | 'hook' | 'watch'
  /** Optional end-customer scope; must belong to the workflow's workspace. */
  connectedAccountId?: string | null
  /** Fallback acting user when the workflow row has no owner. */
  actingUserId?: string | null
  /**
   * Client idempotency key. Retried POSTs with the same key return the
   * original run instead of starting a duplicate.
   */
  idempotencyKey?: string | null
  /** Inbound hook payload, exposed to steps as `{{trigger.*}}`. */
  triggerPayload?: Record<string, unknown> | null
}

/**
 * Validate steps, create the Run (pinned to the active revision) + RunStep
 * rows, broadcast run:started, and fire off executeRun without awaiting.
 * Throws StartRunError with an HTTP status for caller-facing failures.
 */
export async function startWorkflowRun(
  workflow: Workflow,
  opts: StartRunOptions,
): Promise<{ runId: string; deduplicated?: boolean }> {
  // Idempotent replay: same key on the same workflow returns the prior run.
  const idempotencyKey = opts.idempotencyKey?.trim() || null
  if (idempotencyKey) {
    const existing = await db.run.findUnique({
      where: {
        workflowId_idempotencyKey: { workflowId: workflow.id, idempotencyKey },
      },
      select: { id: true },
    })
    if (existing) return { runId: existing.id, deduplicated: true }
  }

  let steps
  try {
    steps = parseSteps(workflow.stepsJson)
  } catch (e) {
    throw new StartRunError(
      `Workflow steps are invalid: ${(e as Error).message}`,
      422,
    )
  }
  if (steps.length === 0) {
    throw new StartRunError('Workflow has no steps to run', 400)
  }

  // Optional connected-account scope (validated against the workflow's
  // workspace so a caller can't pin someone else's account).
  let connectedAccountId: string | null = null
  if (opts.connectedAccountId) {
    const account = await db.connectedAccount.findFirst({
      where: {
        id: opts.connectedAccountId,
        status: 'active',
        ...(workflow.workspaceId ? { workspaceId: workflow.workspaceId } : {}),
      },
    })
    if (!account) {
      throw new StartRunError(
        'connectedAccountId not found in this workspace',
        400,
      )
    }
    connectedAccountId = account.id
  }

  // Pin the revision that will execute.
  const revisionId = await resolveActiveRevision(workflow.id)

  let run
  try {
    run = await db.run.create({
      data: {
        workflowId: workflow.id,
        status: 'running',
        trigger: opts.trigger,
        connectedAccountId,
        revisionId,
        idempotencyKey,
        startedAt: new Date(),
      },
    })
  } catch (e) {
    // Unique-constraint race on the idempotency key: return the winner.
    if (idempotencyKey) {
      const existing = await db.run.findUnique({
        where: {
          workflowId_idempotencyKey: { workflowId: workflow.id, idempotencyKey },
        },
        select: { id: true },
      })
      if (existing) return { runId: existing.id, deduplicated: true }
    }
    throw e
  }

  await db.runStep.createMany({
    data: steps.map((s, i) => ({
      runId: run.id,
      stepId: s.id,
      kind: s.kind,
      label: s.label,
      status: 'pending',
      order: i,
    })),
  })

  // Warm the relay so the socket connects before the first real event.
  broadcastRun(run.id, 'run:started', { runId: run.id, workflowId: workflow.id })

  // Fire and forget — the runtime streams progress over the relay.
  void executeRun(
    run.id,
    { ...workflow, userId: workflow.userId ?? opts.actingUserId ?? '' },
    steps,
    opts.trigger,
    opts.triggerPayload ? { trigger: opts.triggerPayload } : undefined,
  ).catch((err) => {
    console.error('[start-run] executeRun crashed:', err)
  })

  return { runId: run.id }
}

/**
 * Block until the run reaches a terminal state (or `awaiting_gate`), for
 * `POST /v1/workflows/{id}/run?wait=true`. Polls the DB; returns the final
 * row or the still-running row when `timeoutMs` elapses.
 */
export async function waitForRun(
  runId: string,
  timeoutMs = 60_000,
): Promise<{ status: string; timedOut: boolean }> {
  const deadline = Date.now() + Math.min(timeoutMs, 120_000)
  for (;;) {
    const run = await db.run.findUnique({
      where: { id: runId },
      select: { status: true },
    })
    if (!run) return { status: 'unknown', timedOut: false }
    if (run.status !== 'running') return { status: run.status, timedOut: false }
    if (Date.now() >= deadline) return { status: run.status, timedOut: true }
    await new Promise((r) => setTimeout(r, 750))
  }
}
