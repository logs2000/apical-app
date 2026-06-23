import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth-helpers'
import { parseConfig } from '@/lib/apical-server'
import { callMcpTool } from '@/lib/mcp-client'
import type { McpServerConfig } from '@/lib/types'

interface RouteCtx {
  params: Promise<{ id: string }>
}

interface CallBody {
  tool?: string
  args?: Record<string, unknown>
}

// POST /api/mcp/[id]/call — call a tool on a connected MCP integration.
// Body: { tool: string, args?: Record<string, unknown> }
//
// Returns the raw tool result on success (shape: { ok, content, result })
// or `{ error }` with status 400 if the call fails (connection error,
// missing tool name, etc.). 404 if the integration doesn't exist or isn't
// an MCP integration.
export async function POST(req: Request, { params }: RouteCtx) {
  try {
    const user = await getCurrentUser(req)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const { id } = await params
    let body: CallBody = {}
    try {
      body = (await req.json()) as CallBody
    } catch {
      // tolerate empty body
    }
    const toolName = typeof body.tool === 'string' ? body.tool.trim() : ''
    const args =
      body.args && typeof body.args === 'object' && !Array.isArray(body.args)
        ? (body.args as Record<string, unknown>)
        : {}

    if (!toolName) {
      return NextResponse.json(
        { error: 'tool is required' },
        { status: 400 },
      )
    }

    const row = await db.integration.findUnique({ where: { id } })
    if (!row) {
      return NextResponse.json(
        { error: 'Integration not found' },
        { status: 404 },
      )
    }
    if (row.kind !== 'mcp') {
      return NextResponse.json(
        { error: `Integration ${row.name} is not an MCP integration.` },
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

    const result = await callMcpTool(config.mcp, toolName, args)
    if (
      result &&
      typeof result === 'object' &&
      'error' in result &&
      typeof (result as { error?: unknown }).error === 'string'
    ) {
      return NextResponse.json(result, { status: 400 })
    }
    return NextResponse.json(result)
  } catch (err) {
    console.error('[api/mcp/call] failed:', err)
    return NextResponse.json(
      {
        error: `Failed to call MCP tool: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 500 },
    )
  }
}
