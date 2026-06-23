import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-helpers';
import { encrypt, decrypt } from '@/lib/platform/vault';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * Encrypt + decrypt the session payload using the AES-256-GCM vault. Mirrors
 * the helpers in ./route.ts (kept local so this file stays standalone).
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
    console.error('[integrations/session/[id]] decrypt failed:', err);
    return {};
  }
}

/** GET /api/integrations/session/[id] — get a specific integration session */
export async function GET(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const user = await getCurrentUser(request);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await context.params;

    const session = await db.integrationSession.findUnique({
      where: { id },
    });

    if (!session || session.userId !== user.id) {
      return NextResponse.json(
        { error: 'Integration session not found' },
        { status: 404 }
      );
    }

    // Return session data (decrypted credentials included for authorized consumers)
    const decryptedCredentials = decryptData(session.encryptedData);

    return NextResponse.json({
      id: session.id,
      userId: session.userId,
      serviceSlug: session.serviceSlug,
      sessionType: session.sessionType,
      credentials: decryptedCredentials,
      metaJson: session.metaJson,
      status: session.status,
      expiresAt: session.expiresAt,
      lastUsedAt: session.lastUsedAt,
      userApproved: session.userApproved,
      approvedAt: session.approvedAt,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    });
  } catch (error) {
    console.error('[GET /api/integrations/session/[id]] Error:', error);
    return NextResponse.json(
      { error: 'Failed to get integration session' },
      { status: 500 }
    );
  }
}

/** DELETE /api/integrations/session/[id] — revoke an integration session */
export async function DELETE(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const user = await getCurrentUser(request);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await context.params;

    const session = await db.integrationSession.findUnique({
      where: { id },
    });

    if (!session || session.userId !== user.id) {
      return NextResponse.json(
        { error: 'Integration session not found' },
        { status: 404 }
      );
    }

    if (session.status === 'revoked') {
      return NextResponse.json(
        { error: 'Session is already revoked' },
        { status: 400 }
      );
    }

    const updated = await db.integrationSession.update({
      where: { id },
      data: {
        status: 'revoked',
        updatedAt: new Date(),
      },
    });

    return NextResponse.json({
      id: updated.id,
      serviceSlug: updated.serviceSlug,
      status: updated.status,
      message: 'Session revoked successfully',
    });
  } catch (error) {
    console.error('[DELETE /api/integrations/session/[id]] Error:', error);
    return NextResponse.json(
      { error: 'Failed to revoke integration session' },
      { status: 500 }
    );
  }
}

/** PATCH /api/integrations/session/[id] — update/refresh an integration session */
export async function PATCH(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const user = await getCurrentUser(request);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await context.params;

    const session = await db.integrationSession.findUnique({
      where: { id },
    });

    if (!session || session.userId !== user.id) {
      return NextResponse.json(
        { error: 'Integration session not found' },
        { status: 404 }
      );
    }

    if (session.status === 'revoked') {
      return NextResponse.json(
        { error: 'Cannot update a revoked session' },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { credentials, meta, status: newStatus } = body;

    const updateData: Record<string, unknown> = {
      updatedAt: new Date(),
      lastUsedAt: new Date(),
    };

    // Update credentials if provided (re-encrypt via vault)
    if (credentials && typeof credentials === 'object') {
      updateData.encryptedData = encryptData(credentials);
    }

    // Update metadata if provided
    if (meta && typeof meta === 'object') {
      const existingMeta = JSON.parse(session.metaJson as string || '{}');
      updateData.metaJson = JSON.stringify({ ...existingMeta, ...meta });
    }

    // Update status if provided (e.g., "active" -> "expired", or refresh tokens: "expired" -> "active")
    if (newStatus && typeof newStatus === 'string') {
      const validStatuses = ['active', 'expired', 'failed'];
      if (!validStatuses.includes(newStatus)) {
        return NextResponse.json(
          { error: `status must be one of: ${validStatuses.join(', ')}` },
          { status: 400 }
        );
      }
      updateData.status = newStatus;
    }

    // If refreshing (credentials provided and setting back to active), extend expiry
    if (credentials && newStatus === 'active') {
      const extensionMs = session.sessionType === 'oauth'
        ? 60 * 60 * 1000 // 1 hour for OAuth tokens
        : session.sessionType === 'api_key'
          ? 365 * 24 * 60 * 60 * 1000 // 1 year for API keys
          : 30 * 24 * 60 * 60 * 1000; // 30 days for credentials/browser_login
      updateData.expiresAt = new Date(Date.now() + extensionMs);
    }

    const updated = await db.integrationSession.update({
      where: { id },
      data: updateData,
    });

    return NextResponse.json({
      id: updated.id,
      serviceSlug: updated.serviceSlug,
      sessionType: updated.sessionType,
      metaJson: updated.metaJson,
      status: updated.status,
      expiresAt: updated.expiresAt,
      lastUsedAt: updated.lastUsedAt,
      userApproved: updated.userApproved,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    });
  } catch (error) {
    console.error('[PATCH /api/integrations/session/[id]] Error:', error);
    return NextResponse.json(
      { error: 'Failed to update integration session' },
      { status: 500 }
    );
  }
}
