import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withUser } from '@/lib/auth-helpers'

/**
 * POST /api/scheduler/jobs/pause-all
 * Body: { paused: boolean }
 *
 * Tray "Pause automations" toggle: pauses all active jobs (tracking which were
 * paused by the toggle) or resumes only those paused by the toggle.
 */
export const POST = withUser(async (req, { user }) => {
  let body: { paused?: boolean } = {}
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  const paused = body.paused === true

  if (paused) {
    const result = await db.scheduledJob.updateMany({
      where: { userId: user.id, status: 'active' },
      data: { status: 'paused', pausedByUserToggle: true },
    })
    return NextResponse.json({ ok: true, paused: true, count: result.count })
  }

  const result = await db.scheduledJob.updateMany({
    where: { userId: user.id, status: 'paused', pausedByUserToggle: true },
    data: { status: 'active', pausedByUserToggle: false },
  })
  return NextResponse.json({ ok: true, paused: false, count: result.count })
})
