import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withUser } from '@/lib/auth-helpers'
import { startWorkflowRun, StartRunError } from '@/lib/platform/start-run'

// POST /api/scheduler/jobs/[id]/run — manually fire a scheduled job's
// workflow right now (regardless of nextRunAt).
//
// This is the "Run now" button on the dashboard. It starts the run in-process
// (no localhost round-trip) and stamps the job "started" — the scheduler's
// outcome tick upgrades that to success/failed once the run actually
// finishes. nextRunAt is NOT advanced (the regular schedule is preserved).

export const POST = withUser(async (_req, { user, params }) => {
  const { id } = params

  const job = await db.scheduledJob.findUnique({ where: { id } })
  if (!job || job.userId !== user.id) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  }

  const workflow = await db.workflow.findUnique({
    where: { id: job.workflowId },
  })
  if (!workflow) {
    return NextResponse.json(
      { error: 'Workflow for this job no longer exists' },
      { status: 404 },
    )
  }

  try {
    const { runId } = await startWorkflowRun(workflow, {
      trigger: 'schedule',
      actingUserId: user.id,
    })
    await db.scheduledJob.update({
      where: { id },
      data: {
        lastRunAt: new Date(),
        lastRunStatus: 'started',
        lastRunId: runId,
      },
    })
    return NextResponse.json({ runId })
  } catch (err) {
    if (err instanceof StartRunError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    console.error('[api/scheduler/jobs/[id]/run] failed:', err)
    return NextResponse.json(
      { error: 'Failed to trigger workflow run' },
      { status: 500 },
    )
  }
})
