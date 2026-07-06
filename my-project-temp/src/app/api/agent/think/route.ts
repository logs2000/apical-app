import { withUser } from '@/lib/auth-helpers'
import { db } from '@/lib/db'
import { deriveDesktopContext } from '@/lib/desktop/device-auth'
import { rateLimit } from '@/lib/rate-limit'
import { runAgent, type AgentEvent } from '@/lib/platform/agent-engine'
import { captureClientContext } from '@/lib/platform/client-context'
import { mintRunRelayToken } from '@/lib/relay-token'
import type { StoredAgentRunOpts } from '@/lib/platform/agent-run-worker'
import type { PlanItem } from '@/lib/platform/agent-tools'

interface ThinkBody {
  goal: string
  context?: string
  history?: Array<{ role: 'user' | 'agent' | 'assistant'; content: string }>
  /** An unfinished checklist from an earlier turn to resume instead of restart. */
  priorPlan?: PlanItem[]
  agentId?: string | null
  attachments?: Array<{
    id: string
    name: string
    mimeType: string
    kind: string
    url: string
    localPath?: string | null
  }>
  script?: { language: 'javascript' | 'python' | 'shell'; code: string }
  modelId?: string
  maxIterations?: number
  /** Browser-reported time/place so the agent can reason about "today", etc. */
  clientContext?: { timezone?: string; locale?: string }
  /**
   * Durable mode: instead of running the loop inside this request (and dying
   * with it), enqueue an AgentRun for the agent-worker and return 202 with
   * { agentRunId, relayToken }. The run survives disconnects and is resumable.
   */
  durable?: boolean
}

// POST /api/agent/think — run the autonomous agent loop.
//
// Streams Server-Sent Events: each event is `data: <json>\n\n` where <json>
// is an AgentEvent (status | thought | tool_call | observation | final | error).
//
// Body: { goal, context?, modelId?, maxIterations? }
//
// Desktop capabilities (CLI/FS tools) are derived server-side from the
// authenticated session — never from client-declared flags.
//
// The route is `withUser`-protected so we get the userId for the LLM gateway
// (token metering + BYOK routing). The SSE stream is the response body.
export const POST = withUser(async (req, { user }) => {
  // 20 req/min per user — the autonomous agent loop is expensive.
  const rl = rateLimit(`think:${user.id}`, 20, 60_000)
  if (!rl.ok) {
    return Response.json(
      { error: 'rate_limited', retryAfter: rl.retryAfter },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } },
    )
  }
  const body = (await req.json().catch(() => ({}))) as ThinkBody
  const goal = (body.goal || '').trim()
  if (!goal) {
    return Response.json({ error: 'goal is required' }, { status: 400 })
  }

  const desktop = await deriveDesktopContext(req, user.id)

  // Capture the caller's timezone/locale + approximate IP geo BEFORE the loop
  // so this turn's context block already reflects it. Best-effort, never throws.
  await captureClientContext(req, user.id, body.clientContext)

  // Durable mode — enqueue for the agent-worker instead of running inline.
  if (body.durable) {
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
      maxIterations: body.maxIterations,
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
    return Response.json(
      { agentRunId: run.id, relayToken: minted?.token ?? null, relayExpiresAt: minted?.expiresAt ?? null },
      { status: 202 },
    )
  }

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: AgentEvent) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
        } catch {
          // Stream already closed (client disconnected) — drop the event.
        }
      }
      send({ type: 'status', status: 'started' })
      try {
        await runAgent(
          {
            userId: user.id,
            goal,
            agentId: body.agentId ?? null,
            context: body.context,
            attachments: body.attachments,
            script: body.script,
            history: (body.history ?? []).slice(-12).map((m) => ({
              role: m.role === 'user' ? 'user' : 'agent',
              content: m.content,
            })),
            priorPlan: Array.isArray(body.priorPlan) ? body.priorPlan : undefined,
            modelId: body.modelId,
            maxIterations: body.maxIterations,
            allowCli: desktop.allowCli,
            isDesktop: desktop.isDesktop,
            source: 'agent',
            // When the client disconnects, stop the loop instead of letting
            // the LLM keep burning tokens against a dead stream.
            signal: req.signal,
          },
          send,
        )
      } catch (err) {
        send({ type: 'error', message: err instanceof Error ? err.message : 'Unknown error' })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  })
})
