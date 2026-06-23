import { NextResponse } from 'next/server'
import ZAI from 'z-ai-web-dev-sdk'
import { db } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth-helpers'
import { rateLimitByUser } from '@/lib/rate-limit'
import type { ChatMessage } from '@/lib/types'

// POST /api/agent/stream — streaming chat for simple conversational replies.
// Returns a stream of text chunks (Server-Sent Events style: data: <chunk>\n\n).
// The frontend reads this with a ReadableStream and appends tokens live.
//
// This is for the "just answer a question" path — NOT the workflow-proposal path
// (which needs structured JSON and goes through /api/agent/chat).

interface StreamBody {
  message: string
  history?: ChatMessage[]
  mentionedAgentIds?: string[]
  model?: string
}

export async function POST(req: Request) {
  try {
    // Rate-limit per user (or IP for anonymous traffic). 20 req/min.
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

    const zai = await ZAI.create()

    // Build context from mentioned agents.
    const mentionedIds = body.mentionedAgentIds ?? []
    let agentContext = ''
    if (mentionedIds.length > 0) {
      const agents = await db.workflow.findMany({ where: { id: { in: mentionedIds } } })
      agentContext = '\n\nThe user @-mentioned these agents (they are in context):\n' +
        agents.map((a) => `- ${a.name} (${a.title ?? 'Agent'}): ${a.description}`).join('\n')
    }

    // Build the message history (last 6 messages for context).
    const history = (body.history ?? []).slice(-6)
    const historyMessages = history.flatMap((m) => [
      { role: m.role === 'user' ? 'user' : 'assistant', content: m.content },
    ])

    const systemPrompt = `You are the Apical assistant — a warm, plain-English helper for managing AI agents and automations. Speak concisely. If the user asks to create or edit a workflow, tell them to use the regular chat (this streaming endpoint is for quick questions only).${agentContext}`

    const messages = [
      { role: 'assistant', content: systemPrompt },
      ...historyMessages,
      { role: 'user', content: message },
    ]

    const thinking = body.model === 'thinking' ? { type: 'enabled' as const } : { type: 'disabled' as const }

    // Stream the response.
    const stream = new ReadableStream({
      async start(controller) {
        try {
          const completion = await zai.chat.completions.create({
            messages,
            thinking,
            stream: true,
          })

          for await (const chunk of completion) {
            const text = chunk.choices?.[0]?.delta?.content
            if (text) {
              controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ text })}\n\n`))
            }
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
