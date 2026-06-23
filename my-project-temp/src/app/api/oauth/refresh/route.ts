import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth-helpers'
import { refreshCredential } from '@/lib/oauth-helpers'
import { db } from '@/lib/db'

// POST /api/oauth/refresh — manually refresh a single OAuth credential's
// access token using its stored refresh token. The current user must own the
// credential (we scope by userId). Useful for the UI "Refresh now" button on
// the Vault tab when a credential shows as expiring/expired.
//
// Body: { credentialId: string }
// Returns: { ok: boolean, credentialId, error? }

interface RefreshBody {
  credentialId?: string
}

export async function POST(req: Request) {
  try {
    const user = await getCurrentUser(req)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = (await req.json().catch(() => ({}))) as RefreshBody
    const credentialId = (body.credentialId || '').trim()
    if (!credentialId) {
      return NextResponse.json(
        { error: 'credentialId is required' },
        { status: 400 },
      )
    }

    // Verify ownership before refreshing.
    const cred = await db.credential.findUnique({ where: { id: credentialId } })
    if (!cred || cred.userId !== user.id) {
      return NextResponse.json(
        { error: 'Credential not found' },
        { status: 404 },
      )
    }

    const result = await refreshCredential(credentialId)
    return NextResponse.json(result, { status: result.ok ? 200 : 400 })
  } catch (err) {
    console.error('[api/oauth/refresh] failed:', err)
    return NextResponse.json(
      { error: 'Failed to refresh credential' },
      { status: 500 },
    )
  }
}
