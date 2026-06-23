import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth-helpers'
import type { AgentEvent, AgentMessage } from '@/lib/types'

interface RouteCtx { params: Promise<{ id: string }> }

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

// GET /api/agents/[id]/messages — list an agent's persisted chat messages (oldest first).
export async function GET(req: Request, { params }: RouteCtx) {
  try {
    const { id } = await params
    const guard = await requireAgentOwnership(req, id)
    if (guard) return guard
    const rows = await db.agentMessage.findMany({
      where: { agentId: id },
      orderBy: { createdAt: 'asc' },
      take: 200,
    })
    return NextResponse.json(rows.map(mapAgentMessage))
  } catch (err) {
    console.error('[api/agents/[id]/messages] GET failed:', err)
    return NextResponse.json({ error: 'Failed to load messages' }, { status: 500 })
  }
}

interface PostBody {
  role: 'user' | 'agent'
  content: string
  events?: AgentEvent[]
}

// POST /api/agents/[id]/messages — append a message to an agent's thread.
export async function POST(req: Request, { params }: RouteCtx) {
  try {
    const { id } = await params
    const guard = await requireAgentOwnership(req, id)
    if (guard) return guard
    const body = (await req.json()) as PostBody
    if (!body || typeof body.content !== 'string' || !body.role) {
      return NextResponse.json({ error: 'role and content are required' }, { status: 400 })
    }
    const created = await db.agentMessage.create({
      data: {
        agentId: id,
        role: body.role === 'user' ? 'user' : 'agent',
        content: body.content,
        eventsJson: body.events && body.events.length > 0
          ? JSON.stringify(body.events.filter((e) => e.type !== 'token'))
          : null,
      },
    })
    return NextResponse.json(mapAgentMessage(created))
  } catch (err) {
    console.error('[api/agents/[id]/messages] POST failed:', err)
    return NextResponse.json({ error: 'Failed to save message' }, { status: 500 })
  }
}

// DELETE /api/agents/[id]/messages — clear the thread.
export async function DELETE(req: Request, { params }: RouteCtx) {
  try {
    const { id } = await params
    const guard = await requireAgentOwnership(req, id)
    if (guard) return guard
    await db.agentMessage.deleteMany({ where: { agentId: id } })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[api/agents/[id]/messages] DELETE failed:', err)
    return NextResponse.json({ error: 'Failed to clear messages' }, { status: 500 })
  }
}
