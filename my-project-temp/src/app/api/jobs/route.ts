import { NextResponse } from 'next/server'
import { withUser } from '@/lib/auth-helpers'
import { db } from '@/lib/db'
import { rateLimit } from '@/lib/rate-limit'

// Submission ceilings (audit: POST /api/jobs had neither a rate limit nor a
// quota — a single user could enqueue unbounded compute). Mirrors the
// agent-runs limiter; the active-job quota also bounds total queued work.
const SUBMITS_PER_MINUTE = 30
const MAX_ACTIVE_JOBS = 25

interface CreateBody {
  label: string
  language: 'python' | 'javascript' | 'shell'
  source: string
  packages?: string[]
  args?: string[]
  backend?: 'server' | 'desktop'
  agentId?: string | null
  timeoutMinutes?: number
}

// POST /api/jobs — submit an async compute job (submit → poll → collect).
export const POST = withUser(async (req, { user }) => {
  const rl = rateLimit(`jobs:${user.id}`, SUBMITS_PER_MINUTE, 60_000)
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'rate_limited', retryAfter: rl.retryAfter },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } },
    )
  }
  const body = (await req.json().catch(() => ({}))) as CreateBody
  const label = (body.label || '').trim()
  const source = (body.source || '').trim()
  if (!label || !source) return NextResponse.json({ error: 'label and source are required' }, { status: 400 })
  if (!['python', 'javascript', 'shell'].includes(body.language)) {
    return NextResponse.json({ error: 'invalid language' }, { status: 400 })
  }
  const backend = body.backend === 'desktop' ? 'desktop' : 'server'
  const packages = Array.isArray(body.packages) ? body.packages.filter((p) => typeof p === 'string').slice(0, 20) : []
  const args = Array.isArray(body.args) ? body.args.filter((a) => typeof a === 'string') : []
  const timeoutMs = Math.max(1, Math.min(360, Number(body.timeoutMinutes) || 30)) * 60_000

  const active = await db.job.count({
    where: { userId: user.id, status: { in: ['queued', 'accepted', 'running'] } },
  })
  if (active >= MAX_ACTIVE_JOBS) {
    return NextResponse.json(
      { error: `active job quota reached (${MAX_ACTIVE_JOBS}) — wait for jobs to finish or cancel some` },
      { status: 429 },
    )
  }

  const job = await db.job.create({
    data: {
      userId: user.id,
      agentId: body.agentId ?? null,
      label,
      kind: body.language === 'shell' ? 'cli' : 'script',
      backend,
      timeoutMs,
      payloadJson: JSON.stringify({ language: body.language, source, packages, args }),
    },
  })
  return NextResponse.json({ jobId: job.id, status: 'queued', backend }, { status: 202 })
})

// GET /api/jobs?agentId=&agentRunId=&limit= — list the user's jobs.
export const GET = withUser(async (req, { user }) => {
  const url = new URL(req.url)
  const agentId = url.searchParams.get('agentId')
  const agentRunId = url.searchParams.get('agentRunId')
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit') || 20)))
  const jobs = await db.job.findMany({
    where: { userId: user.id, ...(agentId ? { agentId } : {}), ...(agentRunId ? { agentRunId } : {}) },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true,
      label: true,
      kind: true,
      backend: true,
      status: true,
      progress: true,
      progressNote: true,
      error: true,
      agentId: true,
      createdAt: true,
      startedAt: true,
      finishedAt: true,
    },
  })
  return NextResponse.json({ jobs })
})
