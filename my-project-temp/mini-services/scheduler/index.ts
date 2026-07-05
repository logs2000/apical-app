// Apical scheduler — a standalone bun mini-service that polls the Apical DB
// for due ScheduledJobs and fires them through the Next.js workflow run API.
//
// Loop: every 15s,
//   1. Resolve outcomes: jobs whose last fired run has finished get their
//      lastRunStatus set from the ACTUAL run result (success/failed/timeout).
//      Consecutive run failures pause the job — a job that fires fine but
//      whose runs always fail is a failing job.
//   2. Fire due jobs: find active jobs with nextRunAt <= now and POST to
//      /api/workflows/<id>/run with the X-Scheduler-Secret header. A job
//      whose previous run is still going is SKIPPED (overlap lock) — runs
//      never stack.
//
// Cron parsing lives in ../../src/lib/platform/cron.ts (single shared
// implementation — bun imports the TS module directly).

import { PrismaClient } from '@prisma/client'
import { createServer, type IncomingMessage, type ServerResponse } from 'http'
import { computeNextRun, type ScheduleKind } from '../../src/lib/platform/cron'

// ---------------- Configuration ----------------

const PORT = 3004
const TICK_INTERVAL_MS = 15_000
const API_BASE = process.env.APICAL_API_BASE || 'http://localhost:3000'
// A run older than this that is still "running" counts as timed out for
// job-status purposes (the run itself may still finish later).
const RUN_TIMEOUT_MS = 60 * 60 * 1000
// No default: the Next.js API fails scheduler auth closed when this is unset,
// so booting without it would only produce 401s. Fail fast instead.
const SCHEDULER_SECRET = process.env.APICAL_SCHEDULER_SECRET || ''
if (!SCHEDULER_SECRET.trim()) {
  console.error(
    '[scheduler] APICAL_SCHEDULER_SECRET is not set. Set the same random secret ' +
      'here and on the Next.js app, then restart. Exiting.',
  )
  process.exit(1)
}
const DATABASE_URL =
  process.env.DATABASE_URL || 'file:./db/custom.db'

// Prisma needs the URL in the env.
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = DATABASE_URL
}

const prisma = new PrismaClient()

// ---------------- Scheduler state ----------------

const startedAt = Date.now()
let lastTick: Date | null = null
let ticking = false

function ts(): string {
  return new Date().toISOString()
}

// ---------------- Fire one job ----------------

interface FireResult {
  ok: boolean
  runId?: string
  error?: string
}

