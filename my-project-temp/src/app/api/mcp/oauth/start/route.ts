import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth-helpers'
import { startMcpOAuthFlow } from '@/lib/auth/mcp-oauth-client'
import { setOAuthState } from '@/lib/oauth-state'

// POST /api/mcp/oauth/start — start an MCP OAuth 2.1 flow.
//
// Body:
//   {
//     serverUrl: string,         // required — the MCP server URL
//     clientId: string,          // required — BYO OAuth client_id
//     clientSecret?: string,     // optional — for confidential clients
//     redirectUri?: string,      // optional — defaults to the configured loopback
//     scope?: string,            // optional — defaults to AS-declared scopes
//   }
//
// Returns:
//   {
//     authorizationUrl: string,  // redirect the browser here
//     state: string,             // CSRF token
//     pkceVerifier: string,      // persisted internally for the exchange step
//     resource?: string,         // RFC 8707 resource indicator
//     tokenUrl: string,          // for the exchange step
//     serverUrl: string,         // echo
//   }
//
// The pkceVerifier + tokenUrl + resource are stashed in the in-memory OAuth
// state store keyed by the state token, so /api/mcp/oauth/complete can
// retrieve them. The caller just redirects the browser to `authorizationUrl`.

interface StartBody {
  serverUrl?: string
  clientId?: string
  clientSecret?: string
  redirectUri?: string
  scope?: string
}

// The default redirect URI for MCP OAuth. In hosted mode, this is the
// Next.js callback route. In Tauri mode, the desktop-bridge replaces this
// with a loopback URL (http://127.0.0.1:<port>/callback) at runtime.
function getDefaultRedirectUri(req: Request): string {
  const url = new URL(req.url)
  return `${url.origin}/api/mcp/oauth/callback`
}

export async function POST(req: Request) {
  try {
    const user = await getCurrentUser(req)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = (await req.json().catch(() => ({}))) as StartBody
    const serverUrl = (body.serverUrl || '').trim()
    const clientId = (body.clientId || '').trim()
    if (!serverUrl) {
      return NextResponse.json({ error: 'serverUrl is required' }, { status: 400 })
    }
    if (!clientId) {
      return NextResponse.json(
        { error: 'clientId is required (BYOC — register your own OAuth client with the AS).' },
        { status: 400 },
      )
    }

    const redirectUri = body.redirectUri?.trim() || getDefaultRedirectUri(req)

    const result = await startMcpOAuthFlow({
      serverUrl,
      clientId,
      clientSecret: body.clientSecret?.trim() || undefined,
      redirectUri,
      scope: body.scope?.trim() || undefined,
    })

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }

    // Stash the PKCE verifier + token URL + resource in the state store
    // so the callback can complete the exchange.
    setOAuthState(result.result.state, {
      userId: user.id,
      provider: `mcp:${serverUrl}`,
      providerName: `MCP — ${serverUrl}`,
      customClientId: clientId,
      customClientSecret: body.clientSecret?.trim(),
      createdAt: Date.now(),
    })

    return NextResponse.json(result.result)
  } catch (err) {
    console.error('[api/mcp/oauth/start] failed:', err)
    return NextResponse.json(
      { error: 'Failed to start MCP OAuth flow' },
      { status: 500 },
    )
  }
}
