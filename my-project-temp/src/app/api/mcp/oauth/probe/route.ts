import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth-helpers'
import { probeMcpAuth } from '@/lib/auth/mcp-oauth-client'

// POST /api/mcp/oauth/probe — probe an MCP server to determine its auth
// requirements (static token vs OAuth 2.1).
//
// Body: { serverUrl: string }
// Returns: { authType, authorizationUrl?, tokenUrl?, resource?, scopesSupported?, error? }
//
// This is the FIRST step in connecting to a remote MCP server. The UI uses
// the result to decide whether to render the static-token form OR the OAuth
// 2.1 flow.

interface ProbeBody {
  serverUrl?: string
}

export async function POST(req: Request) {
  try {
    const user = await getCurrentUser(req)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = (await req.json().catch(() => ({}))) as ProbeBody
    const serverUrl = (body.serverUrl || '').trim()
    if (!serverUrl) {
      return NextResponse.json(
        { error: 'serverUrl is required' },
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

    const result = await probeMcpAuth(serverUrl)
    return NextResponse.json(result)
  } catch (err) {
    console.error('[api/mcp/oauth/probe] failed:', err)
    return NextResponse.json(
      { error: 'Failed to probe MCP server' },
      { status: 500 },
    )
  }
}
