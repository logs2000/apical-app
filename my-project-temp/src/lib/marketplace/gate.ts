// Apical — API provider marketplace (BUILT BUT NOT ENABLED).
//
// The marketplace is the monetization layer: providers list their APIs, agents
// pay per-call via Stripe, Apical takes a revenue cut. The model
// (ApiProvider) exists in the Prisma schema but the routes are gated behind
// the `APICAL_MARKETPLACE_ENABLED` env var, which defaults to `false`.
//
// When disabled, every route returns 503 with `{ error: 'marketplace_not_enabled' }`.
// When enabled (set `APICAL_MARKETPLACE_ENABLED=true` in .env), the routes
// become fully functional:
//   - GET    /api/marketplace/providers              — list public providers
//   - POST   /api/marketplace/providers              — create a new listing (auth)
//   - GET    /api/marketplace/providers/[id]         — get one provider
//   - PATCH  /api/marketplace/providers/[id]         — update (owner only)
//   - DELETE /api/marketplace/providers/[id]         — delist (owner only)
//   - POST   /api/marketplace/providers/[id]/call    — proxy a call (tracks usage)
//
// Usage tracking + Stripe payouts are stubbed: `totalCalls` and
// `totalRevenueCents` are incremented on each call, but no real Stripe charge
// is created. That's the next phase: integrate Stripe Connect for the
// revenue split.

import { NextResponse } from 'next/server'

const MARKETPLACE_ENABLED =
  (process.env.APICAL_MARKETPLACE_ENABLED || '').toLowerCase() === 'true'

/**
 * Gate every marketplace route. Returns a 503 NextResponse when the
 * marketplace is disabled, or null when it's enabled. Call this at the top
 * of each route handler.
 */
export function marketplaceGate(): NextResponse | null {
  if (MARKETPLACE_ENABLED) return null
  return NextResponse.json(
    {
      error: 'marketplace_not_enabled',
      message:
        'The API provider marketplace is not enabled on this Apical instance. Set APICAL_MARKETPLACE_ENABLED=true to enable.',
    },
    { status: 503 },
  )
}

export { MARKETPLACE_ENABLED }
