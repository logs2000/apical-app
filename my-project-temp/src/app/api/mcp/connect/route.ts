import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { integrationFromRow } from '@/lib/apical-server'
import { connectMcpServer } from '@/lib/mcp-client'
import type { McpServerConfig, ToolDef } from '@/lib/types'

interface ConnectBody {
  name?: string
  transport?: 'stdio' | 'http' | 'sse'
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  /** Custom HTTP headers for http / sse transports (Bearer tokens, etc.). */
  headers?: Record<string, string>
  /** Bearer token shorthand for http / sse. */
  bearerToken?: string
  category?: string
  description?: string
}

const COLOR_BY_CATEGORY: Record<string, string> = {
  files: 'emerald',
  email: 'rose',
  messaging: 'violet',
  finance: 'emerald',
  documents: 'amber',
  database: 'sky',
  general: 'violet',
}

// POST /api/mcp/connect — connect to an MCP server, discover its tools,
// and save the result as an Integration (kind='mcp', source='private',
// visibility='private', config.mcp carries the transport details).
//
// Supports all three transports:
//   - stdio: spawn a local process (command + args + env).
//   - http:  Streamable HTTP (modern remote MCP).
//   - sse:   Legacy SSE (older remote MCP servers).
//
// For http + sse, the caller may include `headers` (a Record<string,string>)
// and/or `bearerToken` for authenticated remote MCP servers. The headers are
// stored in the Integration config — make sure your config storage is
// encrypted at rest if you store secrets here (Apical's vault covers
// Credential rows, but Integration.config is plaintext in the current schema).
//
// Returns `{ integration, tools }` on success or `{ error }` with status 400
// when the server can't be reached (so the UI can show the error message).
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as ConnectBody
    const name = (body.name || '').trim()
    const transport =
      body.transport === 'http' || body.transport === 'sse'
        ? body.transport
        : 'stdio'
    if (!name) {
      return NextResponse.json(
        { error: 'name is required' },
        { status: 400 },
      )
    }

    // Build the McpServerConfig from the request body. Each transport has its
    // own required fields; we validate below.
    const config: McpServerConfig =
      transport === 'stdio'
        ? {
            transport: 'stdio',
            command: body.command,
            args: Array.isArray(body.args) ? body.args : undefined,
            env: body.env && typeof body.env === 'object' ? body.env : undefined,
          }
        : {
            transport,
            url: body.url,
            headers:
              body.headers && typeof body.headers === 'object'
                ? body.headers
                : undefined,
            bearerToken: body.bearerToken?.trim() || undefined,
          }

    // Validate required fields per transport.
    if (transport === 'stdio' && !config.command) {
      return NextResponse.json(
        { error: 'stdio transport requires a "command".' },
        { status: 400 },
      )
    }
    if ((transport === 'http' || transport === 'sse') && !config.url) {
      return NextResponse.json(
        { error: `${transport} transport requires a "url".` },
        { status: 400 },
      )
    }

    const discovered = await connectMcpServer(config)
    if (discovered.error || discovered.tools.length === 0) {
      return NextResponse.json(
        {
          error:
            discovered.error ||
            'Connected to the MCP server but no tools were discovered.',
        },
        { status: 400 },
      )
    }

    // Build the integration config: stash the MCP server config so refresh/call
    // can rebuild the connection later.
    // NOTE: if the config contains a bearerToken or secret headers, callers
    // should consider encrypting the config string before persisting. We
    // store as-is for now (matches the existing pattern for non-MCP configs).
    const integrationConfig = {
      mcp: config,
    }

    const category = body.category || 'general'
    const created = await db.integration.create({
      data: {
        name,
        kind: 'mcp',
        description:
          body.description ||
          `MCP server (${transport}) connected on ${new Date().toISOString().slice(0, 10)}.`,
        category,
        color: COLOR_BY_CATEGORY[category] || 'violet',
        status: 'connected',
        config: JSON.stringify(integrationConfig),
        tools: '[]',
        source: 'private',
        visibility: 'private',
        authorLabel: null,
        installs: 0,
      },
    })

    // Stamp the discovered tools with the new integration id.
    const tools: ToolDef[] = discovered.tools.map((t) => ({
      ...t,
      integrationId: created.id,
    }))
    const updated = await db.integration.update({
      where: { id: created.id },
      data: { tools: JSON.stringify(tools) },
    })

    return NextResponse.json({
      integration: integrationFromRow(updated),
      tools,
    })
  } catch (err) {
    console.error('[api/mcp/connect] failed:', err)
    return NextResponse.json(
      {
        error: `Failed to connect: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 500 },
    )
  }
}
