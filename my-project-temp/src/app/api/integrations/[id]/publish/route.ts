import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth-helpers'
import { workspaceIdForUser } from '@/lib/integration-scope'
import { integrationFromRow } from '@/lib/apical-server'

interface RouteCtx {
  params: Promise<{ id: string }>
}

interface PublishBody {
  authorLabel?: string
}

// POST /api/integrations/[id]/publish — contribute a private integration to the
// public community library. Clones the integration with source='public',
// visibility='public', authorLabel provided or 'community'. The original stays
// in your account as your private copy; the clone is the public one others can
// install.
//
// Like adding a custom food to the MyFitnessPal community library.
export async function POST(req: Request, { params }: RouteCtx) {
  try {
    const user = await getCurrentUser(req)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const { id } = await params
    let body: PublishBody = {}
    try {
      body = (await req.json()) as PublishBody
    } catch {
      // Body is optional.
    }
    const authorLabel =
      typeof body.authorLabel === 'string' && body.authorLabel.trim()
        ? body.authorLabel.trim()
        : 'community'

    // You can only publish an instance that belongs to YOUR workspace.
    const wsId = await workspaceIdForUser(user)
    const original = await db.integration.findFirst({
      where: { id, workspaceId: wsId },
    })
    if (!original) {
      return NextResponse.json(
        { error: 'Integration not found in your workspace' },
        { status: 404 },
      )
    }

    // The published copy is a global registry row (workspaceId null).
    const published = await db.integration.create({
      data: {
        workspaceId: null,
        registrySlug: original.registrySlug,
        name: original.name,
        kind: original.kind,
        description: original.description,
        category: original.category,
        color: original.color,
        status: original.status,
        config: original.config,
        tools: original.tools,
        source: 'public',
        visibility: 'public',
        authorLabel,
        installs: 0,
      },
    })

    return NextResponse.json(integrationFromRow(published))
  } catch (err) {
    console.error('[api/integrations/[id]/publish] failed:', err)
    return NextResponse.json(
      { error: 'Failed to publish integration' },
      { status: 500 },
    )
  }
}
