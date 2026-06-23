// DELETE /api/byok/[id] — delete one of the current user's BYOK keys.
//
// 404 if the key doesn't exist OR exists but isn't owned by the user
// (we don't leak existence to other users).

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withUser } from '@/lib/auth-helpers'

export const DELETE = withUser(async (_req, { user, params }) => {
  const id = params.id
  if (!id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 })
  }

  // Find first (scoped to the user) so we can 404 cleanly on not-owned.
  const existing = await db.byokKey.findFirst({
    where: { id, userId: user.id },
    select: { id: true },
  })
  if (!existing) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  await db.byokKey.delete({ where: { id: existing.id } })

  // Also unlink any CustomModels that referenced this key (set byokKeyId=null).
  // They'll fall back to "not configured" in listAvailableModels.
  await db.customModel.updateMany({
    where: { byokKeyId: existing.id, userId: user.id },
    data: { byokKeyId: null },
  })

  return NextResponse.json({ ok: true, id: existing.id })
})
