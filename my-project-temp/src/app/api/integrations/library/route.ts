import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { integrationFromRow } from '@/lib/apical-server'
import type { Integration, IntegrationSource } from '@/lib/types'

// GET /api/integrations/library?source=public|private|builtin
//
// Returns integrations filtered by source. `?source=public` returns the
// community library (sorted by installs desc — most popular first). `?source=private`
// returns the user's own private ones. No filter returns everything.
//
// Powers the developer-mode integration library browser.
export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const sourceParam = url.searchParams.get('source')

    const validSources: IntegrationSource[] = ['builtin', 'private', 'public']
    const where =
      sourceParam && validSources.includes(sourceParam as IntegrationSource)
        ? { source: sourceParam }
        : {}

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
