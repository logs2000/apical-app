import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth-helpers'
import { integrationVisibleWhere, workspaceIdForUser } from '@/lib/integration-scope'
import { integrationFromRow } from '@/lib/apical-server'
import type { Integration, IntegrationSource } from '@/lib/types'

// GET /api/integrations/library?source=public|private|builtin
//
// Returns integrations filtered by source. `?source=public` returns the
// community library (sorted by installs desc — most popular first). `?source=private`
// returns the caller workspace's own instances. No filter returns everything
// visible to the workspace (own instances + global registry rows).
//
// Powers the developer-mode integration library browser.
export async function GET(req: Request) {
  try {
    const user = await getCurrentUser(req)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const wsId = await workspaceIdForUser(user)
    const url = new URL(req.url)
    const sourceParam = url.searchParams.get('source')

    const validSources: IntegrationSource[] = ['builtin', 'private', 'public']
    const where = {
      ...integrationVisibleWhere(wsId),
      ...(sourceParam && validSources.includes(sourceParam as IntegrationSource)
        ? { source: sourceParam }
        : {}),
    }

    const orderBy =
      sourceParam === 'public'
        ? [{ installs: 'desc' as const }, { name: 'asc' as const }]
        : [{ category: 'asc' as const }, { name: 'asc' as const }]

    const rows = await db.integration.findMany({ where, orderBy })
    const integrations: Integration[] = rows.map((r) => integrationFromRow(r))
    return NextResponse.json(integrations)
  } catch (err) {
    console.error('[api/integrations/library] failed:', err)
    return NextResponse.json(
      { error: 'Failed to load integration library' },
      { status: 500 },
    )
  }
}
