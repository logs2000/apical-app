import { NextResponse } from 'next/server'
import { withUser } from '@/lib/auth-helpers'
import { db } from '@/lib/db'
import { saveMemory } from '@/lib/platform/memory'

// GET /api/memory?kind=&agentId= — list the user's memory entries.
export const GET = withUser(async (req, { user }) => {
  const url = new URL(req.url)
  const kind = url.searchParams.get('kind')
  const agentId = url.searchParams.get('agentId')
  const entries = await db.memoryEntry.findMany({
    where: {
      userId: user.id,
      status: 'active',
      ...(kind ? { kind } : {}),
      ...(agentId ? { agentId } : {}),
    },
    orderBy: [{ confidence: 'desc' }, { updatedAt: 'desc' }],
    take: 200,
    select: {
      id: true, kind: true, subject: true, content: true, confidence: true,
      timesReinforced: true, sourceKind: true, agentId: true, updatedAt: true,
    },
  })
  return NextResponse.json({ entries })
})

interface CreateBody {
  kind: string
  content: string
  subject?: string
  agentId?: string | null
}

// POST /api/memory — add a memory entry manually.
export const POST = withUser(async (req, { user }) => {
  const body = (await req.json().catch(() => ({}))) as CreateBody
  if (!body.content?.trim()) return NextResponse.json({ error: 'content is required' }, { status: 400 })
  await saveMemory({
    userId: user.id,
    agentId: body.agentId ?? null,
    kind: body.kind || 'fact',
    content: body.content,
    subject: body.subject ?? null,
    confidence: 0.85,
    sourceKind: 'manual',
  })
  return NextResponse.json({ ok: true }, { status: 201 })
})
