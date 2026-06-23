import { NextResponse } from 'next/server'
import { withUser } from '@/lib/auth-helpers'
import { createPortalSession } from '@/lib/platform/billing'

// POST /api/billing/portal — open the Stripe Billing Portal so the user can
// update their card, switch plans, or cancel. In demo mode returns a URL
// the frontend can show as a "demo" landing.
//
// Returns: { url, demoMode }
export const POST = withUser(async (_req, { user }) => {
  try {
    const result = await createPortalSession(user.id)
    return NextResponse.json(result)
  } catch (err) {
    console.error('[api/billing/portal] failed:', err)
    const msg = err instanceof Error ? err.message : 'Failed to create portal session'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
})
