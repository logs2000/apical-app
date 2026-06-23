import { NextResponse } from 'next/server'
import ZAI from 'z-ai-web-dev-sdk'
import { db } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth-helpers'
import { rateLimitByUser } from '@/lib/rate-limit'
import type { AgentEvent } from '@/lib/types'

// POST /api/agents/[id]/chat — per-agent conversation with glass-box streaming.
//
// Classifies the user's message into one of three intents:
//   - 'run'      → user is asking the agent to do its job. Emit task_list + (real) tool_call events.
//   - 'question' → user is asking about the agent or chatting. Stream text only, no task_list.
//   - 'config'   → user is asking to change something about the agent. Stream text describing the change.
//
// Then streams the LLM response token by token. The plan card / tool calls only
// appear when the user is actually asking the agent to RUN — not for "hi" or
// "what did you do today?".

interface RouteCtx { params: Promise<{ id: string }> }
interface ChatBody {
  message: string
  history?: Array<{ role: 'user' | 'agent' | 'assistant' | 'system'; content: string }>
}

type AgentChatIntent = 'run' | 'question' | 'config'

/** Cheap, deterministic intent classifier. Falls back to 'question' (the safe default —
 *  streams text without a plan card). For ambiguous cases we could call the LLM, but
 *  the regexes cover the vast majority of real usage. */
function classifyAgentMessage(message: string): AgentChatIntent {
  const lower = message.toLowerCase().trim()

  // Run: explicit run/process/execute triggers, or "do your job" / "do it" phrasing.
  if (/^(run|go|execute|process|start|kick off|do your|do my|do it|do this)\b/.test(lower)) return 'run'
  if (/\b(right now|again|please run|do the thing|your job|your thing|your workflow|your shift)\b/.test(lower)) return 'run'
  if (/\b(process the|sort the|file the|send the|check the|chase the|audit the|scan the|extract the)\b/.test(lower)) return 'run'

  // Config: change/update/set/edit + an agent property.
  if (/\b(change|update|set|edit|add|remove|delete|rename|pause|resume|stop|start|enable|disable|turn on|turn off)\b/.test(lower)) {
    if (/\b(schedule|trigger|step|model|threshold|name|title|department|tool|credential|interval|frequency|cron|every|daily|weekly|monthly|hourly)\b/.test(lower)) {
      return 'config'
    }
  }
  if (/\bpause\b|\bresume\b/.test(lower) && lower.length < 30) return 'config'

  // Default: question (also covers greetings, "what/why/how", "hi", etc.).
  return 'question'
}

export async function POST(req: Request, { params }: RouteCtx) {
  try {
    const user = await getCurrentUser(req)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    // 20 req/min per user — protect the LLM gateway from a single user flooding it.
    const rl = rateLimitByUser(user.id, req, 20, 60_000)
    if (!rl.ok) {
      return NextResponse.json(
        { error: 'rate_limited', retryAfter: rl.retryAfter },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } },
      )
    }
    const { id } = await params
    const body = (await req.json()) as ChatBody
    const message = (body.message || '').trim()
    if (!message) return NextResponse.json({ error: 'message is required' }, { status: 400 })

    // Load the agent + its tools. Verify ownership.
    const wf = await db.workflow.findUnique({ where: { id } })
    if (!wf || wf.userId !== user.id) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

    const integrations = await db.integration.findMany({ where: { status: 'connected' } })
    const toolInventory = integrations.flatMap((i) => {
      const tools = JSON.parse(i.tools) as Array<{ id: string; name: string; description: string }>
      return tools.map((t) => `${t.id} (${i.name}): ${t.description}`)
    }).join('\n')

    const intent = classifyAgentMessage(message)

    const zai = await ZAI.create()

    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder()
        let eventSeq = 0
        const send = (event: AgentEvent & { id?: string }) => {
          // Stable id so the client can dedupe + AnimatePresence stops re-mounting.
          eventSeq += 1
          const ev = { ...event, id: event.id ?? `ev_${eventSeq}` }
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`))
        }

        try {
          const steps = JSON.parse(wf.stepsJson)?.steps ?? []

          // Build a shared system prompt for all intents.
          const systemPrompt = `You are ${wf.name}, an AI agent that ${wf.description}

Your workflow has these steps:
${steps.map((s: { id: string; kind: string; label: string; tool?: string }) => `  ${s.id} [${s.kind}] ${s.label}${s.tool ? ` → ${s.tool}` : ''}`).join('\n')}

Available tools:
${toolInventory || 'files, cli, http, ocr, scanner, slack, gmail, quickbooks, stripe'}

The user said: "${message}"

${intent === 'run'
  ? `The user is asking you to DO YOUR JOB (run your workflow). Respond as if you're executing it. Be concise — 2-4 sentences describing what you're doing / just did. Reference specific steps by name. If your workflow would actually execute via a separate run, mention that the run has been kicked off.`
  : intent === 'config'
    ? `The user is asking to CHANGE something about you (schedule, steps, threshold, etc.). Describe the proposed change in 2-4 sentences. Be specific about what would change. Don't actually execute the workflow.`
    : `The user is asking a question or chatting. Answer based on your role and recent activity. Be concise and conversational — 2-5 sentences. If they ask what you did, summarize your last run (if you have steps that suggest one). If they ask how you work, walk through your workflow briefly. Don't execute anything.`}`

          // ---------- 'run' intent: emit task_list + a single status, then stream ----------
          if (intent === 'run') {
            send({ type: 'status', status: 'thinking' })
            send({ type: 'reasoning', content: `Analyzing the request: "${message}"` })

            // Build the task list from the workflow steps.
            const tasks = steps.map((s: { id: string; label: string }, i: number) => ({
              id: s.id || `s${i + 1}`,
              label: s.label || `Step ${i + 1}`,
              done: false,
            }))
            if (tasks.length > 0) {
              send({ type: 'task_list', tasks })
            }

            send({ type: 'status', status: 'acting' })
            send({ type: 'reasoning', content: 'Running workflow…' })
          } else {
            // 'question' / 'config' — just emit a single status, no task_list, no fake tool calls.
            send({ type: 'status', status: 'thinking' })
          }

          // ---------- Stream the LLM response token by token ----------
          const history: Array<{ role: 'user' | 'assistant'; content: string }> = (body.history ?? [])
            .slice(-6)
            .map((m) => ({
              role: (m.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
              content: m.content,
            }))

          const completion = await zai.chat.completions.create({
            messages: [
              { role: 'system', content: systemPrompt },
              ...history,
              { role: 'user', content: message },
            ],
            thinking: { type: 'disabled' },
            stream: true,
          })

          let fullText = ''
          for await (const chunk of completion) {
            const text = chunk.choices?.[0]?.delta?.content
            if (text) {
              fullText += text
              send({ type: 'token', content: text })
            }
          }

          // ---------- 'run' intent: mark all tasks done + emit action_complete ----------
          if (intent === 'run' && steps.length > 0) {
            const tasks = steps.map((s: { id: string; label: string }, i: number) => ({
              id: s.id || `s${i + 1}`,
              label: s.label || `Step ${i + 1}`,
              done: true,
            }))
            send({ type: 'task_list', tasks })
          }

          send({ type: 'status', status: 'done' })
          send({ type: 'action_complete', summary: fullText.slice(0, 200) || 'Done' })
        } catch (err) {
          send({ type: 'error', message: (err as Error).message })
        } finally {
          controller.enqueue(encoder.encode('data: [DONE]\n\n'))
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
    return NextResponse.json({ error: 'Agent chat failed: ' + (err as Error).message }, { status: 500 })
  }
}
