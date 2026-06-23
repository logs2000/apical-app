import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth-helpers'

// GET /api/conversations?workspaceId=... — list the current user's conversations,
// optionally filtered by workspace, ordered by updatedAt desc (pinned first).
export async function GET(req: Request) {
  try {
    const user = await getCurrentUser(req)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const url = new URL(req.url)
    const workspaceId = url.searchParams.get('workspaceId')
    const where: Record<string, unknown> = { userId: user.id }
    if (workspaceId) where.workspaceId = workspaceId
    const rows = await db.conversation.findMany({
      where,
      orderBy: [{ pinned: 'desc' }, { updatedAt: 'desc' }],
      select: {
        id: true,
        title: true,
        workspaceId: true,
        pinned: true,
        createdAt: true,
        updatedAt: true,
      },
    })
    return NextResponse.json(
      rows.map((r) => ({
        id: r.id,
        title: r.title,
        workspaceId: r.workspaceId,
        pinned: r.pinned,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      })),
    )
  } catch (err) {
    console.error('[api/conversations] GET failed:', err)
    return NextResponse.json(
      { error: 'Failed to load conversations' },
      { status: 500 },
    )
  }
}

interface CreateBody {
  title?: string
  workspaceId?: string | null
}

// POST /api/conversations — create a new conversation.
export async function POST(req: Request) {
  try {
    const user = await getCurrentUser(req)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const body = (await req.json().catch(() => ({}))) as CreateBody
    const title =
      typeof body.title === 'string' && body.title.trim()
        ? body.title.trim()
        : 'New conversation'
    const workspaceId =
      typeof body.workspaceId === 'string' && body.workspaceId.trim()
        ? body.workspaceId.trim()
        : null
    const created = await db.conversation.create({
      data: { userId: user.id, title, workspaceId },
    })
    return NextResponse.json({
      id: created.id,
      title: created.title,
      workspaceId: created.workspaceId,
      pinned: created.pinned,
      createdAt: created.createdAt.toISOString(),
      updatedAt: created.updatedAt.toISOString(),
    })
  } catch (err) {
    console.error('[api/conversations] POST failed:', err)
    return NextResponse.json(
      { error: 'Failed to create conversation' },
      { status: 500 },
    )
  }
}
