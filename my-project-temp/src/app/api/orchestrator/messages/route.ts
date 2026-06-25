import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth-helpers'

// The Orchestrator is the user's persistent "general chat" — a single running
// thread (one per user) that is aware of all their agents. Unlike per-agent
// chats (AgentMessage, keyed by Workflow.id), the orchestrator is not an agent,
// so it has no Workflow row. We persist it in the Conversation table, storing
// the message list as a JSON blob in `messagesJson`, find-or-created per user.
//
//   GET    — load the orchestrator's message history (oldest first).
//   POST   — append a message to the thread.
//   DELETE — clear the thread.

const ORCHESTRATOR_TITLE = 'Orchestrator'

interface StoredMessage {
  id: string
  role: 'user' | 'agent'
  content: string
  createdAt: string
  // Optional rich fields the chat UI rehydrates (trace, proposals, etc.).
  [key: string]: unknown
}

/** Find (or lazily create) the single orchestrator conversation for a user. */
async function getOrCreateOrchestrator(userId: string) {
  const existing = await db.conversation.findFirst({
    where: { userId, title: ORCHESTRATOR_TITLE },
    orderBy: { createdAt: 'asc' },
  })
  if (existing) return existing
  return db.conversation.create({
    data: {
      userId,
      title: ORCHESTRATOR_TITLE,
      pinned: true,
      messagesJson: '[]',
      summaryJson: JSON.stringify({ orchestrator: true }),
    },
  })
}

function parseMessages(json: string): StoredMessage[] {
  try {
    const parsed = JSON.parse(json)
    return Array.isArray(parsed) ? (parsed as StoredMessage[]) : []
  } catch {
    return []
  }
}

// GET /api/orchestrator/messages — load the orchestrator thread.
export async function GET(req: Request) {
  try {
    const user = await getCurrentUser(req)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const convo = await getOrCreateOrchestrator(user.id)
    return NextResponse.json(parseMessages(convo.messagesJson))
  } catch (err) {
    console.error('[api/orchestrator/messages] GET failed:', err)
    return NextResponse.json({ error: 'Failed to load messages' }, { status: 500 })
  }
}

interface PostBody {
  role: 'user' | 'agent'
  content: string
  // Any extra rich fields are stored verbatim and returned on load.
  [key: string]: unknown
}

// POST /api/orchestrator/messages — append a message to the thread.
export async function POST(req: Request) {
  try {
    const user = await getCurrentUser(req)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const body = (await req.json()) as PostBody
    if (!body || typeof body.content !== 'string' || !body.role) {
      return NextResponse.json({ error: 'role and content are required' }, { status: 400 })
    }
    const convo = await getOrCreateOrchestrator(user.id)
    const messages = parseMessages(convo.messagesJson)
    const msg: StoredMessage = {
      ...body,
      id: typeof body.id === 'string' && body.id ? body.id : Math.random().toString(36).slice(2),
      role: body.role === 'user' ? 'user' : 'agent',
      content: body.content,
      createdAt:
        typeof body.createdAt === 'string' && body.createdAt
          ? body.createdAt
          : new Date().toISOString(),
    }
    // Keep the thread bounded so the blob doesn't grow without limit.
    const next = [...messages, msg].slice(-400)
    await db.conversation.update({
      where: { id: convo.id },
      data: { messagesJson: JSON.stringify(next) },
    })
    return NextResponse.json(msg)
  } catch (err) {
    console.error('[api/orchestrator/messages] POST failed:', err)
    return NextResponse.json({ error: 'Failed to save message' }, { status: 500 })
  }
}

// DELETE /api/orchestrator/messages — clear the thread.
export async function DELETE(req: Request) {
  try {
    const user = await getCurrentUser(req)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const convo = await getOrCreateOrchestrator(user.id)
    await db.conversation.update({
      where: { id: convo.id },
      data: { messagesJson: '[]' },
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[api/orchestrator/messages] DELETE failed:', err)
    return NextResponse.json({ error: 'Failed to clear messages' }, { status: 500 })
  }
}
