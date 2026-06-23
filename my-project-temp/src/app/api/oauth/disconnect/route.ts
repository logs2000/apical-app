import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth-helpers'
import { mapCredential } from '@/lib/mappers'

interface DisconnectBody {
  provider?: string
}

// POST /api/oauth/disconnect — revoke a previously-connected OAuth credential.
//
// Body: { provider: "google" | "github" | ... }
//
// Soft-deletes the credential (status='revoked') so the audit trail is
// preserved. The token is also cleared so it can't be used by the runtime.
// To fully remove the row, hit DELETE /api/credentials/[id] (if/when added).
export async function POST(req: Request) {
  try {
    const user = await getCurrentUser(req)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = (await req.json().catch(() => ({}))) as DisconnectBody
    const providerKey = (body.provider || '').trim().toLowerCase()
    if (!providerKey) {
      return NextResponse.json(
        { error: 'provider is required' },
        { status: 400 },
      )
    }

    const existing = await db.credential.findFirst({
      where: {
        userId: user.id,
        oauthProvider: providerKey,
        kind: 'oauth',
      },
      orderBy: { createdAt: 'desc' },
    })

    if (!existing) {
      return NextResponse.json(
        { error: `No connected credential for ${providerKey}` },
        { status: 404 },
      )
    }

    const updated = await db.credential.update({
      where: { id: existing.id },
      data: {
        status: 'revoked',
        // Clear the tokens — runtime's getOAuthToken skips revoked rows
        // anyway, but belt + suspenders.
        oauthAccessToken: null,
        oauthRefreshToken: null,
        oauthExpiresAt: null,
      },
    })

    return NextResponse.json({
      credential: mapCredential(updated),
      disconnected: true,
      provider: providerKey,
    })
  } catch (err) {
    console.error('[api/oauth/disconnect] POST failed:', err)
    return NextResponse.json(
      { error: 'Failed to disconnect OAuth credential' },
      { status: 500 },
    )
  }
}
