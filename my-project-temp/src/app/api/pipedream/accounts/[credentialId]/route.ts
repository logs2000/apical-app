import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth-helpers'
import { removePipedreamConnection } from '@/lib/pipedream/sync'

// DELETE /api/pipedream/accounts/[credentialId] — disconnect a managed
// connection: deletes the account upstream in Pipedream, revokes the local
// Credential, and removes the Integration.
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ credentialId: string }> },
) {
  try {
    const user = await getCurrentUser(req)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const { credentialId } = await params
    const { ok, error } = await removePipedreamConnection(user.id, credentialId)
    if (!ok) {
      return NextResponse.json({ error: error || 'Failed to disconnect' }, { status: 404 })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[api/pipedream/accounts/:id] DELETE failed:', err)
    return NextResponse.json({ error: 'Failed to disconnect' }, { status: 500 })
  }
}
