import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-helpers';
import { workspaceIdForUser } from '@/lib/integration-scope';

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser(request);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const body = await request.json();
    const { connectorSlug } = body;

    if (!connectorSlug || typeof connectorSlug !== 'string') {
      return NextResponse.json(
        { error: 'connectorSlug is required' },
        { status: 400 }
      );
    }

    // Find the catalog entry
    const catalogEntry = await db.connectorCatalogEntry.findUnique({
      where: { slug: connectorSlug },
    });

    if (!catalogEntry) {
      return NextResponse.json(
        { error: `Connector "${connectorSlug}" not found in catalog` },
        { status: 404 }
      );
    }

    if (catalogEntry.status === 'coming_soon') {
      return NextResponse.json(
        { error: `Connector "${connectorSlug}" is not yet available` },
        { status: 400 }
      );
    }

    const wsId = await workspaceIdForUser(user);

    // Check if this connector is already installed in the workspace
    const existing = await db.integration.findFirst({
      where: {
        workspaceId: wsId,
        registrySlug: catalogEntry.slug,
      },
    });

    if (existing) {
      return NextResponse.json(
        { error: 'This connector is already installed', integration: existing },
        { status: 400 }
      );
    }

    // Create a workspace-scoped Integration instance from the catalog entry
    const integration = await db.integration.create({
      data: {
        workspaceId: wsId,
        registrySlug: catalogEntry.slug,
        name: catalogEntry.name,
        kind: catalogEntry.kind,
        description: catalogEntry.description,
        config: catalogEntry.configSchemaJson,
        tools: catalogEntry.toolsJson,
        status: 'connected',
        category: catalogEntry.category,
        color: getCategoryColor(catalogEntry.category),
        source: 'builtin',
        visibility: 'private',
      },
    });

    // Increment the install count on the catalog entry
    await db.connectorCatalogEntry.update({
      where: { slug: connectorSlug },
      data: { installCount: { increment: 1 } },
    });

    return NextResponse.json(integration, { status: 201 });
  } catch (error) {
    console.error('[POST /api/connectors/install] Error:', error);
    return NextResponse.json(
      { error: 'Failed to install connector' },
      { status: 500 }
    );
  }
}

/** Map a category slug to a Tailwind color name for the Integration.color field. */
function getCategoryColor(category: string): string {
  const colorMap: Record<string, string> = {
    email: 'blue',
    files: 'yellow',
    messaging: 'purple',
    finance: 'green',
    documents: 'orange',
    crm: 'red',
    dev: 'gray',
    marketing: 'pink',
    'project-mgmt': 'cyan',
    'e-commerce': 'indigo',
    local: 'emerald',
    general: 'slate',
  };
  return colorMap[category] ?? 'slate';
}
