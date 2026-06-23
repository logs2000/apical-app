import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth-helpers'
import { integrationFromRow } from '@/lib/apical-server'
import { connectMcpServer } from '@/lib/mcp-client'
import { getDirectoryEntry, buildInstallConfig } from '@/lib/mcp-directory'
import type { ToolDef } from '@/lib/types'

// POST /api/mcp/directory/install — one-click install a curated MCP server.
//
// Body:
//   {
//     slug: string,                    // required — the directory entry slug
//     authValues?: Record<string,string>, // required if entry.requiresAuth
//     name?: string,                   // optional override for the integration name
//   }
//
// Flow:
//   1. Look up the directory entry by slug.
//   2. If requiresAuth, validate that all required authFields are present.
//   3. Build the McpServerConfig from the entry + authValues.
//   4. Call connectMcpServer to verify the connection + discover tools.
//   5. Persist as an Integration (kind='mcp', source='builtin', visibility='private').
//
// Returns `{ integration, tools }` on success or `{ error }` on failure.

interface InstallBody {
  slug?: string
  authValues?: Record<string, string>
  name?: string
}

const COLOR_BY_CATEGORY: Record<string, string> = {
  files: 'emerald',
  dev: 'violet',
  database: 'sky',
  web: 'sky',
  messaging: 'violet',
  productivity: 'amber',
  ai: 'violet',
  media: 'rose',
  cloud: 'sky',
  local: 'emerald',
}

export async function POST(req: Request) {
  try {
    const user = await getCurrentUser(req)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = (await req.json().catch(() => ({}))) as InstallBody
    const slug = (body.slug || '').trim().toLowerCase()
    if (!slug) {
      return NextResponse.json(
        { error: 'slug is required' },
        { status: 400 },
      )
    }

    const entry = getDirectoryEntry(slug)
    if (!entry) {
      return NextResponse.json(
        { error: `Unknown MCP server: ${slug}` },
        { status: 404 },
      )
    }

    // Validate required auth fields.
    const authValues = body.authValues || {}
    if (entry.requiresAuth) {
      const missing: string[] = []
      for (const field of entry.authFields || []) {
        if (field.required && !(authValues[field.key] || '').trim()) {
          missing.push(field.label)
        }
      }
      if (missing.length > 0) {
        return NextResponse.json(
          { error: `Missing required fields: ${missing.join(', ')}` },
          { status: 400 },
        )
      }
    }

    // Build the McpServerConfig from the entry + authValues.
    const config = buildInstallConfig(entry, authValues)

    // Verify the connection + discover tools.
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

    const integrationName = (body.name || entry.name).trim()
    const integrationConfig = { mcp: config, directorySlug: slug }

    const created = await db.integration.create({
      data: {
        name: integrationName,
        kind: 'mcp',
        description: `${entry.shortDesc} — ${entry.description}`,
        category: entry.category,
        color: COLOR_BY_CATEGORY[entry.category] || 'violet',
        status: 'connected',
        config: JSON.stringify(integrationConfig),
        tools: '[]',
        source: 'builtin',
        visibility: 'private',
        authorLabel: null,
        installs: 0,
      },
    })

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
      directoryEntry: {
        slug: entry.slug,
        name: entry.name,
        icon: entry.icon,
      },
    })
  } catch (err) {
    console.error('[api/mcp/directory/install] failed:', err)
    return NextResponse.json(
      {
        error: `Failed to install: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 500 },
    )
  }
}
