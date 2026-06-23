import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

interface RouteCtx {
  params: Promise<{ id: string }>
}

interface PatchBody {
  name?: string
  description?: string
  color?: string
}

const ALLOWED_COLORS = new Set([
  'emerald',
  'violet',
  'amber',
  'rose',
  'sky',
  'teal',
  'orange',
  'lime',
])

// PATCH /api/workspaces/[id] — update name / description / color.
export async function PATCH(req: Request, { params }: RouteCtx) {
  try {
    const { id } = await params
    const body = (await req.json().catch(() => ({}))) as PatchBody
    const existing = await db.workspace.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json(
        { error: 'Workspace not found' },
        { status: 404 },
      )
    }
    const data: Record<string, unknown> = {}
    if (typeof body.name === 'string' && body.name.trim()) {
      data.name = body.name.trim()
    }
    if (typeof body.description === 'string') {
      data.description = body.description
    }
    if (typeof body.color === 'string' && ALLOWED_COLORS.has(body.color)) {
      data.color = body.color
    }
    if (Object.keys(data).length === 0) {
      return NextResponse.json(
        { error: 'No changes provided. Send name, description, or color.' },
        { status: 400 },
      )
    }
    const updated = await db.workspace.update({ where: { id }, data })
    return NextResponse.json({
      id: updated.id,
      name: updated.name,
      description: updated.description,
      color: updated.color,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    })
  } catch (err) {
    console.error('[api/workspaces/[id]] PATCH failed:', err)
    return NextResponse.json(
      { error: 'Failed to update workspace' },
      { status: 500 },
    )
  }
}
