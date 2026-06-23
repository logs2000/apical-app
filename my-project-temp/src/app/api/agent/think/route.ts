import { withUser } from '@/lib/auth-helpers'
import { rateLimit } from '@/lib/rate-limit'
import { runAgent, type AgentEvent } from '@/lib/platform/agent-engine'

interface ThinkBody {
  goal: string
  context?: string
  modelId?: string
  maxIterations?: number
  allowCli?: boolean
}

// POST /api/agent/think — run the autonomous agent loop.
//
// Streams Server-Sent Events: each event is `data: <json>\n\n` where <json>
// is an AgentEvent (status | thought | tool_call | observation | final | error).
//
// Body: { goal, context?, modelId?, maxIterations?, allowCli? }
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

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: AgentEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
      }
      try {
        await runAgent(
          {
            userId: user.id,
            goal,
            context: body.context,
            modelId: body.modelId,
            maxIterations: body.maxIterations,
            allowCli: body.allowCli ?? false,
            source: 'agent',
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
