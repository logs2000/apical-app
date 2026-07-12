import { NextResponse } from 'next/server'
import { withUser } from '@/lib/auth-helpers'
import { db } from '@/lib/db'
import { deriveDesktopContext } from '@/lib/desktop/device-auth'
import { rateLimit } from '@/lib/rate-limit'
import { captureClientContext } from '@/lib/platform/client-context'
import { mintRunRelayToken } from '@/lib/relay-token'
import type { StoredAgentRunOpts } from '@/lib/platform/agent-run-worker'
import type { PlanItem } from '@/lib/platform/agent-tools'

interface CreateBody {
  goal: string
  context?: string
  history?: Array<{ role: 'user' | 'agent' | 'assistant'; content: string }>
  priorPlan?: PlanItem[]
  agentId?: string | null
  attachments?: StoredAgentRunOpts['attachments']
  script?: StoredAgentRunOpts['script']
  modelId?: string
  maxIterations?: number
  clientContext?: { timezone?: string; locale?: string }
}

// POST /api/agent-runs — enqueue a DURABLE agent run. The agent-worker
// mini-service executes it off the request lifecycle: closing the tab no
// longer kills the run. Returns { agentRunId, relayToken } — subscribe to
// relay runId `agentrun:<id>` for live events, or poll /events for backfill.
export const POST = withUser(async (req, { user }) => {
  const rl = rateLimit(`agent-runs:${user.id}`, 20, 60_000)
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'rate_limited', retryAfter: rl.retryAfter },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } },
    )
  }
  const body = (await req.json().catch(() => ({}))) as CreateBody
  const goal = (body.goal || '').trim()
  if (!goal) return NextResponse.json({ error: 'goal is required' }, { status: 400 })

  if (body.agentId) {
    const agent = await db.workflow.findFirst({
      where: { id: body.agentId, userId: user.id },
      select: { id: true },
    })
    if (!agent) return NextResponse.json({ error: 'agent not found' }, { status: 404 })
  }

  const desktop = await deriveDesktopContext(req, user.id)
  await captureClientContext(req, user.id, body.clientContext)

  const opts: StoredAgentRunOpts = {
    context: body.context,
    history: (body.history ?? []).slice(-12).map((m) => ({
      role: m.role === 'user' ? ('user' as const) : ('agent' as const),
      content: m.content,
    })),
    attachments: body.attachments,
    script: body.script,
    priorPlan: Array.isArray(body.priorPlan) ? body.priorPlan : undefined,
    modelId: body.modelId,
    // Clamp: this is client-supplied — unclamped it set the engine's loop
    // bound directly (1e9 iterations of LLM+tool calls on one request).
    maxIterations:
      typeof body.maxIterations === 'number' && Number.isFinite(body.maxIterations)
        ? Math.max(1, Math.min(128, Math.floor(body.maxIterations)))
        : undefined,
    allowCli: desktop.allowCli,
    isDesktop: desktop.isDesktop,
    source: 'agent',
  }

  const run = await db.agentRun.create({
    data: {
      userId: user.id,
      agentId: body.agentId ?? null,
      origin: 'chat',
      goal,
      optsJson: JSON.stringify(opts),
    },
  })

  const minted = mintRunRelayToken(`agentrun:${run.id}`)
  return NextResponse.json(
    { agentRunId: run.id, relayToken: minted?.token ?? null, relayExpiresAt: minted?.expiresAt ?? null },
    { status: 202 },
  )
})

// GET /api/agent-runs?agentId=&active=1&limit= — list the user's durable runs.
export const GET = withUser(async (req, { user }) => {
  const url = new URL(req.url)
  const agentId = url.searchParams.get('agentId')
  const active = url.searchParams.get('active') === '1'
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit') || 20)))
  const runs = await db.agentRun.findMany({
    where: {
      userId: user.id,
      ...(agentId ? { agentId } : {}),
      ...(active ? { status: { in: ['queued', 'running', 'cancelling'] } } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true,
      agentId: true,
      origin: true,
      status: true,
      goal: true,
      iterations: true,
      error: true,
      createdAt: true,
      startedAt: true,
      finishedAt: true,
    },
  })
  return NextResponse.json({ runs })
})
