import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth-helpers'
import { workspaceIdForUser } from '@/lib/integration-scope'
import { integrationFromRow } from '@/lib/apical-server'

interface RouteCtx {
  params: Promise<{ id: string }>
}

// POST /api/integrations/[id]/install — install a registry integration into
// your workspace. Clones the registry row as a workspace instance (new id,
// source='private', visibility='private'), keeps its tools/config intact, and
// increments the original's `installs` count.
export async function POST(_req: Request, { params }: RouteCtx) {
  try {
    const user = await getCurrentUser(_req)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const { id } = await params
    const wsId = await workspaceIdForUser(user)

    // Only global registry rows are installable (not other workspaces' instances).
    const original = await db.integration.findFirst({
      where: { id, workspaceId: null },
    })
    if (!original) {
      return NextResponse.json(
        { error: 'Integration not found' },
        { status: 404 },
      )
    }

    // Clone with a fresh id; tools keep their ids (they're namespaced like
    // "notion.queryDatabase" so a duplicate id in the workspace is fine
    // — one copy is installed per source integration).
    const cloned = await db.integration.create({
      data: {
        workspaceId: wsId,
        registrySlug: original.registrySlug,
        name: original.name,
        kind: original.kind,
        description: original.description,
        category: original.category,
        color: original.color,
        status: original.status,
        config: original.config,
        tools: original.tools,
        source: 'private',
        visibility: 'private',
        authorLabel: null,
        installs: 0,
      },
    })

    // Bump the original's installs (atomically).
    await db.integration.update({
      where: { id: original.id },
      data: { installs: { increment: 1 } },
    })

    return NextResponse.json(integrationFromRow(cloned))
  } catch (err) {
    console.error('[api/integrations/[id]/install] failed:', err)
    return NextResponse.json(
      { error: 'Failed to install integration' },
      { status: 500 },
    )
  }
}
