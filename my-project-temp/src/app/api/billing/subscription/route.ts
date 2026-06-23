import { NextResponse } from 'next/server'
import { withUser } from '@/lib/auth-helpers'
import { getBillingStatus } from '@/lib/platform/billing'

// GET /api/billing/subscription — the full billing status: subscription row,
// resolved PlanDefinition, computed usage, overrun availability, demo mode.
// Powers the settings "Billing" card + the pricing page CTA.
export const GET = withUser(async (_req, { user }) => {
  const status = await getBillingStatus(user.id)
  return NextResponse.json(status)
})
