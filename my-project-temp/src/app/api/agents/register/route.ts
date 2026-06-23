import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import crypto from 'crypto';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, description, type, capabilities, callbackUrl } = body;

    // Validate required fields
    if (!name || typeof name !== 'string') {
      return NextResponse.json(
        { error: 'name is required' },
        { status: 400 }
      );
    }

    if (!type || typeof type !== 'string') {
      return NextResponse.json(
        { error: 'type is required (llm | workflow | mcp_server | custom)' },
        { status: 400 }
      );
    }

    const validTypes = ['llm', 'workflow', 'mcp_server', 'custom'];
    if (!validTypes.includes(type)) {
      return NextResponse.json(
        { error: `type must be one of: ${validTypes.join(', ')}` },
        { status: 400 }
      );
    }

    // TODO: Get userId from authenticated session
    // const session = await getServerSession(authOptions);
    // const userId = session?.user?.id;
    const userId = null; // Allow anonymous agent registration for now

    // Create the agent registration
    const agent = await db.agentRegistration.create({
      data: {
        userId,
        name,
        description: description ?? '',
        type,
        capabilitiesJson: JSON.stringify(capabilities ?? []),
        callbackUrl: callbackUrl ?? null,
        status: 'active',
      },
    });

    // Generate an API key (apk_ + 32-char hex)
    const rawKey = `apk_${crypto.randomBytes(32).toString('hex')}`;
    const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
    const keyPrefix = rawKey.substring(0, 12); // e.g. "apk_a1b2c3d4..."

    const apiKey = await db.agentApiKey.create({
      data: {
        agentId: agent.id,
        label: 'Default',
        keyHash,
        keyPrefix,
        scopesJson: JSON.stringify([
          'credentials.read',
          'credentials.use',
          'api.call',
        ]),
        status: 'active',
      },
    });

    // Return agent + the raw API key (shown only once)
    return NextResponse.json(
      {
        agent: {
          id: agent.id,
          name: agent.name,
          description: agent.description,
          type: agent.type,
          capabilitiesJson: agent.capabilitiesJson,
          callbackUrl: agent.callbackUrl,
          status: agent.status,
          createdAt: agent.createdAt,
        },
        apiKey: {
          id: apiKey.id,
          label: apiKey.label,
          keyPrefix: apiKey.keyPrefix,
          scopesJson: apiKey.scopesJson,
          // The raw key is shown only once — never stored in plaintext
          rawKey,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('[POST /api/agents/register] Error:', error);
    return NextResponse.json(
      { error: 'Failed to register agent' },
      { status: 500 }
    );
  }
}
