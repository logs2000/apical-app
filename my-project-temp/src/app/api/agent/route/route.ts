import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth-helpers'
import { rateLimitByUser } from '@/lib/rate-limit'
import { simpleComplete } from '@/lib/platform/llm-gateway'
import { db } from '@/lib/db'

interface RouteBody {
  message?: string
  currentAgentId?: string | null
}

interface RouteResult {
  action: 'continue' | 'route'
  targetAgentId?: string
  targetAgentName?: string
  changeSummary?: string
}

const ROUTE_SCHEMA = `Return ONLY valid JSON (no markdown):
{
  "action": "continue" | "route",
  "targetAgentId": "<agent id or omit>",
  "targetAgentName": "<agent name or omit>",
  "changeSummary": "<plain-English summary of requested changes, or omit>"
}

Rules:
- "route" ONLY when the user clearly wants to MODIFY, UPDATE, CONFIGURE, or CHANGE an EXISTING agent (workflow, schedule, steps, settings) — and that agent is NOT the current one.
- "continue" for general questions, new tasks, creating something new, or when the message targets the current agent.
- Match agents by name (fuzzy), description, or obvious reference ("my sorter", "the invoice agent").
- changeSummary: bullet the specific changes the user wants (X, Y, Z) when action is "route".`

export async function POST(req: Request) {
  try {
    const user = await getCurrentUser(req)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const rl = rateLimitByUser(user.id, req, 30, 60_000)
    if (!rl.ok) {
      return NextResponse.json(
        { error: 'rate_limited', retryAfter: rl.retryAfter },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } },
      )
    }

    const body = (await req.json().catch(() => ({}))) as RouteBody
    const message = (body.message || '').trim()
    if (!message) {
      return NextResponse.json({ error: 'message is required' }, { status: 400 })
    }

    const agents = await db.workflow.findMany({
      where: { userId: user.id },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, name: true, title: true, description: true },
    })

    if (agents.length === 0) {
      return NextResponse.json({ action: 'continue' } satisfies RouteResult)
    }

    const roster = agents
      .map(
        (a) =>
          `- id="${a.id}" name="${a.name}"${a.title ? ` title="${a.title}"` : ''}${a.description ? ` — ${a.description.slice(0, 100)}` : ''}`,
      )
      .join('\n')

    const current =
      body.currentAgentId && agents.some((a) => a.id === body.currentAgentId)
        ? agents.find((a) => a.id === body.currentAgentId)!
        : null

    const raw = await simpleComplete({
      userId: user.id,
      messages: [
        {
          role: 'system',
          content:
            `You route user messages in an AI agent workspace. ${ROUTE_SCHEMA}\n\nAgent roster:\n${roster}` +
            (current ? `\n\nCurrent chat agent: "${current.name}" (id=${current.id})` : '\n\nCurrent chat: new chat (no agent yet)'),
        },
        { role: 'user', content: message },
      ],
      maxTokens: 400,
    })

    let parsed: RouteResult = { action: 'continue' }
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        const obj = JSON.parse(jsonMatch[0]) as RouteResult
        if (obj.action === 'route' && obj.targetAgentId) {
          const target = agents.find((a) => a.id === obj.targetAgentId)
          if (target && target.id !== body.currentAgentId) {
            parsed = {
              action: 'route',
              targetAgentId: target.id,
              targetAgentName: target.name,
              changeSummary: obj.changeSummary?.trim() || message,
            }
          }
        }
      }
    } catch {
      // default continue
    }

    return NextResponse.json(parsed)
  } catch (err) {
    console.error('[api/agent/route] POST failed:', err)
    return NextResponse.json({ action: 'continue' } satisfies RouteResult)
  }
}
