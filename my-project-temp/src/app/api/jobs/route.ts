import { NextResponse } from 'next/server'
import { withUser } from '@/lib/auth-helpers'
import { db } from '@/lib/db'

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
