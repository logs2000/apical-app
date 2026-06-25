// Apical scheduler — a standalone bun mini-service that polls the Apical DB
// for due ScheduledJobs and fires them through the Next.js workflow run API.
//
// Pattern matches mini-services/run-relay/index.ts: a separate bun project
// with its own PrismaClient pointed at the same SQLite DB, no socket.io.
//
// Loop: every 15s, find active jobs whose nextRunAt <= now, fire each by
// POSTing to http://localhost:3000/api/workflows/<id>/run with body
// { trigger: 'schedule' } + an X-Scheduler-Secret header. On success, bump
// runCount, recompute nextRunAt. On failure, bump failureCount and back off;
// after 5 consecutive failures, pause the job.

import { PrismaClient } from '@prisma/client'
import { createServer, type IncomingMessage, type ServerResponse } from 'http'

// ---------------- Configuration ----------------

const PORT = 3004
const TICK_INTERVAL_MS = 15_000
const API_BASE = process.env.APICAL_API_BASE || 'http://localhost:3000'
const SCHEDULER_SECRET =
  process.env.APICAL_SCHEDULER_SECRET || 'apical-scheduler-dev'
const DATABASE_URL =
  process.env.DATABASE_URL || 'file:./db/custom.db'

// Prisma needs the URL in the env.
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = DATABASE_URL
}

const prisma = new PrismaClient()

// ---------------- Cron helpers (duplicated from src/lib/platform/cron.ts) ----------------
// The mini-service is a self-contained bun project — it doesn't share code
// with the Next.js app. The cron logic here mirrors the shared helper so the
// API routes (which use @/lib/platform/cron) and the scheduler compute
// nextRunAt identically.

type ScheduleKind = 'cron' | 'fixed_rate'

const FALLBACK_SECONDS = 3600

function parseFixedRate(schedule: string): number | null {
  const m = /^fixed_rate:(\d+)$/.exec(schedule.trim())
  if (!m) return null
  const n = parseInt(m[1], 10)
  if (!Number.isFinite(n) || n <= 0) return null
  return n
}

interface CronFields {
  minute: number[]
  hour: number[]
  dayOfMonth: number[]
  month: number[]
  dayOfWeek: number[]
}

const DAY_NAMES: Record<string, number> = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
}
const MONTH_NAMES: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
}

function parseField(
  raw: string,
  min: number,
  max: number,
  names?: Record<string, number>,
): number[] | null {
  const field = raw.trim().toLowerCase()
  if (field === '*') {
    const out: number[] = []
    for (let i = min; i <= max; i++) out.push(i)
    return out
  }
  const stepMatch = /^\*\/(\d+)$/.exec(field)
  if (stepMatch) {
    const step = parseInt(stepMatch[1], 10)
    if (!step || step <= 0) return null
    const out: number[] = []
    for (let i = min; i <= max; i += step) out.push(i)
    return out
  }
  const rangeMatch = /^(\d+)-(\d+)(?:\/(\d+))?$/.exec(field)
  if (rangeMatch) {
    const lo = parseInt(rangeMatch[1], 10)
    const hi = parseInt(rangeMatch[2], 10)
    const step = rangeMatch[3] ? parseInt(rangeMatch[3], 10) : 1
    if (lo < min || hi > max || lo > hi || step <= 0) return null
    const out: number[] = []
    for (let i = lo; i <= hi; i += step) out.push(i)
    return out
  }
  if (field.includes(',')) {
    const parts = field.split(',')
    const out: number[] = []
    for (const part of parts) {
      const sub = parseField(part, min, max, names)
      if (!sub) return null
      out.push(...sub)
    }
    return Array.from(new Set(out)).sort((a, b) => a - b)
  }
  let v: number
  if (/^\d+$/.test(field)) {
    v = parseInt(field, 10)
  } else if (names && field in names) {
    v = names[field]
  } else {
    return null
  }
  if (v < min || v > max) return null
  return [v]
}

