// API routes for /api/notifications/preferences.
//
//   GET   /api/notifications/preferences
//         → { gate, flagged, daily_brief, weekly_brief, schedule, billing }
//           (all booleans; missing keys default to true)
//
//   POST  /api/notifications/preferences  { prefs: { ...partial } }
//         → merge + persist; returns the complete prefs object.

import { NextResponse } from 'next/server'
import { withUser } from '@/lib/auth-helpers'
import {
  getNotificationPrefs,
  setNotificationPrefs,
  NOTIFICATION_PREF_KEYS,
  type NotificationPrefKey,
  type NotificationPrefs,
} from '@/lib/platform/notifications'

// GET /api/notifications/preferences — read the user's prefs.
export const GET = withUser(async (_req, { user }) => {
  const prefs = await getNotificationPrefs(user.id)
  return NextResponse.json(prefs)
})

interface SetBody {
  prefs?: Record<string, unknown>
}

// POST /api/notifications/preferences — merge + persist the user's prefs.
export const POST = withUser(async (req, { user }) => {
  let body: SetBody = {}
  try {
    body = (await req.json()) as SetBody
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  if (!body.prefs || typeof body.prefs !== 'object' || Array.isArray(body.prefs)) {
    return NextResponse.json(
      { error: 'prefs (object) is required' },
      { status: 400 },
    )
  }

  // Only accept the known keys; ignore anything else. Coerce truthy/falsy
  // non-boolean values: an explicit `false` disables; anything else (except
  // `true`) is ignored.
  const incoming: Partial<NotificationPrefs> = {}
  for (const key of NOTIFICATION_PREF_KEYS) {
    const v = (body.prefs as Record<string, unknown>)[key]
    if (typeof v === 'boolean') {
      incoming[key as NotificationPrefKey] = v
    }
  }

  if (Object.keys(incoming).length === 0) {
    return NextResponse.json(
      { error: `No valid pref keys. Known keys: ${NOTIFICATION_PREF_KEYS.join(', ')}` },
      { status: 400 },
    )
  }

  const merged = await setNotificationPrefs(user.id, incoming)
  return NextResponse.json(merged)
})
