import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth-helpers'
import { rateLimitByUser } from '@/lib/rate-limit'
import { loadIntegrations } from '@/lib/mappers'
import { hasHostedLlmProvider, simpleStreamEvents } from '@/lib/platform/llm-gateway'

interface StreamBody {
  message?: string
  history?: Array<{ role: 'user' | 'agent' | 'assistant'; content: string }>
  activeAgentId?: string | null
  mentionedAgentIds?: string[]
  model?: string
}

function renderRoster(
  agents: Array<{
    name: string
    title: string | null
    department: string | null
    description: string
    status: string
    trigger: string
    schedule: string | null
  }>,
): string {
  if (agents.length === 0) return '(No agents yet.)'
  return agents
    .map((a) => {
      const title = a.title ?? 'Agent'
      return `- ${a.name} (${title}) — ${a.status}, ${a.trigger}${a.schedule ? ` ${a.schedule}` : ''}. ${a.description}`
    })
    .join('\n')
}

// POST /api/agent/chat/stream — streaming plan-mode chat with Claude extended thinking.
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

    if (!hasHostedLlmProvider()) {
      return NextResponse.json(
        { error: 'No LLM provider configured' },
        { status: 503 },
      )
    }

    const body = (await req.json()) as StreamBody
    const message = (body.message || '').trim()
    if (!message) {
      return NextResponse.json({ error: 'message is required' }, { status: 400 })
    }

    const mentionIds = Array.from(
      new Set([
        ...(body.mentionedAgentIds ?? []),
        ...(body.activeAgentId ? [body.activeAgentId] : []),
      ]),
    )

    const [integrations, agents, mentionedAgents] = await Promise.all([
      loadIntegrations(),
      db.workflow.findMany({
        orderBy: { updatedAt: 'desc' },
        select: {
          id: true,
          name: true,
          title: true,
          department: true,
          description: true,
          status: true,
          trigger: true,
          schedule: true,
        },
      }),
      mentionIds.length
        ? db.workflow.findMany({ where: { id: { in: mentionIds } } })
        : Promise.resolve([]),
    ])

    const toolCatalog = integrations
      .flatMap((i) => (i.tools ?? []).map((t) => `${t.id} (${i.name})`))
      .slice(0, 40)
      .join('\n')

    const mentionedBlock =
      mentionedAgents.length > 0
        ? mentionedAgents
            .map(
              (a) =>
                `- ${a.name} (${a.title ?? 'Agent'}): ${a.description}`,
            )
            .join('\n')
        : '(none tagged in this message)'

    const priorHistory = (body.history ?? [])
      .filter((m) => m.content?.trim())
      .slice(-12)
      .map((m) => ({
        role: (m.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
        content: m.content.trim(),
      }))

    const systemPrompt = `You are the Apical Assistant — a warm, plain-English helper for managing AI agents and automations.

The user is NOT technical. Speak clearly in markdown when helpful. Agents are AI assistants that do repetitive office work.

MENTIONED AGENTS:
${mentionedBlock}

EXISTING AGENTS:
${renderRoster(agents)}

AVAILABLE TOOLS (use these ids when describing workflows):
${toolCatalog || '(none connected yet)'}

When the user describes a job to automate, think through tools, triggers, and edge cases before answering. Ask clarifying questions when details are missing. Describe workflow ideas as numbered steps (tool / reason / gate).

Respond in plain text or markdown. Do NOT output JSON.`

    const llmMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: systemPrompt },
      ...priorHistory,
      { role: 'user', content: message },
    ]

    const stream = new ReadableStream({
      async start(controller) {
        const enc = new TextEncoder()
        const send = (payload: Record<string, unknown>) => {
          controller.enqueue(enc.encode(`data: ${JSON.stringify(payload)}\n\n`))
        }
        try {
          send({ type: 'status', status: 'thinking' })
          for await (const ev of simpleStreamEvents({
            messages: llmMessages,
            model: body.model,
            maxTokens: 16_000,
            thinking: true,
            thinkingBudgetTokens: 8_000,
          })) {
            if (ev.type === 'thinking') {
              send({ type: 'thinking', content: ev.delta })
            } else {
              send({ type: 'token', content: ev.delta })
            }
          }
          send({ type: 'status', status: 'done' })
          controller.enqueue(enc.encode('data: [DONE]\n\n'))
        } catch (err) {
          send({ type: 'error', message: (err as Error).message })
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
    console.error('[api/agent/chat/stream] failed:', err)
    return NextResponse.json({ error: 'Streaming failed' }, { status: 500 })
  }
}
