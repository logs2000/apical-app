import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { consumeOAuthState } from '@/lib/oauth-state'
import { exchangeCodeForTokens, getOAuthRedirectUri } from '@/lib/oauth-helpers'
import { encrypt } from '@/lib/platform/vault'
import { mapCredential } from '@/lib/mappers'

// GET /api/oauth/callback — the OAuth 2.0 redirect endpoint.
//
// Providers redirect here after the user authorizes (or denies). Query params:
//   Success: ?code=xxx&state=yyy
//   Denied:  ?error=access_denied&error_description=...
//
// Flow:
//   1. Look up the state in our in-memory store (one-shot consume).
//   2. If state is missing/expired/replayed → redirect to /?oauth_error=...
//   3. If the provider returned an error → redirect with the error.
//   4. Exchange the code for tokens (POST to provider's tokenUrl).
//   5. Store access/refresh tokens on a Credential row owned by the user.
//   6. Redirect to /?oauth_success=<provider> so the frontend shows a toast.
//
// NOTE: this endpoint does NOT call getCurrentUser — the user is identified by
// the state token, which was minted by an authenticated /api/oauth/start call.
// (OAuth redirects don't carry our auth cookies reliably across providers, and
// some providers strip cookies entirely.)
export async function GET(req: Request) {
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const error = url.searchParams.get('error')
  const errorDesc = url.searchParams.get('error_description')

  // Helper: redirect to / with a status query param. Always 302.
  const redirectTo = (q: string) => NextResponse.redirect(new URL(`/${q}`, url.origin))

  // 1. Provider-side error (user denied, or provider returned an error).
  if (error) {
    const msg = errorDesc ? `${error}: ${errorDesc}` : error
    return redirectTo(`?oauth_error=${encodeURIComponent(msg)}`)
  }

  // 2. Missing code or state.
  if (!code || !state) {
    return redirectTo('?oauth_error=missing_code_or_state')
  }

  // 3. Verify + consume the state (one-shot — replay attacks rejected).
  const entry = consumeOAuthState(state)
  if (!entry) {
    return redirectTo('?oauth_error=invalid_or_expired_state')
  }

  try {
    const provider = await db.oAuthProvider.findUnique({
      where: { key: entry.provider },
    })
    if (!provider) {
      return redirectTo(`?oauth_error=unknown_provider_${entry.provider}`)
    }

    // Resolve the OAuth client credentials. Prefer the operator-configured
    // pair; fall back to the BYO pair stored on the state entry.
    const clientId = provider.clientId?.trim() || entry.customClientId || ''
    const clientSecret =
      provider.clientSecret?.trim() || entry.customClientSecret || ''
    if (!clientId || !clientSecret) {
      return redirectTo(`?oauth_error=missing_client_credentials`)
    }

    // 4. Exchange the authorization code for tokens.
    const tokens = await exchangeCodeForTokens({
      tokenUrl: provider.tokenUrl,
      code,
      redirectUri: getOAuthRedirectUri(),
      clientId,
      clientSecret,
    })

    if (tokens.error || !tokens.access_token) {
      const msg = tokens.error_description || tokens.error || 'no_access_token'
      return redirectTo(`?oauth_error=${encodeURIComponent(String(msg))}`)
    }

    // 5. Compute expiry (if the provider returned expires_in seconds).
    const expiresAt =
      typeof tokens.expires_in === 'number' && tokens.expires_in > 0
        ? new Date(Date.now() + tokens.expires_in * 1000)
        : null

    // 6. Upsert a Credential row. If the user already has a credential for
    //    this provider, refresh its tokens; otherwise create a new one.
    const meta = {
      provider: provider.key,
      providerName: provider.name,
      scopes: tokens.scope || provider.scopes,
      tokenType: tokens.token_type || 'Bearer',
      connectedVia: 'oauth',
      connectedAt: new Date().toISOString(),
    }

    // Look for an existing OAuth credential for this user+provider.
    const existing = await db.credential.findFirst({
      where: {
        userId: entry.userId,
        oauthProvider: provider.key,
        kind: 'oauth',
      },
      orderBy: { createdAt: 'desc' },
    })

    // Encrypt tokens at rest via the AES-256-GCM vault.
    const encAccessToken = encrypt(tokens.access_token)
    const encRefreshToken = tokens.refresh_token
      ? encrypt(tokens.refresh_token)
      : existing?.oauthRefreshToken ?? null

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
          userId: entry.userId,
          service: provider.key,
          label: `${provider.name} — OAuth`,
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

    // Map for log shape (not strictly needed; the redirect doesn't carry it).
    void mapCredential(cred)

    return redirectTo(`?oauth_success=${encodeURIComponent(provider.key)}`)
  } catch (err) {
    console.error('[api/oauth/callback] failed:', err)
    const msg = err instanceof Error ? err.message : 'unknown_error'
    return redirectTo(`?oauth_error=${encodeURIComponent(msg)}`)
  }
}
