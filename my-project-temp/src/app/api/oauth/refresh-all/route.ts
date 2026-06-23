import { NextResponse } from 'next/server'
import { refreshExpiringCredentials } from '@/lib/oauth-helpers'

// POST /api/oauth/refresh-all — cron endpoint. Finds every active OAuth
// credential whose access token expires within the next hour (or has already
// expired) and refreshes it using the stored refresh token.
//
// Auth: this route is intended to be called by the scheduler mini-service
// (or an external cron) using the APICAL_SCHEDULER_SECRET header. It is NOT
// behind getCurrentUser — there's no user context for a cron tick.
//
// Returns a summary: { checked, refreshed, failed, details[] }.
//
// Idempotent: safe to call every few minutes. Credentials that fail to refresh
// are surfaced in `details` so the cron operator can alert on repeat failures.

const SCHEDULER_SECRET =
  process.env.APICAL_SCHEDULER_SECRET || 'apical-scheduler-dev'

export async function POST(req: Request) {
  // Verify the scheduler secret. Any cron caller must include the matching
  // header. In dev the default secret is documented; in production it MUST be
  // overridden via env.
  const provided = req.headers.get('x-scheduler-secret') || ''
  if (provided !== SCHEDULER_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await refreshExpiringCredentials(60 * 60 * 1000)
    return NextResponse.json(result)
  } catch (err) {
    console.error('[api/oauth/refresh-all] failed:', err)
    return NextResponse.json(
      {
        checked: 0,
        refreshed: 0,
        failed: 0,
        details: [],
        error: 'refresh_all_failed',
      },
      { status: 500 },
    )
  }
}

// GET — convenience health check. Returns 200 with no body so a cron monitor
// can verify the route is alive without triggering a refresh.
export async function GET() {
  return NextResponse.json({ ok: true, route: 'oauth/refresh-all' })
}
