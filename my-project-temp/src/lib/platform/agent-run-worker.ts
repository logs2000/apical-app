// Durable agent-run execution — the logic behind mini-services/agent-worker.
//
// An AgentRun row is the source of truth: queued rows are claimed with a
// lease, executed with runAgent (which is transport-agnostic), checkpointed
// after every iteration, and resumed from the checkpoint when a worker dies
// mid-run. Every non-delta AgentEvent is persisted (AgentRunEvent, monotonic
// seq) AND broadcast over the run-relay; text deltas are relay-only so live
// typing doesn't spam the DB.
//
// This module is imported by the bun mini-service (always-on host) — keep it
// free of Next.js-specific APIs.

import { db } from '@/lib/db'
import {
  runAgent,
  type AgentEvent,
  type EngineCheckpoint,
} from './agent-engine'
import { broadcastAgentRun } from '@/lib/relay-client'
import { extractMemories } from './memory'

const LEASE_MS = 90_000
const HEARTBEAT_MS = 30_000
const CANCEL_POLL_MS = 10_000
/** Hard wall-clock ceiling per run (belt + suspenders over maxIterations). */
const MAX_RUN_MS = Number(process.env.AGENT_RUN_MAX_MS || 6 * 60 * 60 * 1000)

const DELTA_TYPES = new Set(['thought_delta', 'answer_delta', 'token'])

/** The AgentRunOptions subset persisted on the row at submit time. */
export interface StoredAgentRunOpts {
  context?: string
  history?: Array<{ role: 'user' | 'agent'; content: string }>
  attachments?: Array<{
    id: string
    name: string
    mimeType: string
    kind: string
    url: string
    localPath?: string | null
  }>
  script?: { language: 'javascript' | 'python' | 'shell'; code: string }
  priorPlan?: import('./agent-tools').PlanItem[]
  modelId?: string
  maxIterations?: number
  allowCli?: boolean
  isDesktop?: boolean
  source?: 'chat' | 'agent' | 'workflow' | 'reason' | 'research'
  /** Destructive-action gate (Protection 1/3). */
  approvalTier?: 'ask' | 'allowlist' | 'always'
  cliAllowlist?: string[]
  headless?: boolean
  approvedActionSignatures?: string[]
  /** Spawn runs: the JSON shape the final answer must match. */
  outputShape?: Record<string, string>
  /** Subagent runs may be given a restricted tool set. */
  allowedTools?: string[]
}

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

/** Atomically claim up to `limit` runnable rows for this worker. Reclaims
 *  expired leases (crashed workers) as well as fresh queued rows. */
export async function claimAgentRuns(workerId: string, limit: number): Promise<string[]> {
  const now = new Date()
  const claimed: string[] = []
  const candidates = await db.agentRun.findMany({
    where: {
      OR: [
        { status: 'queued' },
        // Crashed worker: running but lease expired → resume from checkpoint.
        { status: 'running', leaseUntil: { lt: now } },
        { status: 'cancelling', leaseUntil: { lt: now } },
      ],
    },
    orderBy: { createdAt: 'asc' },
    take: limit * 3, // headroom — some claims will be lost races
    select: { id: true, status: true, leaseUntil: true },
  })
  for (const c of candidates) {
    if (claimed.length >= limit) break
    // Expired-lease cancelling rows have nobody to service the abort — just cancel.
    if (c.status === 'cancelling') {
      await db.agentRun.updateMany({
        where: { id: c.id, status: 'cancelling' },
        data: { status: 'cancelled', finishedAt: new Date(), claimedBy: null, leaseUntil: null },
      })
      broadcastAgentRun(c.id, 'agentrun:completed', { status: 'cancelled' })
      continue
    }
    const res = await db.agentRun.updateMany({
      where: {
        id: c.id,
        OR: [{ status: 'queued' }, { status: 'running', leaseUntil: { lt: now } }],
      },
      data: {
        status: 'running',
        claimedBy: workerId,
        leaseUntil: new Date(Date.now() + LEASE_MS),
        startedAt: c.status === 'queued' ? new Date() : undefined,
      },
    })
    if (res.count === 1) claimed.push(c.id)
  }
  return claimed
}

