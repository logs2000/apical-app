import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth-helpers'
import type { AgentDataRow, AgentDataKind } from '@/lib/types'

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

function mapAgentData(row: {
  id: string
  agentId: string
  kind: string
  key: string
  valueJson: string | null
  filePath: string | null
  metaJson: string | null
  updatedAt: Date
}): AgentDataRow {
  let value: unknown = undefined
  if (row.valueJson) {
    try { value = JSON.parse(row.valueJson) } catch { value = undefined }
  }
  let meta: Record<string, unknown> | null = null
  if (row.metaJson) {
    try { meta = JSON.parse(row.metaJson) } catch { meta = null }
  }
  return {
    id: row.id,
    agentId: row.agentId,
    kind: row.kind as AgentDataKind,
    key: row.key,
    value,
    filePath: row.filePath,
    meta,
    updatedAt: row.updatedAt.toISOString(),
  }
}

// GET /api/agents/[id]/data?kind=output|table|state — list an agent's data.
export async function GET(req: Request, { params }: RouteCtx) {
  try {
    const { id } = await params
    const guard = await requireAgentOwnership(req, id)
    if (guard) return guard
    const url = new URL(req.url)
    const kindFilter = url.searchParams.get('kind')
    const rows = await db.agentData.findMany({
      where: {
        agentId: id,
        ...(kindFilter && ['output', 'table', 'state'].includes(kindFilter) ? { kind: kindFilter } : {}),
      },
      orderBy: [{ kind: 'asc' }, { key: 'asc' }],
    })
    return NextResponse.json(rows.map(mapAgentData))
  } catch (err) {
    console.error('[api/agents/[id]/data] GET failed:', err)
    return NextResponse.json({ error: 'Failed to load agent data' }, { status: 500 })
  }
}

interface PostBody {
  kind: AgentDataKind
  key: string
  value?: unknown
  filePath?: string | null
  meta?: Record<string, unknown> | null
}

// POST /api/agents/[id]/data — upsert a data row. Agents call this during runs.
export async function POST(req: Request, { params }: RouteCtx) {
  try {
    const { id } = await params
    const guard = await requireAgentOwnership(req, id)
    if (guard) return guard
    const body = (await req.json()) as PostBody
    if (!body || !body.kind || !body.key) {
      return NextResponse.json({ error: 'kind and key are required' }, { status: 400 })
    }
    const kind = ['output', 'table', 'state'].includes(body.kind) ? body.kind : 'state'
    const existing = await db.agentData.findUnique({
      where: { agentId_kind_key: { agentId: id, kind, key: body.key } },
    })
    if (existing) {
      const updated = await db.agentData.update({
        where: { id: existing.id },
        data: {
          valueJson: body.value !== undefined ? JSON.stringify(body.value) : existing.valueJson,
          filePath: body.filePath !== undefined ? body.filePath : existing.filePath,
          metaJson: body.meta !== undefined ? JSON.stringify(body.meta) : existing.metaJson,
        },
      })
      return NextResponse.json(mapAgentData(updated))
    }
    const created = await db.agentData.create({
      data: {
        agentId: id,
        kind,
        key: body.key,
        valueJson: body.value !== undefined ? JSON.stringify(body.value) : null,
        filePath: body.filePath ?? null,
        metaJson: body.meta ? JSON.stringify(body.meta) : null,
      },
    })
    return NextResponse.json(mapAgentData(created))
  } catch (err) {
    console.error('[api/agents/[id]/data] POST failed:', err)
    return NextResponse.json({ error: 'Failed to save agent data' }, { status: 500 })
  }
}

// DELETE /api/agents/[id]/data?key=...&kind=... — delete one row (or all if no params).
export async function DELETE(req: Request, { params }: RouteCtx) {
  try {
    const { id } = await params
    const guard = await requireAgentOwnership(req, id)
    if (guard) return guard
    const url = new URL(req.url)
    const key = url.searchParams.get('key')
    const kind = url.searchParams.get('kind')
    if (key && kind) {
      await db.agentData.deleteMany({ where: { agentId: id, kind, key } })
    } else {
      await db.agentData.deleteMany({ where: { agentId: id } })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[api/agents/[id]/data] DELETE failed:', err)
    return NextResponse.json({ error: 'Failed to delete agent data' }, { status: 500 })
  }
}
