import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { integrationFromRow } from '@/lib/apical-server'

interface RouteCtx {
  params: Promise<{ id: string }>
}

// POST /api/integrations/[id]/install — install a public library integration
// into your account. Clones the public integration as a private one (new id,
// source='private', visibility='private'), keeps its tools/config intact, and
// increments the original's `installs` count.
//
// Like adding a food from the MyFitnessPal community library to your diary.
export async function POST(_req: Request, { params }: RouteCtx) {
  try {
    const { id } = await params

    const original = await db.integration.findUnique({ where: { id } })
    if (!original) {
      return NextResponse.json(
        { error: 'Integration not found' },
        { status: 404 },
      )
    }

    // Clone with a fresh id; tools keep their ids (they're namespaced like
    // "notion.queryDatabase" so a duplicate id in the user's account is fine
    // — they install one copy per source integration).
    const cloned = await db.integration.create({
      data: {
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
