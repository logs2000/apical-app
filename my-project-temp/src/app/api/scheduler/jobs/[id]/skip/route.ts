import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withUser } from '@/lib/auth-helpers'
import { computeNextRun } from '@/lib/platform/cron'

// POST /api/scheduler/jobs/[id]/skip — advance nextRunAt without firing.
// Used by the tray menu "Skip next run" action.

export const POST = withUser(async (_req, { user, params }) => {
  const { id } = params

  const job = await db.scheduledJob.findUnique({ where: { id } })
  if (!job || job.userId !== user.id) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  }

  const kind = job.scheduleKind === 'fixed_rate' ? 'fixed_rate' : 'cron'
  const nextRunAt = computeNextRun(job.schedule, kind, job.timezone)

  const updated = await db.scheduledJob.update({
    where: { id },
    data: {
      nextRunAt,
      skippedCount: { increment: 1 },
      lastRunStatus: 'skipped_manual',
    },
  })

  return NextResponse.json({
    ok: true,
    nextRunAt: updated.nextRunAt.toISOString(),
  })
})
