import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth-helpers'

interface RouteCtx {
  params: Promise<{ id: string }>
}

// GET /api/conversations/[id] — load a single conversation (including its
// messagesJson + summaryJson so the frontend can restore the chat state).
export async function GET(req: Request, { params }: RouteCtx) {
  try {
    const user = await getCurrentUser(req)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const { id } = await params
    const row = await db.conversation.findUnique({ where: { id } })
    if (!row || row.userId !== user.id) {
      return NextResponse.json(
        { error: 'Conversation not found' },
        { status: 404 },
      )
    }
    return NextResponse.json({
      id: row.id,
      title: row.title,
      workspaceId: row.workspaceId,
      pinned: row.pinned,
      messagesJson: row.messagesJson,
      summaryJson: row.summaryJson,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    })
  } catch (err) {
    console.error('[api/conversations/[id]] GET failed:', err)
    return NextResponse.json(
      { error: 'Failed to load conversation' },
      { status: 500 },
    )
  }
}

interface PatchBody {
  title?: string
  pinned?: boolean
  summaryJson?: string
  messagesJson?: string
  workspaceId?: string | null
}

// PATCH /api/conversations/[id] — update title / pinned / summaryJson /
// messagesJson / workspaceId. Returns the updated conversation (without the
// heavy messagesJson unless requested separately).
export async function PATCH(req: Request, { params }: RouteCtx) {
  try {
    const user = await getCurrentUser(req)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const { id } = await params
    const body = (await req.json().catch(() => ({}))) as PatchBody
    const existing = await db.conversation.findUnique({ where: { id } })
    if (!existing || existing.userId !== user.id) {
      return NextResponse.json(
        { error: 'Conversation not found' },
        { status: 404 },
      )
    }
    const data: Record<string, unknown> = {}
    if (typeof body.title === 'string' && body.title.trim()) {
      data.title = body.title.trim()
    }
    if (typeof body.pinned === 'boolean') {
      data.pinned = body.pinned
    }
    if (typeof body.summaryJson === 'string') {
      data.summaryJson = body.summaryJson
    }
    if (typeof body.messagesJson === 'string') {
      data.messagesJson = body.messagesJson
    }
    if (body.workspaceId === null || (typeof body.workspaceId === 'string' && body.workspaceId.trim())) {
      data.workspaceId = body.workspaceId
    }
    if (Object.keys(data).length === 0) {
      return NextResponse.json(
        {
          error:
            'No changes provided. Send title, pinned, summaryJson, messagesJson, or workspaceId.',
        },
        { status: 400 },
      )
    }
    const updated = await db.conversation.update({ where: { id }, data })
    return NextResponse.json({
      id: updated.id,
      title: updated.title,
      workspaceId: updated.workspaceId,
      pinned: updated.pinned,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    })
  } catch (err) {
    console.error('[api/conversations/[id]] PATCH failed:', err)
    return NextResponse.json(
      { error: 'Failed to update conversation' },
      { status: 500 },
    )
  }
}

// DELETE /api/conversations/[id] — delete the conversation row. (Messages are
// stored client-side in this demo, so we just delete the conversation.)
export async function DELETE(req: Request, { params }: RouteCtx) {
  try {
    const user = await getCurrentUser(req)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const { id } = await params
    const existing = await db.conversation.findUnique({ where: { id } })
    if (!existing || existing.userId !== user.id) {
      return NextResponse.json(
        { error: 'Conversation not found' },
        { status: 404 },
      )
    }
    await db.conversation.delete({ where: { id } })
    return NextResponse.json({ ok: true, id })
  } catch (err) {
    console.error('[api/conversations/[id]] DELETE failed:', err)
    return NextResponse.json(
      { error: 'Failed to delete conversation' },
      { status: 500 },
    )
  }
}
