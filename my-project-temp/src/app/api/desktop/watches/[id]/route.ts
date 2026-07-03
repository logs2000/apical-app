import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withUser } from '@/lib/auth-helpers'

// PATCH  /api/desktop/watches/[id] — pause/resume or edit the pattern.
// DELETE /api/desktop/watches/[id] — remove the watch.

export const PATCH = withUser(async (req, { user, params }) => {
  const watch = await db.watchedFolder.findUnique({ where: { id: params.id } })
  if (!watch || watch.userId !== user.id) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  let body: { status?: string; pattern?: string | null } = {}
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  const data: { status?: string; pattern?: string | null } = {}
  if (body.status === 'active' || body.status === 'paused') data.status = body.status
  if (body.pattern !== undefined) {
    data.pattern =
      typeof body.pattern === 'string' && body.pattern.trim()
        ? body.pattern.trim().slice(0, 200)
        : null
  }

  const updated = await db.watchedFolder.update({
    where: { id: watch.id },
    data,
  })
  return NextResponse.json({
    id: updated.id,
    status: updated.status,
    pattern: updated.pattern,
  })
})

export const DELETE = withUser(async (_req, { user, params }) => {
  const watch = await db.watchedFolder.findUnique({ where: { id: params.id } })
  if (!watch || watch.userId !== user.id) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  await db.watchedFolder.delete({ where: { id: watch.id } })
  return NextResponse.json({ ok: true })
})
