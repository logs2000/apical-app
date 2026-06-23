import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-helpers';
import { encrypt, decrypt } from '@/lib/platform/vault';

/**
 * Encrypt + decrypt the session payload using the AES-256-GCM vault. Falls
 * back to base64 of `{}` on decrypt failure so a corrupted row never 500s
 * the list endpoint.
 */
function encryptData(data: unknown): string {
  const json = JSON.stringify(data);
  return encrypt(json);
}

function decryptData(encoded: string): unknown {
  try {
    const json = decrypt(encoded);
    return JSON.parse(json);
  } catch (err) {
    console.error('[integrations/session] decrypt failed:', err);
    return {};
  }
}

/** POST /api/integrations/session — create an integration session */
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser(request);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { serviceSlug, sessionType, credentials, meta } = body;

    // Validate required fields
    if (!serviceSlug || typeof serviceSlug !== 'string') {
      return NextResponse.json(
        { error: 'serviceSlug is required' },
        { status: 400 }
      );
    }

    if (!sessionType || typeof sessionType !== 'string') {
      return NextResponse.json(
        { error: 'sessionType is required (oauth | api_key | credentials | browser_login)' },
        { status: 400 }
      );
    }

    const validSessionTypes = ['oauth', 'api_key', 'credentials', 'browser_login'];
    if (!validSessionTypes.includes(sessionType)) {
      return NextResponse.json(
        { error: `sessionType must be one of: ${validSessionTypes.join(', ')}` },
        { status: 400 }
      );
    }

    if (!credentials || typeof credentials !== 'object') {
      return NextResponse.json(
        { error: 'credentials object is required' },
        { status: 400 }
      );
    }

    // Verify the service exists in the catalog
    const catalogEntry = await db.connectorCatalogEntry.findUnique({
      where: { slug: serviceSlug },
    });
    if (!catalogEntry) {
      return NextResponse.json(
        { error: `Service "${serviceSlug}" not found in connector catalog` },
        { status: 404 }
      );
    }

    const userId = user.id;

    // Encrypt the credentials data (AES-256-GCM via vault).
    const encryptedData = encryptData(credentials);

    // Determine expiry based on session type
    let expiresAt: Date | null = null;
    if (sessionType === 'oauth' && credentials.expires_at) {
      expiresAt = new Date(credentials.expires_at);
    } else if (sessionType === 'api_key') {
      // API keys typically don't expire, but set a 1-year default
      expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    } else if (sessionType === 'credentials' || sessionType === 'browser_login') {
      // Credential/browser sessions expire in 30 days
      expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    }

    // Build metadata
    const metaJson = JSON.stringify({
      ...(meta ?? {}),
      accountName: meta?.accountName ?? serviceSlug,
      scopes: meta?.scopes ?? [],
      serviceKind: catalogEntry.kind,
    });

    const session = await db.integrationSession.create({
      data: {
        userId,
        serviceSlug,
        sessionType,
        encryptedData,
        metaJson,
        status: 'active',
        expiresAt,
        userApproved: true,
        approvedAt: new Date(),
      },
    });

    // Return session without encrypted data (for security)
    return NextResponse.json(
      {
        id: session.id,
        serviceSlug: session.serviceSlug,
        sessionType: session.sessionType,
        metaJson: session.metaJson,
        status: session.status,
        expiresAt: session.expiresAt,
        lastUsedAt: session.lastUsedAt,
        userApproved: session.userApproved,
        approvedAt: session.approvedAt,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('[POST /api/integrations/session] Error:', error);
    return NextResponse.json(
      { error: 'Failed to create integration session' },
      { status: 500 }
    );
  }
}

/** GET /api/integrations/session — list user's integration sessions */
export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser(request);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = user.id;

    // Optional query params for filtering
    const { searchParams } = new URL(request.url);
    const serviceSlug = searchParams.get('serviceSlug');
    const status = searchParams.get('status');

    const where: Record<string, unknown> = { userId };
    if (serviceSlug) where.serviceSlug = serviceSlug;
    if (status) where.status = status;

    const sessions = await db.integrationSession.findMany({
      where,
      select: {
        id: true,
        serviceSlug: true,
        sessionType: true,
        metaJson: true,
        status: true,
        expiresAt: true,
        lastUsedAt: true,
        userApproved: true,
        approvedAt: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json(sessions);
  } catch (error) {
    console.error('[GET /api/integrations/session] Error:', error);
    return NextResponse.json(
      { error: 'Failed to list integration sessions' },
      { status: 500 }
    );
  }
}

// Export encrypt/decrypt helpers for use in the [id] route
export { encryptData, decryptData };
