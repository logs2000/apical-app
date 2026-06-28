// DELETE /api/auth/pat/[id] — revoke a PAT.
//
// Marks the token as `status='revoked'` (soft delete — preserves the audit
// trail of when it was created/last used). Subsequent authenticatePat() calls
// with the revoked token's hash will return null.

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth-helpers'

export async function DELETE(
  req: Request,
  routeCtx: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getCurrentUser(req)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await routeCtx.params
    if (!id) {
      return NextResponse.json({ error: 'Token id is required.' }, { status: 400 })
    }

    // Make sure the PAT belongs to the current user before revoking.
    const pat = await db.personalAccessToken.findUnique({ where: { id } })
    if (!pat || pat.userId !== user.id) {
      return NextResponse.json({ error: 'Token not found.' }, { status: 404 })
    }

    const updated = await db.personalAccessToken.update({
      where: { id },
      data: { status: 'revoked' },
    })

    return NextResponse.json({
      id: updated.id,
      status: updated.status,
    })
  } catch (err) {
    console.error('[api/auth/pat/[id]] DELETE failed:', err)
    return NextResponse.json(
      { error: 'Could not revoke personal access token.' },
      { status: 500 },
    )
  }
}
