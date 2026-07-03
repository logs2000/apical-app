import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withUser } from '@/lib/auth-helpers'

// DELETE /api/desktop/folders/[id] — revoke a granted folder root.
export const DELETE = withUser(async (_req, { user, params }) => {
  const folder = await db.grantedFolder.findUnique({ where: { id: params.id } })
  if (!folder || folder.userId !== user.id) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  await db.grantedFolder.delete({ where: { id: folder.id } })
  return NextResponse.json({ ok: true })
})
