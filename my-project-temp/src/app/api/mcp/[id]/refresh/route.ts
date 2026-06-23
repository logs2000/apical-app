import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth-helpers'
import { integrationFromRow, parseConfig } from '@/lib/apical-server'
import { connectMcpServer } from '@/lib/mcp-client'
import type { McpServerConfig, ToolDef } from '@/lib/types'

interface RouteCtx {
  params: Promise<{ id: string }>
}

// POST /api/mcp/[id]/refresh — re-discover tools on an existing MCP
// integration. Rebuilds the connection from the stored `config.mcp`,
// calls listTools(), and writes the fresh tool list back to the row.
//
// Returns `{ integration }` (with the updated tools). 400 if the connection
// fails (so the UI can show the error). 404 if the integration doesn't exist
// or isn't an MCP integration.
export async function POST(req: Request, { params }: RouteCtx) {
  try {
    const user = await getCurrentUser(req)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const { id } = await params

    const row = await db.integration.findUnique({ where: { id } })
    if (!row) {
      return NextResponse.json(
        { error: 'Integration not found' },
        { status: 404 },
      )
    }
    if (row.kind !== 'mcp') {
      return NextResponse.json(
        { error: `Integration ${row.name} is not an MCP integration (kind=${row.kind}).` },
        { status: 400 },
      )
    }

    const config = parseConfig<{ mcp?: McpServerConfig }>(row.config, {})
    if (!config.mcp) {
      return NextResponse.json(
        { error: 'Integration config has no `mcp` block — cannot reconnect.' },
        { status: 400 },
      )
    }

    const discovered = await connectMcpServer(config.mcp)
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

    const tools: ToolDef[] = discovered.tools.map((t) => ({
      ...t,
      integrationId: row.id,
    }))
    const updated = await db.integration.update({
      where: { id: row.id },
      data: {
        tools: JSON.stringify(tools),
        status: 'connected',
        updatedAt: new Date(),
      },
    })

    return NextResponse.json({ integration: integrationFromRow(updated) })
  } catch (err) {
    console.error('[api/mcp/refresh] failed:', err)
    return NextResponse.json(
      {
        error: `Failed to refresh: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 500 },
    )
  }
}
