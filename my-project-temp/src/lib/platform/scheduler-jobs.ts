// Apical — scheduled job upsert + dedupe.
//
// Enforces the invariant of ONE ScheduledJob per (user, workflow). Both the
// `schedule_agent` agent tool and `POST /api/scheduler/jobs` previously called
// `create` unconditionally, so re-scheduling an agent (or the agent calling
// schedule_agent across turns) accumulated duplicate rows — which then fired
// the workflow multiple times per tick and showed the same agent repeatedly in
// the tray. These helpers make scheduling idempotent and self-heal legacy dupes.

import { db } from '@/lib/db'
import { computeNextRun, type ScheduleKind } from './cron'
import type { ScheduledJob } from '@prisma/client'

export interface UpsertJobInput {
  userId: string
  workflowId: string
  schedule: string
  scheduleKind: ScheduleKind
  timezone: string
}

/**
 * Create or update the single ScheduledJob for a (user, workflow), removing any
 * duplicates. Recomputes nextRunAt from the (possibly new) schedule and clears
 * any failure/pause state so re-scheduling reactivates a paused/failed job.
 */
export async function upsertScheduledJob(input: UpsertJobInput): Promise<ScheduledJob> {
  const existing = await db.scheduledJob.findMany({
    where: { userId: input.userId, workflowId: input.workflowId },
    orderBy: { createdAt: 'asc' },
  })
  const nextRunAt = computeNextRun(input.schedule, input.scheduleKind, input.timezone)

  if (existing.length === 0) {
    return db.scheduledJob.create({
      data: {
        userId: input.userId,
        workflowId: input.workflowId,
        schedule: input.schedule,
        scheduleKind: input.scheduleKind,
        timezone: input.timezone,
        status: 'active',
        nextRunAt,
        runCount: 0,
        failureCount: 0,
      },
    })
  }

  const [keep, ...extras] = existing
  if (extras.length > 0) {
    await db.scheduledJob.deleteMany({ where: { id: { in: extras.map((e) => e.id) } } })
  }
  return db.scheduledJob.update({
    where: { id: keep.id },
    data: {
      schedule: input.schedule,
      scheduleKind: input.scheduleKind,
      timezone: input.timezone,
      status: 'active',
      pausedByUserToggle: false,
      failureCount: 0,
      nextRunAt,
    },
  })
}

/**
 * Collapse duplicate jobs per workflow for a user — keep the "best" (active
 * over paused, then soonest nextRunAt) and delete the rest. Also collapses
 * duplicate jobs whose workflows share the same display name (legacy dupes).
 * Returns the number of rows removed.
 */
export async function dedupeUserScheduledJobs(userId: string): Promise<number> {
  const rows = await db.scheduledJob.findMany({ where: { userId } })
  const names = await loadWorkflowNamesForDedupe(rows.map((r) => r.workflowId))

  const byWorkflow = new Map<string, ScheduledJob[]>()
  for (const r of rows) {
    const arr = byWorkflow.get(r.workflowId) ?? []
    arr.push(r)
    byWorkflow.set(r.workflowId, arr)
  }

  const toDelete: string[] = []
  for (const group of byWorkflow.values()) {
    if (group.length <= 1) continue
    group.sort(rankJobs)
    for (const extra of group.slice(1)) toDelete.push(extra.id)
  }

  const survivors = rows.filter((r) => !toDelete.includes(r.id))
  const byName = new Map<string, ScheduledJob>()
  for (const job of survivors) {
    const nameKey = (names.get(job.workflowId) ?? job.workflowId).trim().toLowerCase()
    const prev = byName.get(nameKey)
    if (!prev || rankJobs(prev, job) > 0) byName.set(nameKey, job)
  }
  for (const job of survivors) {
    const nameKey = (names.get(job.workflowId) ?? job.workflowId).trim().toLowerCase()
    const keep = byName.get(nameKey)
    if (keep && keep.id !== job.id) toDelete.push(job.id)
  }

  const uniqueDelete = Array.from(new Set(toDelete))
  if (uniqueDelete.length > 0) {
    await db.scheduledJob.deleteMany({ where: { id: { in: uniqueDelete } } })
  }
  return uniqueDelete.length
}

function rankJobs(a: ScheduledJob, b: ScheduledJob): number {
  const aRank = a.status === 'active' ? 0 : 1
  const bRank = b.status === 'active' ? 0 : 1
  if (aRank !== bRank) return aRank - bRank
  return a.nextRunAt.getTime() - b.nextRunAt.getTime()
}

async function loadWorkflowNamesForDedupe(workflowIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const unique = Array.from(new Set(workflowIds))
  if (unique.length === 0) return out
  const rows = await db.workflow.findMany({
    where: { id: { in: unique } },
    select: { id: true, name: true },
  })
  for (const r of rows) out.set(r.id, r.name)
  return out
}
