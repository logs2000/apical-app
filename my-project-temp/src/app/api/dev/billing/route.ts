import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withDevAuth } from '@/lib/dev-auth'

// GET /api/dev/billing — billing summary.
// { plan, balanceCents, stripeCustomerId, recentCharges: McpAuditLog[] (costCents>0, last 10) }
export const GET = withDevAuth(async (_req, { developer }) => {
  try {
    const recentCharges = await db.mcpAuditLog.findMany({
      where: {
        developerId: developer.id,
        costCents: { gt: 0 },
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    })

    return NextResponse.json({
      plan: developer.plan,
      balanceCents: developer.balanceCents,
      stripeCustomerId: developer.stripeCustomerId,
      recentCharges: recentCharges.map((l) => ({
        id: l.id,
        action: l.action,
        target: l.target,
        success: l.success,
        costCents: l.costCents,
        detail: l.detail,
        source: l.source,
        createdAt: l.createdAt.toISOString(),
      })),
    })
  } catch (err) {
    console.error('[api/dev/billing] GET failed:', err)
    return NextResponse.json(
      { error: 'Failed to load billing summary.' },
      { status: 500 },
    )
  }
})
