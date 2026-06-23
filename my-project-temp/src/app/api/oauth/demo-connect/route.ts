import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth-helpers'
import { encrypt } from '@/lib/platform/vault'
import { mapCredential } from '@/lib/mappers'

interface DemoBody {
  provider?: string
}

// POST /api/oauth/demo-connect — simulate an OAuth connection (dev/demo).
//
// Body: { provider: "google" | "github" | ... }
//
// When no real OAuth client is configured AND the user hasn't supplied their
// own, the frontend calls this instead of redirecting to the provider. We
// create a Credential row with a fake-but-distinctive access token, status
// 'active', oauthProvider set, and a metaJson that flags it as a demo
// connection.
//
// The credential is fully usable by the runtime — `{{cred:google.key}}` will
// resolve to the demo token, and http steps will inject it as a Bearer header.
// (Real API calls will obviously fail at the provider, but the runtime falls
// back to a simulated response — see src/lib/runtime.ts.)
export async function POST(req: Request) {
  try {
    const user = await getCurrentUser(req)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = (await req.json().catch(() => ({}))) as DemoBody
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
    if (!provider.demoMode) {
      return NextResponse.json(
        {
          error: `${provider.name} does not support demo mode. Supply your own credentials via /api/oauth/start.`,
        },
        { status: 400 },
      )
    }

    // Mint a fake-but-recognizable token so logs are debuggable.
    const fakeAccessToken = `demo_${provider.key}_${Math.random()
      .toString(36)
      .slice(2, 10)}${Math.random().toString(36).slice(2, 10)}`
    const fakeRefreshToken = `demo_refresh_${Math.random()
      .toString(36)
      .slice(2, 12)}`
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000) // +1h

    const meta = {
      provider: provider.key,
      providerName: provider.name,
      scopes: provider.scopes,
      tokenType: 'Bearer',
      connectedVia: 'demo',
      demoMode: true,
      connectedAt: new Date().toISOString(),
      note: 'Demo connection — no real OAuth. Replace with real OAuth to make live API calls.',
    }

    // Upsert: if the user already has a demo credential for this provider,
    // refresh its token; otherwise create a new one.
    const existing = await db.credential.findFirst({
      where: {
        userId: user.id,
        oauthProvider: provider.key,
        kind: 'oauth',
      },
      orderBy: { createdAt: 'desc' },
    })

    // Encrypt the (demo) tokens at rest via the AES-256-GCM vault so the
    // code path is identical to real OAuth — only the token contents differ.
    const encAccessToken = encrypt(fakeAccessToken)
    const encRefreshToken = encrypt(fakeRefreshToken)

    let cred
    if (existing) {
      cred = await db.credential.update({
        where: { id: existing.id },
        data: {
          status: 'active',
          oauthAccessToken: encAccessToken,
          oauthRefreshToken: encRefreshToken,
          oauthExpiresAt: expiresAt,
          metaJson: JSON.stringify(meta),
        },
      })
    } else {
      cred = await db.credential.create({
        data: {
          userId: user.id,
          service: provider.key,
          label: `${provider.name} — Demo`,
          kind: 'oauth',
          status: 'active',
          oauthProvider: provider.key,
          oauthAccessToken: encAccessToken,
          oauthRefreshToken: encRefreshToken,
          oauthExpiresAt: expiresAt,
          metaJson: JSON.stringify(meta),
          agentProvisioned: false,
          canPay: false,
        },
      })
    }

    return NextResponse.json({
      credential: mapCredential(cred),
      demoMode: true as const,
      provider: provider.key,
    })
  } catch (err) {
    console.error('[api/oauth/demo-connect] POST failed:', err)
    return NextResponse.json(
      { error: 'Failed to simulate OAuth connection' },
      { status: 500 },
    )
  }
}
