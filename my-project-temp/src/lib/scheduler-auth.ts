// Apical — scheduler request authentication.
//
// The scheduler mini-service authenticates to the Next.js API with a shared
// secret in the `X-Scheduler-Secret` header. The secret MUST be provided via
// the APICAL_SCHEDULER_SECRET env var — there is no default. When the env var
// is unset, scheduler auth fails closed (all scheduler-authenticated requests
// are rejected).

import { timingSafeEqual } from 'crypto'

/** Constant-time string comparison (avoids leaking the secret via timing). */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

/**
 * True when the request carries a valid `X-Scheduler-Secret` header matching
 * APICAL_SCHEDULER_SECRET. Fails closed when the env var is unset.
 */
export function isSchedulerRequest(req: Request): boolean {
  const secret = process.env.APICAL_SCHEDULER_SECRET
  if (!secret || !secret.trim()) return false
  const provided = req.headers.get('x-scheduler-secret') || ''
  if (!provided) return false
  return safeEqual(provided, secret.trim())
}
