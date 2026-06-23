import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withUser } from '@/lib/auth-helpers'
import { computeNextRun, validateSchedule } from '@/lib/platform/cron'
import type { ScheduledJob } from '@prisma/client'

// API routes for /api/scheduler/jobs.
//
//   GET    — list the current user's ScheduledJobs (includes the workflow name).
//   POST   — create a new ScheduledJob. Validates the workflow belongs to the
//             user, validates the schedule shape, computes nextRunAt, persists.
//
// NOTE: ScheduledJob has no `workflow` relation in the schema (only a scalar
// `workflowId`). We fetch the workflow name in a follow-up query and stitch it
// onto the response.

interface JobDto {
  id: string
  userId: string
  workflowId: string
  workflowName: string | null
  schedule: string
  scheduleKind: string
  timezone: string
  status: string
  nextRunAt: string
  lastRunAt: string | null
  lastRunStatus: string | null
  lastRunId: string | null
  runCount: number
  failureCount: number
  createdAt: string
  updatedAt: string
}

function mapJob(row: ScheduledJob, workflowName: string | null): JobDto {
  return {
    id: row.id,
    userId: row.userId,
    workflowId: row.workflowId,
    workflowName,
    schedule: row.schedule,
    scheduleKind: row.scheduleKind,
    timezone: row.timezone,
    status: row.status,
    nextRunAt: row.nextRunAt.toISOString(),
    lastRunAt: row.lastRunAt ? row.lastRunAt.toISOString() : null,
    lastRunStatus: row.lastRunStatus,
    lastRunId: row.lastRunId,
    runCount: row.runCount,
    failureCount: row.failureCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

/** Bulk-load workflow names for a list of jobs (one round-trip). */
async function loadWorkflowNames(
  workflowIds: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (workflowIds.length === 0) return out
  const unique = Array.from(new Set(workflowIds))
  const rows = await db.workflow.findMany({
    where: { id: { in: unique } },
    select: { id: true, name: true },
  })
  for (const r of rows) out.set(r.id, r.name)
  return out
}

// GET /api/scheduler/jobs — list the user's scheduled jobs.
export const GET = withUser(async (_req, { user }) => {
  const rows = await db.scheduledJob.findMany({
    where: { userId: user.id },
    orderBy: { nextRunAt: 'asc' },
  })
  const names = await loadWorkflowNames(rows.map((r) => r.workflowId))
  return NextResponse.json(rows.map((r) => mapJob(r, names.get(r.workflowId) ?? null)))
})

interface CreateBody {
  workflowId?: string
  schedule?: string
  scheduleKind?: 'cron' | 'fixed_rate'
  timezone?: string
}

// POST /api/scheduler/jobs — create a scheduled job.
export const POST = withUser(async (req, { user }) => {
  let body: CreateBody = {}
  try {
    body = (await req.json()) as CreateBody
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  const workflowId = (body.workflowId || '').trim()
  if (!workflowId) {
    return NextResponse.json({ error: 'workflowId is required' }, { status: 400 })
  }
  const scheduleKind: 'cron' | 'fixed_rate' =
    body.scheduleKind === 'fixed_rate' ? 'fixed_rate' : 'cron'
  const schedule = (body.schedule || '').trim()
  const scheduleError = validateSchedule(schedule, scheduleKind)
  if (scheduleError) {
    return NextResponse.json({ error: scheduleError }, { status: 400 })
  }
  const timezone = (body.timezone || 'UTC').trim()

  // Validate the workflow belongs to the caller. Workflow.userId is optional
  // (legacy seeded rows may be null); for those, only the dev user is allowed
  // to schedule them in dev mode — otherwise reject.
  const workflow = await db.workflow.findUnique({
    where: { id: workflowId },
    select: { id: true, name: true, userId: true },
  })
  if (!workflow) {
    return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
  }
  if (workflow.userId && workflow.userId !== user.id) {
    return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
  }

  const nextRunAt = computeNextRun(schedule, scheduleKind, timezone)

  const created = await db.scheduledJob.create({
    data: {
      userId: user.id,
      workflowId,
      schedule,
      scheduleKind,
      timezone,
      status: 'active',
      nextRunAt,
      runCount: 0,
      failureCount: 0,
    },
  })

  return NextResponse.json(mapJob(created, workflow.name), { status: 201 })
})
