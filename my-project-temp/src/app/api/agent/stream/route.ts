import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth-helpers'
import { rateLimitByUser } from '@/lib/rate-limit'
import { simpleStream } from '@/lib/platform/llm-gateway'
import type { ChatMessage } from '@/lib/types'

// POST /api/agent/stream — streaming chat for simple conversational replies.

interface StreamBody {
  message: string
  history?: ChatMessage[]
  mentionedAgentIds?: string[]
  model?: string
}

export async function POST(req: Request) {
  try {
    const user = await getCurrentUser(req)
    const rl = rateLimitByUser(user?.id, req, 20, 60_000)
    if (!rl.ok) {
      return NextResponse.json(
        { error: 'rate_limited', retryAfter: rl.retryAfter },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } },
      )
    }
    const body = (await req.json()) as StreamBody
    const message = (body.message || '').trim()
    if (!message) {
      return NextResponse.json({ error: 'message is required' }, { status: 400 })
    }

    const mentionedIds = body.mentionedAgentIds ?? []
    let agentContext = ''
    if (mentionedIds.length > 0) {
      const agents = await db.workflow.findMany({ where: { id: { in: mentionedIds } } })
      agentContext = '\n\nThe user @-mentioned these agents (they are in context):\n' +
        agents.map((a) => `- ${a.name} (${a.title ?? 'Agent'}): ${a.description}`).join('\n')
    }

    const history = (body.history ?? []).slice(-6)
    const historyMessages = history.flatMap((m) => [
      { role: m.role === 'user' ? 'user' as const : 'assistant' as const, content: m.content },
    ])

    const systemPrompt = `You are the Apical assistant — a warm, plain-English helper for managing AI agents and automations. Speak concisely. If the user asks to create or edit a workflow, tell them to use the regular chat (this streaming endpoint is for quick questions only).${agentContext}`

    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const text of simpleStream({
            messages: [
              { role: 'system', content: systemPrompt },
              ...historyMessages,
              { role: 'user', content: message },
            ],
            model: body.model,
          })) {
            controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ text })}\n\n`))
          }
          controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'))
        } catch (err) {
          controller.enqueue(
            new TextEncoder().encode(`data: ${JSON.stringify({ error: (err as Error).message })}\n\n`),
          )
        } finally {
          controller.close()
        }
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    })
  } catch (err) {
    console.error('[api/agent/stream] failed:', err)
    return NextResponse.json({ error: 'Streaming failed' }, { status: 500 })
  }
}
