// Apical — client/geo context capture.
//
// Persists the caller's timezone + locale (reported by the browser) and an
// approximate location derived from the request IP (edge/proxy geo headers)
// onto their UserProfile. This is what lets the agent reason about "today",
// business hours, currency, local services, etc. — see
// `user-context.ts › geographyBlock`.
//
// Design:
//   - timezone/locale come from the client and are AUTHORITATIVE (they follow
//     the user when they travel), so we update them whenever provided.
//   - country/region/city come from the request IP and are APPROXIMATE, so we
//     only fill them when we currently have nothing stored — never clobber a
//     more specific known value with a coarse IP guess.

import { db } from '@/lib/db'

export interface ClientContextInput {
  timezone?: unknown
  locale?: unknown
}

/** IANA timezone sanity check (e.g. "America/Chicago", "UTC"). */
function cleanTimezone(v: unknown): string {
  const s = typeof v === 'string' ? v.trim() : ''
  if (!s || s.length > 64) return ''
  // Allow letters, digits, "/", "_", "+", "-" (covers "Etc/GMT+5" etc.).
  if (!/^[A-Za-z0-9_+\-/]+$/.test(s)) return ''
  return s
}

function cleanLocale(v: unknown): string {
  const s = typeof v === 'string' ? v.trim() : ''
  if (!s || s.length > 35) return ''
  if (!/^[A-Za-z0-9_-]+$/.test(s)) return ''
  return s
}

function headerVal(req: Request, name: string): string {
  const v = req.headers.get(name)
  if (!v) return ''
  // Some providers URL-encode city/region (e.g. "San%20Francisco").
  try {
    return decodeURIComponent(v).trim().slice(0, 80)
  } catch {
    return v.trim().slice(0, 80)
  }
}

/** Approximate geo from common edge/proxy headers (Vercel, Cloudflare, etc.). */
function geoFromHeaders(req: Request): {
  country: string
  region: string
  city: string
  timezone: string
} {
  const country =
    headerVal(req, 'x-vercel-ip-country') || headerVal(req, 'cf-ipcountry')
  const region =
    headerVal(req, 'x-vercel-ip-country-region') ||
    headerVal(req, 'x-vercel-ip-region')
  const city = headerVal(req, 'x-vercel-ip-city')
  const timezone = cleanTimezone(
    headerVal(req, 'x-vercel-ip-timezone') || headerVal(req, 'cf-timezone'),
  )
  return { country, region, city, timezone }
}

/**
 * Best-effort upsert of the caller's time/place context. Awaited (it's a
 * single fast query) so the values are available to the same turn's
 * `loadUserContextBlock`. Never throws — geo capture must not break a chat.
 */
export async function captureClientContext(
  req: Request,
  userId: string,
  input: ClientContextInput | undefined,
): Promise<void> {
  try {
    const tz = cleanTimezone(input?.timezone)
    const locale = cleanLocale(input?.locale)
    const geo = geoFromHeaders(req)

    // Authoritative (client) fields — set whenever we have them.
    const update: Record<string, string> = {}
    if (tz) update.timezone = tz
    else if (geo.timezone) update.timezone = geo.timezone
    if (locale) update.locale = locale

    // Approximate (IP) fields — fill only when currently empty.
    const existing = await db.userProfile.findUnique({
      where: { userId },
      select: { country: true, region: true, city: true, timezone: true },
    })
    if (geo.country && !existing?.country) update.country = geo.country
    if (geo.region && !existing?.region) update.region = geo.region
    if (geo.city && !existing?.city) update.city = geo.city

    if (Object.keys(update).length === 0) return

    await db.userProfile.upsert({
      where: { userId },
      update,
      create: { userId, ...update },
    })
  } catch (err) {
    console.warn('[client-context] capture failed (non-fatal):', err)
  }
}