function parseCron(schedule: string): CronFields | null {
  const parts = schedule.trim().split(/\s+/)
  if (parts.length !== 5) return null
  const [minF, hourF, domF, monF, dowF] = parts
  const minute = parseField(minF, 0, 59)
  const hour = parseField(hourF, 0, 23)
  const dayOfMonth = parseField(domF, 1, 31)
  const month = parseField(monF, 1, 12, MONTH_NAMES)
  const dayOfWeek = parseField(dowF, 0, 6, DAY_NAMES)
  if (!minute || !hour || !dayOfMonth || !month || !dayOfWeek) return null
  return { minute, hour, dayOfMonth, month, dayOfWeek }
}

function matchesCron(date: Date, f: CronFields): boolean {
  if (!f.minute.includes(date.getUTCMinutes())) return false
  if (!f.hour.includes(date.getUTCHours())) return false
  if (!f.month.includes(date.getUTCMonth() + 1)) return false
  const domStar = f.dayOfMonth.length === 31
  const dowStar = f.dayOfWeek.length === 7
  const domMatch = f.dayOfMonth.includes(date.getUTCDate())
  const dowMatch = f.dayOfWeek.includes(date.getUTCDay())
  if (domStar && dowStar) {
    // both unrestricted
  } else if (!domStar && !dowStar) {
    if (!domMatch && !dowMatch) return false
  } else {
    if (!domStar && !domMatch) return false
    if (!dowStar && !dowMatch) return false
  }
  return true
}

function computeNextRun(
  schedule: string,
  kind: ScheduleKind,
  _timezone: string | undefined,
  from: Date = new Date(),
): Date {
  if (kind === 'fixed_rate') {
    const secs = parseFixedRate(schedule)
    if (secs == null) return new Date(from.getTime() + FALLBACK_SECONDS * 1000)
    return new Date(from.getTime() + secs * 1000)
  }
  const fields = parseCron(schedule)
  if (!fields) return new Date(from.getTime() + FALLBACK_SECONDS * 1000)
  const start = new Date(from.getTime())
  start.setUTCSeconds(0, 0)
  start.setUTCMinutes(start.getUTCMinutes() + 1)
  const maxSteps = 366 * 24 * 60
  for (let i = 0; i < maxSteps; i++) {
    if (matchesCron(start, fields)) return start
    start.setUTCMinutes(start.getUTCMinutes() + 1)
  }
  return new Date(from.getTime() + FALLBACK_SECONDS * 1000)
}

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

// ---------------- One tick ----------------

async function tick(): Promise<void> {
  if (ticking) {
    console.log(`[scheduler ${ts()}] previous tick still running — skipping`)
    return
  }
  ticking = true
  lastTick = new Date()
  try {
    const due = await prisma.scheduledJob.findMany({
      where: { status: 'active', nextRunAt: { lte: new Date() } },
      take: 20,
      orderBy: { nextRunAt: 'asc' },
    })
    console.log(`[scheduler ${ts()}] tick: ${due.length} due job(s)`)
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
}): Promise<void> {
  const kind = (job.scheduleKind === 'fixed_rate' ? 'fixed_rate' : 'cron') as ScheduleKind
  console.log(
    `[scheduler ${ts()}] firing job ${job.id} → workflow ${job.workflowId} (${kind}:${job.schedule})`,
  )
  const result = await fireJob(job)
  const now = new Date()

  if (result.ok && result.runId) {
    const nextRunAt = computeNextRun(job.schedule, kind, job.timezone, now)
    await prisma.scheduledJob.update({
      where: { id: job.id },
      data: {
        lastRunAt: now,
        lastRunStatus: 'success',
        lastRunId: result.runId,
        runCount: { increment: 1 },
        failureCount: 0,
        nextRunAt,
        status: 'active',
      },
    })
    console.log(
      `[scheduler ${ts()}] ✓ job ${job.id} fired → run ${result.runId}; next at ${nextRunAt.toISOString()}`,
    )
    return
  }

  // Failure path.
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
      `[scheduler ${ts()}] ✗ job ${job.id} failed (attempt ${failureCount}): ${result.error}; retry at ${nextRunAt.toISOString()}`,
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
