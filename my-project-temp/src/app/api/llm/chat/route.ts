// POST /api/llm/chat — the unified chat entrypoint.
//
// Body: {
//   modelId: string,
//   messages: { role, content }[],
//   stream?: boolean,
//   maxTokens?: number,
//   temperature?: number,
//   source?: 'chat' | 'agent' | 'workflow' | 'reason' | 'research',
//   refId?: string,
// }
//
// Non-streaming → JSON { content, usage, modelId }.
// Streaming     → text/event-stream of:
//   data: {"type":"delta","content":"..."}\n\n
//   ...
//   data: {"type":"done","usage":{...}}\n\n
//
// Allowance is enforced first: 429 { error: 'over_allowance', overrunAvailable: bool }
// if the user is over their plan allowance and hasn't opted into overrun billing.

import { NextResponse } from 'next/server'
import { withUser } from '@/lib/auth-helpers'
import { rateLimit } from '@/lib/rate-limit'
import {
  chat,
  chatStream,
  checkAllowance,
  type ChatMessage,
} from '@/lib/platform/llm-gateway'

interface ChatBody {
  modelId: string
  messages: ChatMessage[]
  stream?: boolean
  maxTokens?: number
  temperature?: number
  source?: 'chat' | 'agent' | 'workflow' | 'reason' | 'research'
  refId?: string
}

export const POST = withUser(async (req, { user }) => {
  // 20 req/min per user — protects the LLM gateway from a single user flooding it.
  const rl = rateLimit(`llm-chat:${user.id}`, 20, 60_000)
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'rate_limited', retryAfter: rl.retryAfter },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } },
    )
  }
  let body: ChatBody
  try {
    body = (await req.json()) as ChatBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const modelId = (body.modelId || '').trim()
  const messages = Array.isArray(body.messages) ? body.messages : []

  if (!modelId) {
    return NextResponse.json({ error: 'modelId is required' }, { status: 400 })
  }
  if (messages.length === 0) {
    return NextResponse.json({ error: 'messages must be a non-empty array' }, { status: 400 })
  }
  // Reject malformed messages early so the LLM call doesn't fail mid-flight.
  for (const m of messages) {
    if (!m || typeof m.content !== 'string' ||
        !['system', 'user', 'assistant'].includes(m.role)) {
      return NextResponse.json(
        { error: 'Each message needs { role: "system"|"user"|"assistant", content: string }' },
        { status: 400 },
      )
    }
  }
  if (body.maxTokens !== undefined && (typeof body.maxTokens !== 'number' || body.maxTokens <= 0)) {
    return NextResponse.json({ error: 'maxTokens must be a positive number' }, { status: 400 })
  }
  if (body.temperature !== undefined &&
      (typeof body.temperature !== 'number' || body.temperature < 0 || body.temperature > 2)) {
    return NextResponse.json({ error: 'temperature must be between 0 and 2' }, { status: 400 })
  }

  // Allowance gate.
  const allowance = await checkAllowance(user.id)
  if (!allowance.allowed) {
    return NextResponse.json(
      {
        error: 'over_allowance',
        overrunAvailable: false,
        used: allowance.used,
        allowance: allowance.allowance,
        periodEnd: allowance.periodEnd,
      },
      { status: 429 },
    )
  }

  const chatReq = {
    modelId,
    messages,
    stream: body.stream,
    maxTokens: body.maxTokens,
    temperature: body.temperature,
    userId: user.id,
    source: body.source,
    refId: body.refId,
  }

  // Non-streaming path.
  if (!body.stream) {
    try {
      const res = await chat(chatReq)
      return NextResponse.json({
        content: res.content,
        usage: res.usage,
        modelId: res.modelId,
        provider: res.provider,
        costCents: res.costCents,
      })
    } catch (err) {
      const msg = (err as Error).message || 'Chat failed'
      const status = /not found|not configured/i.test(msg) ? 404 : 500
      return NextResponse.json({ error: msg }, { status })
    }
  }

  // Streaming path — Server-Sent Events.
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const ev of chatStream(chatReq)) {
          if (ev.type === 'delta' && typeof ev.content === 'string') {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type: 'delta', content: ev.content })}\n\n`),
            )
          } else if (ev.type === 'done' && ev.usage) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type: 'done', usage: ev.usage })}\n\n`),
            )
          }
        }
      } catch (err) {
        const msg = (err as Error).message || 'Stream failed'
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: 'error', error: msg })}\n\n`),
        )
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
      'X-Accel-Buffering': 'no',
    },
  })
})