/** Execute one claimed run to a terminal state. Never throws. */
export async function executeAgentRun(agentRunId: string, workerId: string): Promise<void> {
  const row = await db.agentRun.findUnique({ where: { id: agentRunId } })
  if (!row || row.claimedBy !== workerId || row.status !== 'running') return

  const opts = parseJson<StoredAgentRunOpts>(row.optsJson, {})
  const checkpoint = parseJson<EngineCheckpoint | null>(row.checkpointJson, null)

  // seq continues after whatever a previous (crashed) attempt persisted.
  const lastEvent = await db.agentRunEvent.findFirst({
    where: { agentRunId },
    orderBy: { seq: 'desc' },
    select: { seq: true },
  })
  let seq = (lastEvent?.seq ?? -1) + 1
  const persistedEvents: AgentEvent[] = []

  // Serialized event writes preserve ordering without blocking the loop.
  let writeChain: Promise<unknown> = Promise.resolve()
  const persistEvent = (event: AgentEvent) => {
    const mySeq = seq++
    persistedEvents.push(event)
    writeChain = writeChain
      .then(() =>
        db.agentRunEvent.create({
          data: { agentRunId, seq: mySeq, type: event.type, dataJson: JSON.stringify(event) },
        }),
      )
      .catch((e) => console.error(`[agent-worker] event write failed (${agentRunId}):`, e))
  }

  const abort = new AbortController()
  const startedAt = Date.now()

  const heartbeat = setInterval(() => {
    void db.agentRun
      .updateMany({
        where: { id: agentRunId, claimedBy: workerId },
        data: { leaseUntil: new Date(Date.now() + LEASE_MS) },
      })
      .catch(() => {})
    if (Date.now() - startedAt > MAX_RUN_MS) abort.abort()
  }, HEARTBEAT_MS)

  const cancelPoll = setInterval(() => {
    void db.agentRun
      .findUnique({ where: { id: agentRunId }, select: { status: true } })
      .then((r) => {
        if (r?.status === 'cancelling') abort.abort()
      })
      .catch(() => {})
  }, CANCEL_POLL_MS)

  let finalEvent: (AgentEvent & { type: 'final' }) | null = null

  const onEvent = (event: AgentEvent) => {
    broadcastAgentRun(agentRunId, 'agentrun:event', event)
    if (!DELTA_TYPES.has(event.type)) persistEvent(event)
    if (event.type === 'final') finalEvent = event as AgentEvent & { type: 'final' }
  }

  const onCheckpoint = (cp: EngineCheckpoint) => {
    const json = JSON.stringify(cp)
    void db.agentRun
      .updateMany({
        where: { id: agentRunId, claimedBy: workerId },
        data: { checkpointJson: json, iterations: cp.iterations },
      })
      .catch((e) => console.error(`[agent-worker] checkpoint write failed (${agentRunId}):`, e))
  }

  try {
    const result = await runAgent(
      {
        userId: row.userId,
        goal: row.goal,
        agentId: row.agentId,
        context: opts.context,
        history: opts.history,
        attachments: opts.attachments,
        script: opts.script,
        priorPlan: opts.priorPlan,
        modelId: opts.modelId,
        maxIterations: opts.maxIterations,
        allowCli: opts.allowCli,
        isDesktop: opts.isDesktop,
        source: opts.source ?? 'agent',
        // Destructive-action gate. A durable run driven by the worker with no
        // interactive client is headless UNLESS it originated from live chat.
        approvalTier: opts.approvalTier ?? 'always',
        cliAllowlist: opts.cliAllowlist,
        headless: opts.headless ?? row.origin !== 'chat',
        approvedActionSignatures: opts.approvedActionSignatures,
        signal: abort.signal,
        onCheckpoint,
        resumeFrom: checkpoint ?? undefined,
        isSubagent: row.origin === 'spawn',
        outputShape: opts.outputShape,
      },
      onEvent,
    )

    await writeChain
    const cancelled = abort.signal.aborted
    const latest = await db.agentRun.findUnique({ where: { id: agentRunId }, select: { status: true } })
    const wasCancelling = latest?.status === 'cancelling'
    const awaitingInput = !!(result.clarification || result.credentialRequests?.length || result.connectionRequests?.length)

    // A preflight abort (no model configured, allowance exhausted) returns
    // normally with an empty answer. Recording that as 'completed' shows the
    // user a successful run that said nothing — persist it as a failure.
    if (result.preflightError && !cancelled && !wasCancelling && !awaitingInput) {
      await db.agentRun.updateMany({
        where: { id: agentRunId, claimedBy: workerId },
        data: {
          status: 'failed',
          error: result.preflightError,
          iterations: result.iterations,
          checkpointJson: null,
          claimedBy: null,
          leaseUntil: null,
          finishedAt: new Date(),
        },
      })
      broadcastAgentRun(agentRunId, 'agentrun:completed', { status: 'failed', error: result.preflightError })
      return
    }

    const status = cancelled || wasCancelling ? 'cancelled' : awaitingInput ? 'awaiting_input' : 'completed'

    // Spawn runs with a requested output shape: parse the JSON answer so the
    // parent workflow step / agent_collect gets structured data.
    let structured: unknown
    if (opts.outputShape && result.answer) {
      try {
        const text = result.answer.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim()
        const start = text.indexOf('{')
        const end = text.lastIndexOf('}')
        if (start >= 0 && end > start) structured = JSON.parse(text.slice(start, end + 1))
      } catch {
        /* leave structured undefined — the raw answer is still available */
      }
    }

    await db.agentRun.updateMany({
      where: { id: agentRunId, claimedBy: workerId },
      data: {
        status,
        finalJson: JSON.stringify({ ...(finalEvent ?? { type: 'final', answer: result.answer }), ...(structured !== undefined ? { structured } : {}) }),
        iterations: result.iterations,
        checkpointJson: null,
        claimedBy: null,
        leaseUntil: null,
        finishedAt: new Date(),
      },
    })

    // Server-side persistence of the turn — the fix for "client disconnect
    // loses the run". Mirrors POST /api/agents/[id]/messages. Cancelled runs
    // are persisted by the cancelling client (as a "Stopped." turn) instead.
    if (row.agentId && status !== 'cancelled' && (result.answer || persistedEvents.length > 0)) {
      try {
        await db.agentMessage.create({
          data: {
            agentId: row.agentId,
            role: 'agent',
            content: result.answer || '(no answer)',
            // Deltas were never persisted, so this list already matches what
            // the client-side save path stores (non-token events).
            eventsJson: JSON.stringify(persistedEvents),
          },
        })
        await db.workflow.update({ where: { id: row.agentId }, data: { updatedAt: new Date() } })
      } catch (e) {
        console.error(`[agent-worker] agent message persist failed (${agentRunId}):`, e)
      }
    }

    broadcastAgentRun(agentRunId, 'agentrun:completed', { status, answer: result.answer })

    // Learn durable memories from this turn (chat runs only, not subagents).
    if (row.origin === 'chat' && status === 'completed' && result.answer) {
      void extractMemories({ userId: row.userId, agentId: row.agentId, userText: row.goal, answerText: result.answer })
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error(`[agent-worker] run ${agentRunId} failed:`, message)
    await writeChain.catch(() => {})
    await db.agentRun
      .updateMany({
        where: { id: agentRunId, claimedBy: workerId },
        data: {
          status: 'failed',
          error: message.slice(0, 2000),
          claimedBy: null,
          leaseUntil: null,
          finishedAt: new Date(),
        },
      })
      .catch(() => {})
    broadcastAgentRun(agentRunId, 'agentrun:completed', { status: 'failed', error: message })
  } finally {
    clearInterval(heartbeat)
    clearInterval(cancelPoll)
  }
}

/** How many runs a single user may have in flight at once. */
const PER_USER_CONCURRENT = 2

/** One worker tick: claim + start runs up to the concurrency budget.
 *  `inFlight` is owned by the caller (the mini-service main loop). */
export async function agentRunWorkerTick(
  workerId: string,
  inFlight: Map<string, Promise<void>>,
  maxConcurrent: number,
): Promise<void> {
  const slots = maxConcurrent - inFlight.size
  if (slots <= 0) return
  const ids = await claimAgentRuns(workerId, slots)
  for (const id of ids) {
    const row = await db.agentRun.findUnique({ where: { id }, select: { userId: true } })
    if (row) {
      const userActive = await db.agentRun.count({
        where: { userId: row.userId, status: 'running', id: { not: id } },
      })
      if (userActive >= PER_USER_CONCURRENT) {
        // Put it back in the queue — another user's runs get the slot.
        await db.agentRun.updateMany({
          where: { id, claimedBy: workerId },
          data: { status: 'queued', claimedBy: null, leaseUntil: null },
        })
        continue
      }
    }
    const p = executeAgentRun(id, workerId).finally(() => {
      inFlight.delete(id)
    })
    inFlight.set(id, p)
  }
}
