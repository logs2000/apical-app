import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** POST /api/agents/[id]/connect — request a connection between an agent and a user's service */
export async function POST(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const { id } = await context.params;

    // Verify agent exists
    const agent = await db.agentRegistration.findUnique({
      where: { id },
    });
    if (!agent) {
      return NextResponse.json(
        { error: 'Agent not found' },
        { status: 404 }
      );
    }

    const body = await request.json();
    const { serviceKey, scopes } = body;

    if (!serviceKey || typeof serviceKey !== 'string') {
      return NextResponse.json(
        { error: 'serviceKey is required' },
        { status: 400 }
      );
    }

    // Verify the service exists in the catalog
    const catalogEntry = await db.connectorCatalogEntry.findUnique({
      where: { slug: serviceKey },
    });
    if (!catalogEntry) {
      return NextResponse.json(
        { error: `Service "${serviceKey}" not found in connector catalog` },
        { status: 404 }
      );
    }

    // TODO: Get userId from authenticated session
    // const session = await getServerSession(authOptions);
    // const userId = session?.user?.id;
    const userId = 'system';

    // Check if a connection already exists
    const existing = await db.agentConnection.findUnique({
      where: {
        agentId_userId_serviceKey: {
          agentId: id,
          userId,
          serviceKey,
        },
      },
    });

    if (existing) {
      // If the existing connection is revoked, re-activate it
      if (existing.status === 'revoked') {
        const reactivated = await db.agentConnection.update({
          where: { id: existing.id },
          data: {
            status: 'pending',
            approvedScopesJson: JSON.stringify(scopes ?? []),
            approved: false,
            approvedAt: null,
          },
        });
        return NextResponse.json(reactivated);
      }

      return NextResponse.json(
        { error: 'Connection already exists for this agent/service combination', connection: existing },
        { status: 400 }
      );
    }

    // Create a new connection with status "pending"
    const connection = await db.agentConnection.create({
      data: {
        agentId: id,
        userId,
        serviceKey,
        approvedScopesJson: JSON.stringify(scopes ?? []),
        approved: false,
        status: 'pending',
      },
    });

    return NextResponse.json(connection, { status: 201 });
  } catch (error) {
    console.error('[POST /api/agents/[id]/connect] Error:', error);
    return NextResponse.json(
      { error: 'Failed to create agent connection' },
      { status: 500 }
    );
  }
}
