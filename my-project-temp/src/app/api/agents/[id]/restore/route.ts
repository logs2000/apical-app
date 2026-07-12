import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth-helpers'
import { db } from '@/lib/db'
import { restoreCheckpoint } from '@/lib/platform/restore'

interface RouteCtx {
  params: Promise<{ id: string }>
}

// GET /api/agents/[id]/restore — list this agent's active restore points
// (Cursor-style "revert to here"), newest first, with what each would undo.
export async function GET(req: Request, { params }: RouteCtx) {
  const user = await getCurrentUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const agent = await db.workflow.findUnique({ where: { id }, select: { userId: true } })
  if (!agent || agent.userId !== user.id) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const checkpoints = await db.restoreCheckpoint.findMany({
    where: { agentId: id, userId: user.id, status: 'active' },
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: { _count: { select: { snapshots: true } } },
  })
  return NextResponse.json({
    checkpoints: checkpoints.map((c) => ({
      id: c.id,
      label: c.label,
      messageId: c.messageId,
      createdAt: c.createdAt,
      expiresAt: c.expiresAt,
      fileCount: c._count.snapshots,
    })),
  })
}

// POST /api/agents/[id]/restore  { checkpointId } — undo the files the agent
// wrote/moved/deleted in that turn, and recover soft-deleted assets.
export async function POST(req: Request, { params }: RouteCtx) {
  const user = await getCurrentUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const agent = await db.workflow.findUnique({ where: { id }, select: { userId: true } })
  if (!agent || agent.userId !== user.id) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = (await req.json().catch(() => ({}))) as { checkpointId?: string }
  if (typeof body.checkpointId !== 'string') {
    return NextResponse.json({ error: 'checkpointId is required' }, { status: 400 })
  }
  // Ownership: the checkpoint must belong to this user + agent.
  const cp = await db.restoreCheckpoint.findUnique({ where: { id: body.checkpointId } })
  if (!cp || cp.userId !== user.id || cp.agentId !== id) {
    return NextResponse.json({ error: 'Checkpoint not found' }, { status: 404 })
  }
  if (cp.status !== 'active') {
    return NextResponse.json({ error: `Checkpoint is ${cp.status}, cannot restore` }, { status: 409 })
  }

  try {
    const result = await restoreCheckpoint(body.checkpointId)
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    console.error('[api/agents/[id]/restore] failed:', err)
    return NextResponse.json({ error: 'Restore failed' }, { status: 500 })
  }
}
