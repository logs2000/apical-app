import { NextResponse } from 'next/server'
import { withUser } from '@/lib/auth-helpers'
import { createCheckoutSession } from '@/lib/platform/billing'

interface CheckoutBody {
  planId?: string
  interval?: string
}

// POST /api/billing/checkout — kick off a Stripe Checkout (or a demo one).
//
// Body: { planId: 'personal' | 'team' | 'enterprise', interval: 'monthly' | 'yearly' }
//
// Returns: { url, sessionId, demoMode } — the browser should redirect to `url`.
// In demo mode the subscription is upgraded immediately AND the URL is the
// success page, so the user sees the change without a webhook round-trip.
export const POST = withUser(async (req, { user }) => {
  const body = (await req.json().catch(() => ({}))) as CheckoutBody

  const VALID_PLAN_IDS = ['personal', 'team', 'enterprise'] as const
  type PaidPlanId = (typeof VALID_PLAN_IDS)[number]
  const planId = body.planId as PaidPlanId | undefined
  const interval = (body.interval as 'monthly' | 'yearly' | undefined) ?? 'monthly'

  if (!planId || !VALID_PLAN_IDS.includes(planId)) {
    return NextResponse.json(
      { error: "planId must be 'personal', 'team', or 'enterprise'" },
      { status: 400 },
    )
  }
  if (interval !== 'monthly' && interval !== 'yearly') {
    return NextResponse.json(
      { error: "interval must be 'monthly' or 'yearly'" },
      { status: 400 },
    )
  }

  try {
    const result = await createCheckoutSession(user.id, planId, interval)
    return NextResponse.json(result)
  } catch (err) {
    console.error('[api/billing/checkout] failed:', err)
    const msg = err instanceof Error ? err.message : 'Failed to create checkout session'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
})
