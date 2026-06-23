import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth-helpers'
import { searchDirectory, MCP_DIRECTORY } from '@/lib/mcp-directory'

// GET /api/mcp/directory — list the curated MCP server directory.
//
// Query params:
//   - q:      search query (matches name, description, tags)
//   - category: filter by category (files | dev | database | web | ...)
//
// Returns the matching entries sorted by popularity (desc). Auth required so
// anonymous traffic can't enumerate the catalog (the catalog itself is public
// info — the auth gate is just a lightweight abuse shield).

const VALID_CATEGORIES = new Set([
  'files',
  'dev',
  'database',
  'web',
  'messaging',
  'productivity',
  'ai',
  'media',
  'cloud',
  'local',
])

export async function GET(req: Request) {
  try {
    const user = await getCurrentUser(req)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const url = new URL(req.url)
    const q = url.searchParams.get('q') || ''
    const category = url.searchParams.get('category') || ''
    const validCategory = VALID_CATEGORIES.has(category) ? category : undefined

    const entries = searchDirectory(q, validCategory)
    return NextResponse.json({
      total: MCP_DIRECTORY.length,
      returned: entries.length,
      entries,
    })
  } catch (err) {
    console.error('[api/mcp/directory] GET failed:', err)
    return NextResponse.json(
      { error: 'Failed to load MCP directory' },
      { status: 500 },
    )
  }
}
