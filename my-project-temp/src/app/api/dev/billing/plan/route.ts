import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withDevAuth } from '@/lib/dev-auth'

const VALID_PLANS = new Set(['free', 'starter', 'pro', 'scale'])

// POST /api/dev/billing/plan — change the developer's plan.
// Body: { plan: 'free'|'starter'|'pro'|'scale' }. Returns the updated account.
export const POST = withDevAuth(async (req, { developer }) => {
  try {
    const body = (await req.json().catch(() => ({}))) as { plan?: string }
    const plan = typeof body.plan === 'string' ? body.plan.trim().toLowerCase() : ''
    if (!VALID_PLANS.has(plan)) {
      return NextResponse.json(
        { error: "plan must be one of: 'free', 'starter', 'pro', 'scale'." },
        { status: 400 },
      )
    }

    const updated = await db.developerAccount.update({
      where: { id: developer.id },
      data: { plan },
    })

    await db.mcpAuditLog.create({
      data: {
        developerId: developer.id,
        apiKeyId: null,
        action: 'billing:plan',
        target: developer.id,
        success: true,
        costCents: 0,
        detail: `Plan changed from ${developer.plan} → ${plan}.`,
        source: 'web',
      },
    })

    return NextResponse.json({
      id: updated.id,
      email: updated.email,
      name: updated.name,
      plan: updated.plan,
      balanceCents: updated.balanceCents,
      workspaceId: updated.workspaceId,
      status: updated.status,
      stripeCustomerId: updated.stripeCustomerId,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    })
  } catch (err) {
    console.error('[api/dev/billing/plan] POST failed:', err)
    return NextResponse.json(
      { error: 'Failed to change plan.' },
      { status: 500 },
    )
  }
})
