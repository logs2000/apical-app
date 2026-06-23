// Apical — simple in-memory fixed-window rate limiter.
//
// Used by LLM/agent endpoints to keep a single user (or anonymous IP) from
// flooding the model gateway. State is per-process: sufficient for a single
// Next.js server, which is the deployment shape today. For multi-instance
// deployments, swap the Map out for a Redis-backed limiter.
//
// Public API:
//   rateLimit(key, limit, windowMs) → { ok, retryAfter, remaining }
//     - `key` is a stable identifier (userId, IP, or composite).
//     - `limit` is the max number of requests allowed in the window.
//     - `windowMs` is the window length in milliseconds.
//   rateLimitByUser(userId, opts?) / rateLimitByReq(req, opts?) → same shape,
//   convenience wrappers that pick the right key.

interface Bucket {
  count: number
  resetsAt: number // epoch ms
}

interface RateLimitResult {
  ok: boolean
  /** Seconds until the bucket resets — set when `ok === false`. */
  retryAfter: number
  /** Remaining tokens in the current window (>= 0). */
  remaining: number
}

const buckets = new Map<string, Bucket>()

// Cap the map so a hostile caller can't grow it unbounded. Each entry is
// tiny (~24 bytes); 100k entries ≈ 2.4MB, which is well within budget.
const MAX_BUCKETS = 100_000

function gcIfNeeded() {
  if (buckets.size < MAX_BUCKETS) return
  const now = Date.now()
  for (const [k, b] of buckets) {
    if (b.resetsAt <= now) buckets.delete(k)
  }
  // If still too big (unlikely), wipe the oldest quarter by resetsAt.
  if (buckets.size >= MAX_BUCKETS) {
    const entries = Array.from(buckets.entries()).sort((a, b) => a[1].resetsAt - b[1].resetsAt)
    const toRemove = Math.floor(entries.length / 4)
    for (let i = 0; i < toRemove; i++) buckets.delete(entries[i][0])
  }
}

/**
 * Fixed-window rate limiter. Returns `{ ok, retryAfter, remaining }`.
 *
 * The window is anchored to the first request in the bucket — that means a
 * burst of `limit` requests at time T then nothing resets cleanly at
 * T + windowMs. Good enough for "20 req/min per user" style limits.
 */
export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): RateLimitResult {
  const now = Date.now()
  const existing = buckets.get(key)
  if (!existing || existing.resetsAt <= now) {
    gcIfNeeded()
    const bucket: Bucket = { count: 1, resetsAt: now + windowMs }
    buckets.set(key, bucket)
    return { ok: true, retryAfter: 0, remaining: Math.max(0, limit - 1) }
  }
  existing.count += 1
  const remaining = Math.max(0, limit - existing.count)
  if (existing.count > limit) {
    const retryAfter = Math.max(1, Math.ceil((existing.resetsAt - now) / 1000))
    return { ok: false, retryAfter, remaining: 0 }
  }
  return { ok: true, retryAfter: 0, remaining }
}

/**
 * Convenience: rate-limit by user id. When the user is anonymous (null),
 * falls back to the IP so anonymous traffic is still throttled.
 */
export function rateLimitByUser(
  userId: string | null | undefined,
  req: Request,
  limit: number,
  windowMs: number,
): RateLimitResult {
  const ip = clientIp(req)
  const key = userId ? `u:${userId}` : `ip:${ip}`
  return rateLimit(key, limit, windowMs)
}

/** Best-effort client-IP extraction from common proxy headers. */
export function clientIp(req: Request): string {
  const h = req.headers
  return (
    h.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    h.get('x-real-ip') ||
    '0.0.0.0'
  )
}
