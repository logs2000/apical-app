import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth-helpers'

// GET /api/agents/[id]/widgets — list an agent's dashboard widgets.
// POST /api/agents/[id]/widgets — create or update a widget (agents call this during runs).
// DELETE /api/agents/[id]/widgets — clear all widgets.

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

export async function GET(req: Request, { params }: RouteCtx) {
  try {
    const { id } = await params
    const guard = await requireAgentOwnership(req, id)
    if (guard) return guard
    const widgets = await db.agentWidget.findMany({
      where: { agentId: id },
      orderBy: [{ col: 'asc' }, { ord: 'asc' }],
    })
    return NextResponse.json(widgets.map((w) => ({
      id: w.id,
      agentId: w.agentId,
      type: w.type,
      title: w.title,
      data: JSON.parse(w.dataJson),
      column: w.col,
      order: w.ord,
      updatedAt: w.updatedAt.toISOString(),
    })))
  } catch {
    return NextResponse.json({ error: 'Failed to load widgets' }, { status: 500 })
  }
}

export async function POST(req: Request, { params }: RouteCtx) {
  try {
    const { id } = await params
    const guard = await requireAgentOwnership(req, id)
    if (guard) return guard
    const body = await req.json()
    const existing = await db.agentWidget.findFirst({ where: { agentId: id, title: body.title } })
    if (existing) {
      const updated = await db.agentWidget.update({
        where: { id: existing.id },
        data: {
          type: body.type ?? existing.type,
          dataJson: JSON.stringify(body.data ?? {}),
          col: body.column ?? existing.col,
          ord: body.order ?? existing.ord,
        },
      })
      return NextResponse.json({ id: updated.id, type: updated.type, title: updated.title, data: JSON.parse(updated.dataJson) })
    }
    const created = await db.agentWidget.create({
      data: {
        agentId: id,
        type: body.type ?? 'stat',
        title: body.title,
        dataJson: JSON.stringify(body.data ?? {}),
        col: body.column ?? 0,
        ord: body.order ?? 0,
      },
    })
    return NextResponse.json({ id: created.id, type: created.type, title: created.title, data: JSON.parse(created.dataJson) })
  } catch {
    return NextResponse.json({ error: 'Failed to save widget' }, { status: 500 })
  }
}

export async function DELETE(req: Request, { params }: RouteCtx) {
  try {
    const { id } = await params
    const guard = await requireAgentOwnership(req, id)
    if (guard) return guard
    await db.agentWidget.deleteMany({ where: { agentId: id } })
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Failed to delete widgets' }, { status: 500 })
  }
}
