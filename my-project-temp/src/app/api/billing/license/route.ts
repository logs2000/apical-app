import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withUser } from '@/lib/auth-helpers'
import { issueLicenseToken, type LicensePayload } from '@/lib/desktop/license'

/**
 * POST /api/billing/license — issue an enterprise license token (download).
 * Requires Subscription.plan === 'enterprise'.
 */
export const POST = withUser(async (_req, { user }) => {
  const sub = await db.subscription.findUnique({
    where: { userId: user.id },
    select: { plan: true, status: true, seats: true, currentPeriodEnd: true },
  })

  if (!sub || sub.plan !== 'enterprise' || sub.status === 'canceled') {
    return NextResponse.json(
      { error: 'Enterprise subscription required to issue a license.' },
      { status: 403 },
    )
  }

  const expiresAt =
    sub.currentPeriodEnd?.toISOString() ??
    new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()

  const payload: LicensePayload = {
    org: user.email ?? user.id,
    plan: 'enterprise',
    seats: sub.seats || 1,
    features: ['local_only'],
    expiresAt,
  }

  const token = issueLicenseToken(payload)
  if (!token) {
    return NextResponse.json(
      {
        error:
          'License signing is not configured on this server (APICAL_LICENSE_PRIVATE_KEY_PEM).',
      },
      { status: 503 },
    )
  }

  return NextResponse.json({ ok: true, license: token, payload })
})
