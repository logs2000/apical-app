import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth-helpers'
import { persistMcpStaticToken } from '@/lib/auth/mcp-oauth-client'

// POST /api/mcp/static-token — persist a static token for an MCP server.
//
// Body:
//   {
//     serverUrl: string,         // required
//     token: string,             // required — the API key / PAT / bearer
//     headerName?: string,       // optional — default "Authorization"
//     headerPrefix?: string,     // optional — default "Bearer "
//     label?: string,            // optional — human label
//   }
//
// This is the static-token path of A1 — the majority of MCP servers today
// authenticate with a static API key rather than full OAuth. The token is
// stored in the vault as an `mcp_token` credential.

interface StaticTokenBody {
  serverUrl?: string
  token?: string
  headerName?: string
  headerPrefix?: string
  label?: string
}

export async function POST(req: Request) {
  try {
    const user = await getCurrentUser(req)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = (await req.json().catch(() => ({}))) as StaticTokenBody
    const serverUrl = (body.serverUrl || '').trim()
    const token = (body.token || '').trim()
    if (!serverUrl || !token) {
      return NextResponse.json(
        { error: 'serverUrl and token are required' },
        { status: 400 },
      )
    }

    // Validate URL shape.
    try {
      new URL(serverUrl)
    } catch {
      return NextResponse.json(
        { error: 'serverUrl must be a valid URL' },
        { status: 400 },
      )
    }

    const credentialId = await persistMcpStaticToken({
      userId: user.id,
      serverUrl,
      token,
      headerName: body.headerName,
      headerPrefix: body.headerPrefix,
      label: body.label,
    })

    return NextResponse.json({ ok: true, credentialId })
  } catch (err) {
    console.error('[api/mcp/static-token] failed:', err)
    return NextResponse.json(
      { error: 'Failed to persist MCP static token' },
      { status: 500 },
    )
  }
}
