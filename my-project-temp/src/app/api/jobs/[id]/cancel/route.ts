import { NextResponse } from 'next/server'
import { withUser } from '@/lib/auth-helpers'
import { db } from '@/lib/db'
import { cancelJob } from '@/lib/platform/jobs'

// POST /api/jobs/[id]/cancel — cancel a queued/running job.
export const POST = withUser(async (_req, { user, params }) => {
  const job = await db.job.findFirst({ where: { id: params.id, userId: user.id }, select: { id: true } })
  if (!job) return NextResponse.json({ error: 'not found' }, { status: 404 })
  await cancelJob(job.id)
  return NextResponse.json({ id: job.id, status: 'cancelled' })
})
