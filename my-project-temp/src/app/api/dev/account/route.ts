import { NextResponse } from 'next/server'
import { withDevAuth } from '@/lib/dev-auth'

// GET /api/dev/account — the developer's workspace account.
// Uses cookie auth (console) or bearer auth (REST/MCP).
export const GET = withDevAuth(async (_req, { workspace }) => {
  try {
    return NextResponse.json({
      id: workspace.id,
      email: workspace.billingEmail,
      name: workspace.name,
      plan: workspace.plan,
      balanceCents: workspace.balanceCents,
      workspaceId: workspace.id,
      status: workspace.status,
      stripeCustomerId: workspace.stripeCustomerId,
      createdAt: workspace.createdAt.toISOString(),
    })
  } catch (err) {
    console.error('[api/dev/account] GET failed:', err)
    return NextResponse.json(
      { error: 'Failed to load account.' },
      { status: 500 },
    )
  }
})
