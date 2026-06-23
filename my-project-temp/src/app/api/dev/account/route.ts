import { NextResponse } from 'next/server'
import { withDevAuth } from '@/lib/dev-auth'

// GET /api/dev/account — the developer's account.
// Uses cookie auth (console) or bearer auth (REST/MCP).
export const GET = withDevAuth(async (_req, { developer }) => {
  try {
    return NextResponse.json({
      id: developer.id,
      email: developer.email,
      name: developer.name,
      plan: developer.plan,
      balanceCents: developer.balanceCents,
      workspaceId: developer.workspaceId,
      status: developer.status,
      stripeCustomerId: developer.stripeCustomerId,
      createdAt: developer.createdAt.toISOString(),
    })
  } catch (err) {
    console.error('[api/dev/account] GET failed:', err)
    return NextResponse.json(
      { error: 'Failed to load account.' },
      { status: 500 },
    )
  }
})
