import { NextResponse } from 'next/server'
import { withUser } from '@/lib/auth-helpers'
import { toggleOverrun } from '@/lib/platform/billing'

interface OverrunBody {
  enabled?: boolean
}

// POST /api/billing/overrun — toggle pay-as-you-go overrun billing on/off.
// Only allowed on plans where `getPlan(sub.plan).overrunAvailable` is true
// (pro + enterprise). When enabling, snapshots the plan's
// `overrunRateCentsPer1M` onto the subscription so the user's rate is
// locked in.
//
// Body: { enabled: boolean }
// Returns: { subscription }
export const POST = withUser(async (req, { user }) => {
  const body = (await req.json().catch(() => ({}))) as OverrunBody
  if (typeof body.enabled !== 'boolean') {
    return NextResponse.json(
      { error: 'enabled (boolean) is required' },
      { status: 400 },
    )
  }

  try {
    const subscription = await toggleOverrun(user.id, body.enabled)
    return NextResponse.json({ subscription })
  } catch (err) {
    console.error('[api/billing/overrun] failed:', err)
    const msg = err instanceof Error ? err.message : 'Failed to toggle overrun'
    return NextResponse.json({ error: msg }, { status: 400 })
  }
})
