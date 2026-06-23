import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET /api/workspaces — list all workspaces, oldest first (stable order).
export async function GET() {
  try {
    const rows = await db.workspace.findMany({
      orderBy: { createdAt: 'asc' },
    })
    return NextResponse.json(
      rows.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        color: r.color,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      })),
    )
  } catch (err) {
    console.error('[api/workspaces] GET failed:', err)
    return NextResponse.json(
      { error: 'Failed to load workspaces' },
      { status: 500 },
    )
  }
}

interface CreateBody {
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

// POST /api/workspaces — create a new workspace. Default color 'emerald'.
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as CreateBody
    const name = (body.name || '').trim()
    if (!name) {
      return NextResponse.json(
        { error: 'name is required' },
        { status: 400 },
      )
    }
    const description =
      typeof body.description === 'string' ? body.description : ''
    const color =
      typeof body.color === 'string' && ALLOWED_COLORS.has(body.color)
        ? (body.color as string)
        : 'emerald'
    const created = await db.workspace.create({
      data: { name, description, color },
    })
    return NextResponse.json({
      id: created.id,
      name: created.name,
      description: created.description,
      color: created.color,
      createdAt: created.createdAt.toISOString(),
      updatedAt: created.updatedAt.toISOString(),
    })
  } catch (err) {
    console.error('[api/workspaces] POST failed:', err)
    return NextResponse.json(
      { error: 'Failed to create workspace' },
      { status: 500 },
    )
  }
}
