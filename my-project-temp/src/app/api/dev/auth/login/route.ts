import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { db } from '@/lib/db'
import { hashApiKey, DEV_KEY_COOKIE } from '@/lib/dev-auth'

// POST /api/dev/auth/login — log into the SaaS Developer Console with an API key.
//
// Hashes the raw key, looks up the ApiKey (must be active) + its DeveloperAccount
// (must be active). On success, sets an httpOnly cookie with the raw key so the
// console can make authenticated calls without re-sending the key each time.
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { apiKey?: string }
    const raw = typeof body.apiKey === 'string' ? body.apiKey.trim() : ''
    if (!raw) {
      return NextResponse.json(
        { error: 'An API key is required.' },
        { status: 400 },
      )
    }

    const hash = hashApiKey(raw)
    const apiKey = await db.apiKey.findUnique({
      where: { keyHash: hash },
      include: { developer: true },
    })
    if (!apiKey || apiKey.status !== 'active') {
      return NextResponse.json(
        { error: 'Invalid or revoked API key.' },
        { status: 401 },
      )
    }
    if (apiKey.developer.status !== 'active') {
      return NextResponse.json(
        { error: 'This developer account is not active.' },
        { status: 403 },
      )
    }

    // Touch lastUsedAt + lastUsedFrom = web (console login).
    await db.apiKey.update({
      where: { id: apiKey.id },
      data: { lastUsedAt: new Date(), lastUsedFrom: 'web' },
    })

    // Audit log.
    await db.mcpAuditLog.create({
      data: {
        developerId: apiKey.developer.id,
        apiKeyId: apiKey.id,
        action: 'account:login',
        target: apiKey.developer.id,
        success: true,
        costCents: 0,
        detail: 'Console login.',
        source: 'web',
      },
    })

    const c = await cookies()
    c.set(DEV_KEY_COOKIE, raw, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 30, // 30 days
    })

    const dev = apiKey.developer
    return NextResponse.json({
      developer: {
        id: dev.id,
        email: dev.email,
        name: dev.name,
        plan: dev.plan,
        balanceCents: dev.balanceCents,
        workspaceId: dev.workspaceId,
      },
      apiKey: {
        id: apiKey.id,
        label: apiKey.label,
        prefix: apiKey.keyPrefix,
      },
    })
  } catch (err) {
    console.error('[api/dev/auth/login] failed:', err)
    return NextResponse.json(
      { error: 'Failed to log in.' },
      { status: 500 },
    )
  }
}
