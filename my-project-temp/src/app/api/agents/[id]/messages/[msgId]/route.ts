import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth-helpers'
import type { AgentEvent, AgentMessage } from '@/lib/types'

interface RouteCtx { params: Promise<{ id: string; msgId: string }> }

async function requireAgentOwnership(req: Request, id: string): Promise<NextResponse | null> {
  const user = await getCurrentUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const wf = await db.workflow.findUnique({ where: { id }, select: { id: true, userId: true } })
  if (!wf || wf.userId !== user.id) {
    return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
  }
  return null
}

function mapAgentMessage(row: {
  id: string
  agentId: string
  role: string
  content: string
  eventsJson: string | null
  createdAt: Date
}): AgentMessage {
  let events: AgentEvent[] | undefined
  if (row.eventsJson) {
    try {
      const parsed = JSON.parse(row.eventsJson)
      if (Array.isArray(parsed)) events = parsed
    } catch {
      events = undefined
    }
  }
  return {
    id: row.id,
    role: row.role === 'user' ? 'user' : 'agent',
    content: row.content,
    events,
    createdAt: row.createdAt.toISOString(),
  }
}

interface PatchBody {
  content?: string
  events?: AgentEvent[]
}

// PATCH /api/agents/[id]/messages/[msgId] — update an existing message (e.g. add run analysis).
export async function PATCH(req: Request, { params }: RouteCtx) {
  try {
    const { id, msgId } = await params
    const guard = await requireAgentOwnership(req, id)
    if (guard) return guard

    const existing = await db.agentMessage.findFirst({
      where: { id: msgId, agentId: id },
    })
    if (!existing) {
      return NextResponse.json({ error: 'Message not found' }, { status: 404 })
    }

    const body = (await req.json()) as PatchBody
    const updated = await db.agentMessage.update({
      where: { id: msgId },
      data: {
        ...(typeof body.content === 'string' ? { content: body.content } : {}),
        ...(body.events !== undefined
          ? {
              eventsJson:
                body.events.length > 0
                  ? JSON.stringify(body.events.filter((e) => e.type !== 'token'))
                  : null,
            }
          : {}),
      },
    })

    return NextResponse.json(mapAgentMessage(updated))
  } catch (err) {
    console.error('[api/agents/[id]/messages/[msgId]] PATCH failed:', err)
    return NextResponse.json({ error: 'Failed to update message' }, { status: 500 })
  }
}
