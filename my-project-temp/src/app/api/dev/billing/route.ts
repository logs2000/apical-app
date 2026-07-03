import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withDevAuth } from '@/lib/dev-auth'

// GET /api/dev/billing — billing summary.
// { plan, balanceCents, stripeCustomerId, recentCharges: McpAuditLog[] (costCents>0, last 10) }
export const GET = withDevAuth(async (_req, { workspace }) => {
  try {
    const recentCharges = await db.mcpAuditLog.findMany({
      where: {
        workspaceId: workspace.id,
        costCents: { gt: 0 },
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    })

    return NextResponse.json({
      plan: workspace.plan,
      balanceCents: workspace.balanceCents,
      stripeCustomerId: workspace.stripeCustomerId,
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
