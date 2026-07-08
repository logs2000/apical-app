// DELETE /api/memories/[id] — forget one memory. 404 if the row doesn't exist
// or isn't owned by the caller.

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withUser } from '@/lib/auth-helpers'

export const DELETE = withUser(async (_req, { user, params }) => {
  const id = params.id
  if (!id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 })
  }

  const existing = await db.agentMemory.findFirst({
    where: { id, userId: user.id },
    select: { id: true },
  })
  if (!existing) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  await db.agentMemory.delete({ where: { id: existing.id } })
  return NextResponse.json({ ok: true, id: existing.id })
})
