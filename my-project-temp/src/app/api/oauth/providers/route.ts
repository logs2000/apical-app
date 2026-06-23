import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { mapOAuthProvider } from '@/lib/mappers'
import { getCurrentUser } from '@/lib/auth-helpers'

// GET /api/oauth/providers — the OAuth provider catalog.
// Returns id, key, name, icon, category, description, status, hasClientId,
// supportsCustomCreds, demoMode, scopes, authorizationUrl, tokenUrl.
//
// The frontend uses this to render the connect grid. `hasClientId=false` means
// the user must either supply their own client id/secret (BYO) or use demo mode.
export async function GET(req: Request) {
  try {
    const user = await getCurrentUser(req)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const rows = await db.oAuthProvider.findMany({
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    })
    return NextResponse.json(rows.map(mapOAuthProvider))
  } catch (err) {
    console.error('[api/oauth/providers] GET failed:', err)
    return NextResponse.json(
      { error: 'Failed to load OAuth providers' },
      { status: 500 },
    )
  }
}
