import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withUser } from '@/lib/auth-helpers'
import { mapSession } from '@/lib/desktop/session-dto'

// DELETE /api/desktop/sessions/[id] — revoke a desktop session.
//
// Revoking deletes the row entirely. Any socket currently connected to the
// desktop-bridge with the old sessionToken will be disconnected on its next
// action (or immediately if we extend the bridge to push a `desktop:kicked`
// event). Future auth attempts with the old token will fail (token not found).
//
// Ownership-checked: returns 404 if the session doesn't exist OR belongs to a
// different user (no existence leak).

interface RouteCtx {
  params: Promise<{ id: string }>
}

export const DELETE = withUser(async (_req, { user, params }) => {
  const { id } = params
  const existing = await db.desktopSession.findUnique({ where: { id } })
  if (!existing || existing.userId !== user.id) {
    return NextResponse.json(
      { error: 'Desktop session not found' },
      { status: 404 },
    )
  }

  await db.desktopSession.delete({ where: { id } })

  return NextResponse.json({ ok: true, session: mapSession(existing) })
})
