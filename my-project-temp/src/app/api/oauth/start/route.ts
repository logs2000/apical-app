import { NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { db } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth-helpers'
import { setOAuthState } from '@/lib/oauth-state'
import { buildAuthorizationUrl, getOAuthRedirectUri } from '@/lib/oauth-helpers'

interface StartBody {
  provider?: string
  customClientId?: string
  customClientSecret?: string
}

// POST /api/oauth/start — start the OAuth 2.0 authorization-code flow.
//
// Body: { provider: "google" | "github" | ..., customClientId?, customClientSecret? }
//
// Resolution order for the OAuth client credentials:
//   1. The provider row's `clientId` (set by an operator in production).
//   2. The `customClientId`/`customClientSecret` from the request body
//      ("bring your own credentials" — the user supplies their own OAuth app).
//   3. If neither is set AND `demoMode` is true on the provider, return
//      `{ demoMode: true }` so the frontend calls /api/oauth/demo-connect.
//   4. Otherwise, return a 400 telling the user to supply credentials.
//
// When real credentials are available, we mint a random `state` token, store
// the (userId, provider, customClientId/Secret) triple, and return the full
// authorization URL the browser should redirect to.
export async function POST(req: Request) {
  try {
    const user = await getCurrentUser(req)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = (await req.json().catch(() => ({}))) as StartBody
    const providerKey = (body.provider || '').trim().toLowerCase()
    if (!providerKey) {
      return NextResponse.json(
        { error: 'provider is required' },
        { status: 400 },
      )
    }

    const provider = await db.oAuthProvider.findUnique({
      where: { key: providerKey },
    })
    if (!provider) {
      return NextResponse.json(
        { error: `Unknown OAuth provider: ${providerKey}` },
        { status: 404 },
      )
    }
    if (provider.status !== 'active') {
      return NextResponse.json(
        { error: `Provider ${provider.name} is ${provider.status}` },
        { status: 400 },
      )
    }

    // 1. Operator-configured client (production).
    const opClientId = provider.clientId?.trim() || ''
    const opClientSecret = provider.clientSecret?.trim() || ''

    // 2. Bring-your-own-credentials from the request body.
    const byoClientId = (body.customClientId || '').trim()
    const byoClientSecret = (body.customClientSecret || '').trim()

    let clientId = opClientId
    let clientSecret = opClientSecret
    let usingByo = false
    if (!clientId && byoClientId) {
      clientId = byoClientId
      clientSecret = byoClientSecret
      usingByo = true
    }

    // 3. No client id anywhere → demo mode (if available) or error.
    if (!clientId) {
      if (provider.demoMode) {
        return NextResponse.json({
          demoMode: true,
          provider: provider.key,
          message: `Demo connection — no real OAuth. Click "Connect" to simulate a ${provider.name} connection.`,
        })
      }
      return NextResponse.json(
        {
          error: `No OAuth client configured for ${provider.name}. Supply your own clientId/clientSecret, or set one on the provider.`,
          supportsCustomCreds: provider.supportsCustomCreds,
        },
        { status: 400 },
      )
    }

    if (usingByo && !clientSecret) {
      return NextResponse.json(
        { error: 'customClientSecret is required when using custom credentials.' },
        { status: 400 },
      )
    }

    // Mint a random state token (16 bytes → 32 hex chars).
    const state = randomBytes(16).toString('hex')
    setOAuthState(state, {
      userId: user.id,
      provider: provider.key,
      providerName: provider.name,
      ...(usingByo
        ? { customClientId: clientId, customClientSecret: clientSecret }
        : {}),
    })

    const authorizationUrl = buildAuthorizationUrl({
      authorizationUrl: provider.authorizationUrl,
      clientId,
      redirectUri: getOAuthRedirectUri(),
      scopes: provider.scopes,
      state,
    })

    return NextResponse.json({
      authorizationUrl,
      state,
      provider: provider.key,
      demoMode: false,
      usingByo,
    })
  } catch (err) {
    console.error('[api/oauth/start] POST failed:', err)
    return NextResponse.json(
      { error: 'Failed to start OAuth flow' },
      { status: 500 },
    )
  }
}
