import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withDevAuth } from '@/lib/dev-auth'

interface RouteCtx {
  params: Promise<{ id: string }>
}

// DELETE /api/dev/keys/[id] — revoke an API key.
// Sets status='revoked' (does NOT delete — we keep the row for audit history).
// The key can no longer authenticate any request after this.
export const DELETE = withDevAuth(async (_req, { developer, params }) => {
  try {
    const { id } = params

    // Make sure the key belongs to THIS developer.
    const existing = await db.apiKey.findUnique({ where: { id } })
    if (!existing || existing.developerId !== developer.id) {
      return NextResponse.json(
        { error: 'API key not found.' },
        { status: 404 },
      )
    }

    await db.apiKey.update({
      where: { id },
      data: { status: 'revoked' },
    })

    await db.mcpAuditLog.create({
      data: {
        developerId: developer.id,
        apiKeyId: id,
        action: 'key:revoke',
        target: id,
        success: true,
        costCents: 0,
        detail: `Revoked API key "${existing.label}" (${existing.keyPrefix}…).`,
        source: 'web',
      },
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[api/dev/keys/[id]] DELETE failed:', err)
    return NextResponse.json(
      { error: 'Failed to revoke API key.' },
      { status: 500 },
    )
  }
})
