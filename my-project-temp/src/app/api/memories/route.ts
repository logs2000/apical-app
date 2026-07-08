// GET  /api/memories            — the caller's agent memories (all agents).
// GET  /api/memories?workflowId= — one agent's memories (ownership-checked).
// POST /api/memories            — manually add a memory to one of your agents.
//
// Memories are normally written by agents themselves via the save_memory tool
// during runs; this API powers the Memory view (list + delete) and manual adds.

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withUser } from '@/lib/auth-helpers'

const MEMORY_KINDS = new Set(['entity', 'preference', 'correction', 'pattern'])

export const GET = withUser(async (req, { user }) => {
  const workflowId = new URL(req.url).searchParams.get('workflowId')

  if (workflowId) {
    const workflow = await db.workflow.findFirst({
      where: { id: workflowId, OR: [{ userId: user.id }, { userId: null }] },
      select: { id: true },
    })
    if (!workflow) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    const memories = await db.agentMemory.findMany({
      where: { agentId: workflowId },
      orderBy: { createdAt: 'desc' },
      take: 1000,
    })
    return NextResponse.json({ memories: memories.map(mapMemory) })
  }

  const memories = await db.agentMemory.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
    take: 1000,
  })
  return NextResponse.json({ memories: memories.map(mapMemory) })
})

interface CreateBody {
  workflowId?: string
  kind?: string
  text?: string
  source?: string
}

export const POST = withUser(async (req, { user }) => {
  let body: CreateBody
  try {
    body = (await req.json()) as CreateBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const workflowId = typeof body.workflowId === 'string' ? body.workflowId : ''
  const text = typeof body.text === 'string' ? body.text.trim().slice(0, 500) : ''
  const kind =
    typeof body.kind === 'string' && MEMORY_KINDS.has(body.kind) ? body.kind : 'entity'
  const source =
    typeof body.source === 'string' && body.source.trim()
      ? body.source.trim().slice(0, 120)
      : 'Added manually'

  if (!workflowId || !text) {
    return NextResponse.json(
      { error: 'workflowId and text are required' },
      { status: 400 },
    )
  }

  const workflow = await db.workflow.findFirst({
    where: { id: workflowId, OR: [{ userId: user.id }, { userId: null }] },
    select: { id: true },
  })
  if (!workflow) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const row = await db.agentMemory.create({
    data: { userId: user.id, agentId: workflowId, kind, text, source },
  })
  return NextResponse.json({ memory: mapMemory(row) }, { status: 201 })
})

function mapMemory(m: {
  id: string
  agentId: string
  kind: string
  text: string
  source: string
  createdAt: Date
}) {
  return {
    id: m.id,
    agentId: m.agentId,
    kind: m.kind,
    text: m.text,
    source: m.source,
    createdAt: m.createdAt.toISOString(),
  }
}