async function fireJob(job: {
  id: string
  workflowId: string
}): Promise<FireResult> {
  const url = `${API_BASE}/api/workflows/${job.workflowId}/run`
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Scheduler-Secret': SCHEDULER_SECRET,
      },
      body: JSON.stringify({ trigger: 'schedule' }),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 200)}` }
    }
    const data = (await res.json().catch(() => ({}))) as { runId?: string }
    if (!data.runId) {
      return { ok: false, error: 'response missing runId' }
    }
    return { ok: true, runId: data.runId }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

// ---------------- Outcome resolution (completion-based status) ----------------
//
// Firing a run successfully is NOT success. A job's lastRunStatus stays
// "started" until the run it produced reaches a terminal state; then it
// becomes "success" or "failed" based on what actually happened. Five
// consecutive failed RUNS pause the job.

async function resolveOutcomes(): Promise<void> {
  const pending = await prisma.scheduledJob.findMany({
    where: { lastRunStatus: 'started', lastRunId: { not: null } },
    take: 50,
  })
  for (const job of pending) {
    try {
      const run = await prisma.run.findUnique({
        where: { id: job.lastRunId! },
        select: { status: true, startedAt: true, reportJson: true },
      })
      if (!run) {
        await prisma.scheduledJob.update({
          where: { id: job.id },
          data: { lastRunStatus: 'failed' },
        })
        continue
      }
      if (run.status === 'running' || run.status === 'awaiting_gate') {
        // Still going. If it's been an hour, mark the job's view as timeout
        // (the run itself may still complete; the job just can't wait forever).
        if (
          run.status === 'running' &&
          Date.now() - run.startedAt.getTime() > RUN_TIMEOUT_MS
        ) {
          await prisma.scheduledJob.update({
            where: { id: job.id },
            data: { lastRunStatus: 'timeout' },
          })
          console.warn(
            `[scheduler ${ts()}] ⏱ job ${job.id}: run ${job.lastRunId} exceeded ${RUN_TIMEOUT_MS / 1000}s — marked timeout`,
          )
        }
        continue
      }

      // A run that failed initially but was recovered by supervision counts as
      // success for the schedule (the runtime already flips its status, but we
      // also honor supervision.outcome defensively).
      let recovered = false
      if (run.status !== 'completed' && run.reportJson) {
        try {
          const report = JSON.parse(run.reportJson) as {
            supervision?: { outcome?: string }
          }
          recovered = report.supervision?.outcome === 'recovered'
        } catch {
          // ignore malformed report
        }
      }

      if (run.status === 'completed' || recovered) {
        await prisma.scheduledJob.update({
          where: { id: job.id },
          data: { lastRunStatus: 'success', failureCount: 0 },
        })
        console.log(
          `[scheduler ${ts()}] ✓ job ${job.id}: run ${job.lastRunId} ${recovered ? 'recovered by supervision' : 'completed'}`,
        )
      } else {
        // failed | cancelled — the run did not do its work.
        const failureCount = job.failureCount + 1
        const shouldPause = failureCount >= 5
        await prisma.scheduledJob.update({
          where: { id: job.id },
          data: {
            lastRunStatus: 'failed',
            failureCount: { increment: 1 },
            ...(shouldPause ? { status: 'paused' } : {}),
          },
        })
        console.warn(
          `[scheduler ${ts()}] ✗ job ${job.id}: run ${job.lastRunId} ${run.status}` +
            (shouldPause ? ` — paused after ${failureCount} consecutive run failures` : ''),
        )
      }
    } catch (err) {
      console.error(`[scheduler ${ts()}] outcome check for job ${job.id} crashed:`, err)
    }
  }
}

// ---------------- One tick ----------------

async function tick(): Promise<void> {
  if (ticking) {
    console.log(`[scheduler ${ts()}] previous tick still running — skipping`)
    return
  }
  ticking = true
  lastTick = new Date()
  try {
    await resolveOutcomes()

    const due = await prisma.scheduledJob.findMany({
      where: { status: 'active', nextRunAt: { lte: new Date() } },
      take: 20,
      orderBy: { nextRunAt: 'asc' },
    })
    if (due.length > 0) {
      console.log(`[scheduler ${ts()}] tick: ${due.length} due job(s)`)
    }
    for (const job of due) {
      // Per-job try/catch so one failure doesn't kill the loop.
      try {
        await processJob(job)
      } catch (err) {
        console.error(
          `[scheduler ${ts()}] job ${job.id} (${job.workflowId}) crashed:`,
          err,
        )
      }
    }
  } catch (err) {
    console.error(`[scheduler ${ts()}] tick failed:`, err)
  } finally {
    ticking = false
  }
}

async function processJob(job: {
  id: string
  workflowId: string
  schedule: string
  scheduleKind: string
  timezone: string
  failureCount: number
  runCount: number
  offlinePolicy: string
  skippedCount: number
}): Promise<void> {
  const kind = (job.scheduleKind === 'fixed_rate' ? 'fixed_rate' : 'cron') as ScheduleKind
  const now = new Date()

  const workflow = await prisma.workflow.findUnique({
    where: { id: job.workflowId },
    select: { id: true, userId: true, name: true, runtime: true, stepsJson: true },
  })
  if (!workflow || !workflow.userId) {
    console.warn(`[scheduler ${ts()}] job ${job.id}: workflow missing or unowned — skipping`)
    return
  }

  // Local-runtime workflows need an online desktop with sufficient remote policy.
  if (workflow.runtime === 'local') {
    const { checkDesktopReadiness } = await import('../../src/lib/platform/scheduler-guards')
    const readiness = await checkDesktopReadiness(prisma, workflow.userId, workflow.stepsJson)

    if (!readiness.online) {
      const policy = job.offlinePolicy === 'catch_up' ? 'catch_up' : 'skip'
      if (policy === 'catch_up') {
        console.log(
          `[scheduler ${ts()}] ⏸ job ${job.id} waiting — desktop offline (catch_up); nextRunAt unchanged`,
        )
        return
      }
      const nextRunAt = computeNextRun(job.schedule, kind, job.timezone, now)
      await prisma.scheduledJob.update({
        where: { id: job.id },
        data: {
          lastRunAt: now,
          lastRunStatus: 'skipped_offline',
          skippedCount: { increment: 1 },
          nextRunAt,
        },
      })
      console.log(
        `[scheduler ${ts()}] ⏭ job ${job.id} skipped_offline — desktop not connected; next at ${nextRunAt.toISOString()}`,
      )
      return
    }

    if (readiness.blockedCapability) {
      const nextRunAt = computeNextRun(job.schedule, kind, job.timezone, now)
      await prisma.scheduledJob.update({
        where: { id: job.id },
        data: {
          lastRunAt: now,
          lastRunStatus: 'skipped_policy',
          skippedCount: { increment: 1 },
          nextRunAt,
        },
      })
      console.log(
        `[scheduler ${ts()}] ⏭ job ${job.id} skipped_policy — remote access blocked (${readiness.blockedCapability})`,
      )
      return
    }
  }

  // Overlap lock: if this workflow still has a live run (from this job or
  // anywhere else), skip this fire entirely — scheduled runs never stack.
  // nextRunAt advances so a stuck run doesn't make the job fire every tick.
  const liveRun = await prisma.run.findFirst({
    where: {
      workflowId: job.workflowId,
      status: { in: ['running', 'awaiting_gate'] },
    },
    select: { id: true, status: true },
  })
  if (liveRun) {
    const nextRunAt = computeNextRun(job.schedule, kind, job.timezone, now)
    await prisma.scheduledJob.update({
      where: { id: job.id },
      data: { nextRunAt },
    })
    console.log(
      `[scheduler ${ts()}] ⏭ job ${job.id} skipped — workflow ${job.workflowId} has a live run (${liveRun.id}, ${liveRun.status}); next attempt ${nextRunAt.toISOString()}`,
    )
    return
  }

  console.log(
    `[scheduler ${ts()}] firing job ${job.id} → workflow ${job.workflowId} (${kind}:${job.schedule})`,
  )
  const result = await fireJob(job)

  if (result.ok && result.runId) {
    const nextRunAt = computeNextRun(job.schedule, kind, job.timezone, now)
    await prisma.scheduledJob.update({
      where: { id: job.id },
      data: {
        lastRunAt: now,
        // "started", not "success" — resolveOutcomes() upgrades this once the
        // run actually finishes.
        lastRunStatus: 'started',
        lastRunId: result.runId,
        runCount: { increment: 1 },
        nextRunAt,
        status: 'active',
      },
    })
    console.log(
      `[scheduler ${ts()}] → job ${job.id} fired → run ${result.runId}; next at ${nextRunAt.toISOString()}`,
    )
    return
  }

  // Fire failure path (the API refused or was unreachable).
  const failureCount = job.failureCount + 1
  const backoffSecs = Math.min(60 * failureCount, 3600)
  const nextRunAt = new Date(now.getTime() + backoffSecs * 1000)
  const shouldPause = failureCount >= 5

  await prisma.scheduledJob.update({
    where: { id: job.id },
    data: {
      lastRunAt: now,
      lastRunStatus: 'failed',
      failureCount: { increment: 1 },
      nextRunAt,
      status: shouldPause ? 'paused' : 'active',
    },
  })

  if (shouldPause) {
    console.warn(
      `[scheduler ${ts()}] ⚠ job ${job.id} paused after ${failureCount} consecutive failures (last error: ${result.error})`,
    )
  } else {
    console.error(
      `[scheduler ${ts()}] ✗ job ${job.id} failed to fire (attempt ${failureCount}): ${result.error}; retry at ${nextRunAt.toISOString()}`,
    )
  }
}

// ---------------- OAuth token refresh tick ----------------
//
// Every OAUTH_REFRESH_INTERVAL_MS, call /api/oauth/refresh-all on the Apical
// API. That endpoint finds every active OAuth credential whose access token
// expires within the next hour and refreshes it using the stored refresh
// token. This is the "token refresh cron" — without it, OAuth credentials
// silently expire and workflows start failing with 401s.
//
// The endpoint is guarded by APICAL_SCHEDULER_SECRET (same as the workflow
// fire endpoint) so anonymous traffic can't trigger mass refreshes.

const OAUTH_REFRESH_INTERVAL_MS = 5 * 60 * 1000 // every 5 minutes
let lastOAuthRefreshAt: Date | null = null
let lastOAuthRefreshSummary: {
  checked: number
  refreshed: number
  failed: number
  at: string
} | null = null

async function refreshOAuthTick() {
  try {
    const url = `${API_BASE}/api/oauth/refresh-all`
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Scheduler-Secret': SCHEDULER_SECRET,
      },
    })
    const data = (await resp.json().catch(() => ({}))) as {
      checked?: number
      refreshed?: number
      failed?: number
      error?: string
    }
    lastOAuthRefreshAt = new Date()
    lastOAuthRefreshSummary = {
      checked: data.checked ?? 0,
      refreshed: data.refreshed ?? 0,
      failed: data.failed ?? 0,
      at: lastOAuthRefreshAt.toISOString(),
    }
    if (data.error) {
      console.error(
        `[scheduler ${ts()}] ✗ oauth refresh tick error: ${data.error}`,
      )
    } else if ((data.refreshed ?? 0) > 0 || (data.failed ?? 0) > 0) {
      console.log(
        `[scheduler ${ts()}] ↻ oauth refresh: ${data.refreshed} ok / ${data.failed} failed / ${data.checked} checked`,
      )
    }
  } catch (err) {
    console.error(`[scheduler ${ts()}] ✗ oauth refresh tick failed:`, err)
  }
}

// ---------------- HTTP server (health endpoint) ----------------

const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  if (req.method !== 'GET' || req.url !== '/') {
    res.statusCode = 404
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ error: 'not found' }))
    return
  }
  try {
    const activeCount = await prisma.scheduledJob.count({
      where: { status: 'active' },
    })
    res.statusCode = 200
    res.setHeader('Content-Type', 'application/json')
    res.end(
      JSON.stringify({
        status: 'ok',
        jobs: activeCount,
        lastTick: lastTick ? lastTick.toISOString() : null,
        oauthRefresh: lastOAuthRefreshSummary,
        uptime: Math.floor((Date.now() - startedAt) / 1000),
      }),
    )
  } catch (err) {
    res.statusCode = 500
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ status: 'error', error: String(err) }))
  }
})

// ---------------- Graceful shutdown ----------------

let shuttingDown = false
function shutdown(signal: string) {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`[scheduler ${ts()}] received ${signal}, shutting down...`)
  httpServer.close(() => {
    console.log(`[scheduler ${ts()}] http server closed`)
    prisma
      .$disconnect()
      .then(() => {
        console.log(`[scheduler ${ts()}] prisma disconnected`)
        process.exit(0)
      })
      .catch((err) => {
        console.error(`[scheduler ${ts()}] prisma disconnect failed:`, err)
        process.exit(1)
      })
  })
  // Force exit after a short grace period.
  setTimeout(() => {
    console.error(`[scheduler ${ts()}] forced exit after shutdown timeout`)
    process.exit(1)
  }, 5000).unref()
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

// ---------------- Boot ----------------

httpServer.listen(PORT, () => {
  console.log(`Apical scheduler listening on port ${PORT}`)
  console.log(
    `[scheduler ${ts()}] API base = ${API_BASE}; tick interval = ${TICK_INTERVAL_MS}ms`,
  )
  // Fire once immediately so we don't wait 15s for the first poll.
  void tick()
  setInterval(() => {
    void tick()
  }, TICK_INTERVAL_MS)

  // OAuth refresh tick: every 5 minutes, refresh credentials whose access
  // tokens expire within the next hour. Fire once at boot (after a short
  // delay so the API has time to come up) then on the interval.
  setTimeout(() => void refreshOAuthTick(), 30_000)
  setInterval(() => {
    void refreshOAuthTick()
  }, OAUTH_REFRESH_INTERVAL_MS)
})
