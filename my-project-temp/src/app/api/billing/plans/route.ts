import { NextResponse } from 'next/server'
import { withUser } from '@/lib/auth-helpers'
import { PLAN_LIST, getBillingStatus, isDemoMode } from '@/lib/platform/billing'

// GET /api/billing/plans — the catalog of plans + the user's current
// subscription status. Used by the pricing page + the settings "Billing"
// card.
//
// Returns:
//   { plans: PlanDefinition[], current: { plan, status }, demoMode: boolean }
export const GET = withUser(async (_req, { user }) => {
  const status = await getBillingStatus(user.id)
  return NextResponse.json({
    plans: PLAN_LIST,
    current: {
      plan: status.subscription.plan,
      status: status.subscription.status,
      periodEnd: status.subscription.currentPeriodEnd,
    },
    demoMode: isDemoMode(),
  })
})
