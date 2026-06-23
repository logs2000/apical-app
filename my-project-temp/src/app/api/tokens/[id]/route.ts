import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withUser } from '@/lib/auth-helpers'

// DELETE /api/tokens/[id] — revoke a personal access token.
// Sets status='revoked' (does NOT delete — we keep the row for audit history).

interface RouteCtx {
  params: Promise<{ id: string }>
}

export const DELETE = withUser(async (_req, { user, params }) => {
  const { id } = await params
  if (!id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 })
  }

  const existing = await db.personalAccessToken.findFirst({
    where: { id, userId: user.id },
    select: { id: true },
  })
  if (!existing) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  await db.personalAccessToken.update({
    where: { id: existing.id },
    data: { status: 'revoked' },
  })

  return NextResponse.json({ ok: true, id: existing.id, status: 'revoked' })
})
