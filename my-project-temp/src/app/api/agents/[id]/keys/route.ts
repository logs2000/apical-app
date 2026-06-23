import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-helpers';
import crypto from 'crypto';

interface RouteContext {
  params: Promise<{ id: string }>;
}

async function requireAgentOwnership(req: NextRequest, id: string): Promise<NextResponse | null> {
  const user = await getCurrentUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const agent = await db.agentRegistration.findUnique({
    where: { id },
    select: { id: true, userId: true },
  });
  if (!agent || agent.userId !== user.id) {
    return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
  }
  return null;
}

/** GET /api/agents/[id]/keys — list an agent's API keys */
export async function GET(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const { id } = await context.params;

    const guard = await requireAgentOwnership(request, id);
    if (guard) return guard;

    const keys = await db.agentApiKey.findMany({
      where: { agentId: id },
      select: {
        id: true,
        label: true,
        keyPrefix: true,
        scopesJson: true,
        rateLimitRpm: true,
        status: true,
        lastUsedAt: true,
        expiresAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json(keys);
  } catch (error) {
    console.error('[GET /api/agents/[id]/keys] Error:', error);
    return NextResponse.json(
      { error: 'Failed to list API keys' },
      { status: 500 }
    );
  }
}

/** POST /api/agents/[id]/keys — create a new API key for an agent */
export async function POST(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const { id } = await context.params;

    const guard = await requireAgentOwnership(request, id);
    if (guard) return guard;

    const body = await request.json();
    const { label, scopes } = body;

    // Generate a new API key: apk_ + 32-char hex
    const rawKey = `apk_${crypto.randomBytes(32).toString('hex')}`;
    const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
    const keyPrefix = rawKey.substring(0, 12);

    const apiKey = await db.agentApiKey.create({
      data: {
        agentId: id,
        label: label ?? 'New Key',
        keyHash,
        keyPrefix,
        scopesJson: JSON.stringify(scopes ?? ['credentials.read', 'credentials.use', 'api.call']),
        status: 'active',
      },
    });

    // Return the key record + raw key (shown only once)
    return NextResponse.json(
      {
        id: apiKey.id,
        label: apiKey.label,
        keyPrefix: apiKey.keyPrefix,
        scopesJson: apiKey.scopesJson,
        status: apiKey.status,
        createdAt: apiKey.createdAt,
        // The raw key is returned only at creation time
        rawKey,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('[POST /api/agents/[id]/keys] Error:', error);
    return NextResponse.json(
      { error: 'Failed to create API key' },
      { status: 500 }
    );
  }
}
