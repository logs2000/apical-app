import { NextResponse } from 'next/server'
import { withUser } from '@/lib/auth-helpers'
import { db } from '@/lib/db'

// GET /api/agent-runs/[id] — status + final payload of a durable run.
export const GET = withUser(async (_req, { user, params }) => {
  const run = await db.agentRun.findFirst({
    where: { id: params.id, userId: user.id },
  })
  if (!run) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return NextResponse.json({
    id: run.id,
    agentId: run.agentId,
    origin: run.origin,
    status: run.status,
    goal: run.goal,
    iterations: run.iterations,
    error: run.error,
    final: run.finalJson ? JSON.parse(run.finalJson) : null,
    createdAt: run.createdAt,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
  })
})
