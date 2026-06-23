import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withUser } from '@/lib/auth-helpers'

// POST /api/scheduler/jobs/[id]/run — manually fire a scheduled job's
// workflow right now (regardless of nextRunAt).
//
// This is the "Run now" button on the dashboard. We call the existing
// `/api/workflows/[id]/run` endpoint server-side and update the job's
// lastRunAt/lastRunId on success. We do NOT recompute nextRunAt here — the
// scheduler's regular tick handles that on its next fire.

interface RouteCtx {
  params: Promise<{ id: string }>
}

const API_BASE = process.env.APICAL_API_BASE || 'http://localhost:3000'
const SCHEDULER_SECRET =
  process.env.APICAL_SCHEDULER_SECRET || 'apical-scheduler-dev'

export const POST = withUser(async (_req, { user, params }) => {
  const { id } = params

  const job = await db.scheduledJob.findUnique({ where: { id } })
  if (!job || job.userId !== user.id) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  }

  const url = `${API_BASE}/api/workflows/${job.workflowId}/run`
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Scheduler-Secret': SCHEDULER_SECRET,
      },
      body: JSON.stringify({ trigger: 'schedule' }),
    })
  } catch (err) {
    console.error('[api/scheduler/jobs/[id]/run] fetch failed:', err)
    return NextResponse.json(
      { error: 'Failed to trigger workflow run' },
      { status: 502 },
    )
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    console.error(
      `[api/scheduler/jobs/[id]/run] workflow run endpoint returned ${res.status}: ${text}`,
    )
    return NextResponse.json(
      { error: `Workflow run failed (HTTP ${res.status})` },
      { status: 502 },
    )
  }

  const data = (await res.json().catch(() => ({}))) as { runId?: string }
  if (!data.runId) {
    return NextResponse.json(
      { error: 'Workflow run endpoint did not return a runId' },
      { status: 502 },
    )
  }

  // Stamp the job — manual run counts as a success but does NOT advance
  // nextRunAt (so the regular schedule is preserved) and does NOT reset
  // failureCount (the scheduler's own tick owns that state).
  await db.scheduledJob.update({
    where: { id },
    data: {
      lastRunAt: new Date(),
      lastRunStatus: 'success',
      lastRunId: data.runId,
    },
  })

  return NextResponse.json({ runId: data.runId })
})
