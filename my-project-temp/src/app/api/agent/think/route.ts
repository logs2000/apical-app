import { withUser } from '@/lib/auth-helpers'
import { deriveDesktopContext } from '@/lib/desktop/device-auth'
import { rateLimit } from '@/lib/rate-limit'
import { runAgent, type AgentEvent } from '@/lib/platform/agent-engine'
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
