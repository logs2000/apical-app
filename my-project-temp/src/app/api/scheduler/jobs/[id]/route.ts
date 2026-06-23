import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withUser } from '@/lib/auth-helpers'
import { computeNextRun, validateSchedule } from '@/lib/platform/cron'
import type { ScheduledJob } from '@prisma/client'

// API routes for /api/scheduler/jobs/[id].
//
//   PATCH   — update status (active|paused|disabled), schedule, scheduleKind,
//              timezone. Changing schedule/scheduleKind recomputes nextRunAt
//              (unless status is being set to 'paused' or 'disabled').
//   DELETE  — delete the job.
//
// See src/app/api/scheduler/jobs/route.ts for the workflow-name note
// (ScheduledJob has no `workflow` relation — we fetch it separately).

interface RouteCtx {
  params: Promise<{ id: string }>
}

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

interface PatchBody {
  status?: 'active' | 'paused' | 'disabled'
  schedule?: string
  scheduleKind?: 'cron' | 'fixed_rate'
  timezone?: string
}

// PATCH /api/scheduler/jobs/[id]
export const PATCH = withUser(async (req, { user, params }) => {
  const { id } = params

  const existing = await db.scheduledJob.findUnique({ where: { id } })
  if (!existing || existing.userId !== user.id) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  }

  let body: PatchBody = {}
  try {
    body = (await req.json()) as PatchBody
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  const data: Record<string, unknown> = {}

  if (
    body.status === 'active' ||
    body.status === 'paused' ||
    body.status === 'disabled'
  ) {
    data.status = body.status
  }

  // Determine the effective schedule + kind (post-patch) so we can recompute
  // nextRunAt if either changed.
  const effectiveKind: 'cron' | 'fixed_rate' =
    body.scheduleKind === 'fixed_rate'
      ? 'fixed_rate'
      : body.scheduleKind === 'cron'
        ? 'cron'
        : (existing.scheduleKind as 'cron' | 'fixed_rate')
  const effectiveSchedule =
    typeof body.schedule === 'string' && body.schedule.trim()
      ? body.schedule.trim()
      : existing.schedule
  const effectiveTimezone =
    typeof body.timezone === 'string' && body.timezone.trim()
      ? body.timezone.trim()
      : existing.timezone

  if (body.scheduleKind === 'cron' || body.scheduleKind === 'fixed_rate') {
    data.scheduleKind = body.scheduleKind
  }
  if (typeof body.schedule === 'string' && body.schedule.trim()) {
    data.schedule = body.schedule.trim()
  }
  if (typeof body.timezone === 'string' && body.timezone.trim()) {
    data.timezone = body.timezone.trim()
  }

  // If schedule/kind changed, validate the new shape + recompute nextRunAt —
  // but only if the new status isn't pausing/disabling the job.
  const scheduleChanged =
    'schedule' in data || 'scheduleKind' in data
  const newStatus = (data.status as string | undefined) ?? existing.status
  if (scheduleChanged) {
    const scheduleError = validateSchedule(effectiveSchedule, effectiveKind)
    if (scheduleError) {
      return NextResponse.json({ error: scheduleError }, { status: 400 })
    }
  }
  if (scheduleChanged && newStatus === 'active') {
    data.nextRunAt = computeNextRun(effectiveSchedule, effectiveKind, effectiveTimezone)
    // Resuming → reset the failure counter so backoff doesn't carry over.
    if (existing.status !== 'active') {
      data.failureCount = 0
    }
  } else if (newStatus === 'active' && existing.status !== 'active') {
    // Just resumed without schedule change → still need a fresh nextRunAt.
    data.nextRunAt = computeNextRun(effectiveSchedule, effectiveKind, effectiveTimezone)
    data.failureCount = 0
  }

  const updated = await db.scheduledJob.update({ where: { id }, data })

  // Stitch the workflow name on.
  const wf = await db.workflow.findUnique({
    where: { id: updated.workflowId },
    select: { name: true },
  })
  return NextResponse.json(mapJob(updated, wf?.name ?? null))
})

// DELETE /api/scheduler/jobs/[id]
export const DELETE = withUser(async (_req, { user, params }) => {
  const { id } = params
  const existing = await db.scheduledJob.findUnique({ where: { id } })
  if (!existing || existing.userId !== user.id) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  }
  await db.scheduledJob.delete({ where: { id } })
  return NextResponse.json({ ok: true })
})
