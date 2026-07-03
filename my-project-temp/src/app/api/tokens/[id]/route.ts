import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withUser, getWorkspaceForUser } from '@/lib/auth-helpers'

// DELETE /api/tokens/[id] — revoke a personal API key.
// Sets status='revoked' (does NOT delete — we keep the row for audit history).

export const DELETE = withUser(async (_req, { user, params }) => {
  const { id } = await params
  if (!id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 })
  }

  const workspace = await getWorkspaceForUser(user)
  const existing = await db.apiKey.findFirst({
    where: { id, workspaceId: workspace.id, createdById: user.id },
    select: { id: true },
  })
  if (!existing) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  await db.apiKey.update({
    where: { id: existing.id },
    data: { status: 'revoked' },
  })

  return NextResponse.json({ ok: true, id: existing.id, status: 'revoked' })
})
