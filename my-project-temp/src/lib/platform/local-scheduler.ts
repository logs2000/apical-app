// Apical — in-process local scheduler (bundled desktop only).
//
// The standalone `mini-services/scheduler` bun service polls the CLOUD database
// and fires runs over HTTP. The bundled desktop app runs against a LOCAL SQLite
// DB and may be fully offline, so it can't rely on that service. Instead the
// bundled Next.js server (DESKTOP_LOCAL=true) runs this lightweight scheduler
// IN-PROCESS from the instrumentation hook.
//
// Because the server boots at app launch — including the `--hidden` launch-at-
// login path — scheduled workflows fire whenever the app is running in the
// background (hidden to tray), and resume automatically after a reboot once the
// autostart launch brings the app (and this server) back up.
//
// Unlike the cloud path this fires runs by calling `startWorkflowRun` directly
// (no HTTP, no shared secret) and skips the desktop-readiness/offline checks —
// the desktop is by definition present when this code runs.

import { db } from '@/lib/db'
import { computeNextRun, type ScheduleKind } from '@/lib/platform/cron'
import { startWorkflowRun } from '@/lib/platform/start-run'

const TICK_INTERVAL_MS = 15_000
// A run older than this that is still "running" counts as timed out for
// job-status purposes (the run itself may still finish later).
const RUN_TIMEOUT_MS = 60 * 60 * 1000

let started = false
let ticking = false

function ts(): string {
  return new Date().toISOString()
}

/** Start the local scheduler loop exactly once per server process. */
export function ensureLocalScheduler(): void {
  if (started) return
  if (process.env.DESKTOP_LOCAL !== 'true') return
  started = true
  console.log(`[local-scheduler ${ts()}] starting (tick ${TICK_INTERVAL_MS}ms)`)
  // Fire once shortly after boot so we don't wait a full tick, then interval.
  setTimeout(() => void tick(), 3_000)
  setInterval(() => void tick(), TICK_INTERVAL_MS).unref?.()
}

async function tick(): Promise<void> {
  if (ticking) return
  ticking = true
  try {
    await resolveOutcomes()
    const now = new Date()
    const due = await db.scheduledJob.findMany({
      where: { status: 'active', nextRunAt: { lte: now } },
      orderBy: { nextRunAt: 'asc' },
      take: 20,
    })
    for (const job of due) {
      try {
        await processJob(job)
      } catch (err) {
        console.error(`[local-scheduler ${ts()}] job ${job.id} crashed:`, err)
      }
    }
  } catch (err) {
    console.error(`[local-scheduler ${ts()}] tick failed:`, err)
  } finally {
    ticking = false
  }
}

interface JobRow {
  id: string
  workflowId: string
  schedule: string
  scheduleKind: string
  timezone: string
  failureCount: number
}

async function processJob(job: JobRow): Promise<void> {
  const kind: ScheduleKind = job.scheduleKind === 'fixed_rate' ? 'fixed_rate' : 'cron'
  const now = new Date()

  const workflow = await db.workflow.findUnique({ where: { id: job.workflowId } })
  if (!workflow || !workflow.userId) {
    console.warn(`[local-scheduler ${ts()}] job ${job.id}: workflow missing/unowned — skipping`)
    return
  }

  // Overlap lock: never stack scheduled runs. If a live run exists, just
  // advance nextRunAt so a stuck run doesn't make the job fire every tick.
  const liveRun = await db.run.findFirst({
    where: { workflowId: job.workflowId, status: { in: ['running', 'awaiting_gate'] } },
    select: { id: true },
  })
  if (liveRun) {
    await db.scheduledJob.update({
      where: { id: job.id },
      data: { nextRunAt: computeNextRun(job.schedule, kind, job.timezone, now) },
    })
    return
  }

  try {
    const { runId } = await startWorkflowRun(workflow, {
      trigger: 'schedule',
      actingUserId: workflow.userId,
    })
    await db.scheduledJob.update({
      where: { id: job.id },
      data: {
        lastRunAt: now,
        lastRunStatus: 'started',
        lastRunId: runId,
        runCount: { increment: 1 },
        nextRunAt: computeNextRun(job.schedule, kind, job.timezone, now),
        status: 'active',
      },
    })
    console.log(`[local-scheduler ${ts()}] job ${job.id} → run ${runId}`)
  } catch (err) {
    const failureCount = job.failureCount + 1
    const shouldPause = failureCount >= 5
    const backoffSecs = Math.min(60 * failureCount, 3600)
    await db.scheduledJob.update({
      where: { id: job.id },
      data: {
        lastRunAt: now,
        lastRunStatus: 'failed',
        failureCount: { increment: 1 },
        nextRunAt: new Date(now.getTime() + backoffSecs * 1000),
        status: shouldPause ? 'paused' : 'active',
      },
    })
    console.error(
      `[local-scheduler ${ts()}] job ${job.id} failed to start (attempt ${failureCount})` +
        (shouldPause ? ' — paused' : ''),
      err,
    )
  }
}

// Upgrade a job's lastRunStatus from "started" to the run's real terminal
// outcome. Five consecutive failed runs pause the job.
async function resolveOutcomes(): Promise<void> {
  const pending = await db.scheduledJob.findMany({
    where: { lastRunStatus: 'started', lastRunId: { not: null } },
    take: 50,
  })
  for (const job of pending) {
    try {
      const run = await db.run.findUnique({
        where: { id: job.lastRunId! },
        select: { status: true, startedAt: true },
      })
      if (!run) {
        await db.scheduledJob.update({ where: { id: job.id }, data: { lastRunStatus: 'failed' } })
        continue
      }
      if (run.status === 'running' || run.status === 'awaiting_gate') {
        if (
          run.status === 'running' &&
          Date.now() - run.startedAt.getTime() > RUN_TIMEOUT_MS
        ) {
          await db.scheduledJob.update({ where: { id: job.id }, data: { lastRunStatus: 'timeout' } })
        }
        continue
      }
      if (run.status === 'completed') {
        await db.scheduledJob.update({
          where: { id: job.id },
          data: { lastRunStatus: 'success', failureCount: 0 },
        })
      } else {
        const failureCount = job.failureCount + 1
        const shouldPause = failureCount >= 5
        await db.scheduledJob.update({
          where: { id: job.id },
          data: {
            lastRunStatus: 'failed',
            failureCount: { increment: 1 },
            ...(shouldPause ? { status: 'paused' } : {}),
          },
        })
      }
    } catch (err) {
      console.error(`[local-scheduler ${ts()}] outcome check ${job.id} crashed:`, err)
    }
  }
}
