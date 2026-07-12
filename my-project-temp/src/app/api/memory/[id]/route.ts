import { NextResponse } from 'next/server'
import { withUser } from '@/lib/auth-helpers'
import { db } from '@/lib/db'

interface PatchBody {
  content?: string
  status?: 'active' | 'archived'
}

// PATCH /api/memory/[id] — edit or archive an entry.
export const PATCH = withUser(async (req, { user, params }) => {
  const entry = await db.memoryEntry.findFirst({ where: { id: params.id, userId: user.id }, select: { id: true } })
  if (!entry) return NextResponse.json({ error: 'not found' }, { status: 404 })
  const body = (await req.json().catch(() => ({}))) as PatchBody
  await db.memoryEntry.update({
    where: { id: entry.id },
    data: {
      ...(body.content ? { content: body.content } : {}),
      ...(body.status ? { status: body.status } : {}),
    },
  })
  return NextResponse.json({ ok: true })
})

// DELETE /api/memory/[id] — archive (soft delete).
export const DELETE = withUser(async (_req, { user, params }) => {
  const entry = await db.memoryEntry.findFirst({ where: { id: params.id, userId: user.id }, select: { id: true } })
  if (!entry) return NextResponse.json({ error: 'not found' }, { status: 404 })
  await db.memoryEntry.update({ where: { id: entry.id }, data: { status: 'archived' } })
  return NextResponse.json({ ok: true })
})
