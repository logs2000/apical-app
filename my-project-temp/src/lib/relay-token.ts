// Apical — short-lived signed room tokens for the run-relay.
//
// Browsers may only join a relay room (`run:<runId>`) with a token minted by
// an authenticated API route that verified run ownership. Tokens are HMAC-
// SHA256 signed with APICAL_RELAY_SECRET (shared with the relay service,
// which verifies them independently). The raw secret never reaches a browser.
//
// Token format: base64url(`${runId}.${expiresAtMs}`) + '.' + hex(hmac)

import { createHmac, timingSafeEqual } from 'crypto'

const DEFAULT_TTL_MS = 15 * 60 * 1000

function getRelaySecret(): string | null {
  const s = process.env.APICAL_RELAY_SECRET
  return s && s.trim() ? s.trim() : null
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex')
}

/**
 * Mint a room token for a run. Returns null when APICAL_RELAY_SECRET is not
 * configured (the relay refuses joins in that case anyway — fail closed).
 */
export function mintRunRelayToken(
  runId: string,
  ttlMs: number = DEFAULT_TTL_MS,
): { token: string; expiresAt: number } | null {
  const secret = getRelaySecret()
  if (!secret) return null
  const expiresAt = Date.now() + ttlMs
  const payload = `${runId}.${expiresAt}`
  const encoded = Buffer.from(payload).toString('base64url')
  return { token: `${encoded}.${sign(payload, secret)}`, expiresAt }
}

/** Verify a room token. Returns the runId when valid + unexpired, else null. */
export function verifyRunRelayToken(token: string): string | null {
  const secret = getRelaySecret()
  if (!secret) return null
  const dot = token.lastIndexOf('.')
  if (dot <= 0) return null
  const encoded = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  let payload: string
  try {
    payload = Buffer.from(encoded, 'base64url').toString('utf8')
  } catch {
    return null
  }
  const expected = sign(payload, secret)
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  const sep = payload.lastIndexOf('.')
  if (sep <= 0) return null
  const runId = payload.slice(0, sep)
  const expiresAt = Number(payload.slice(sep + 1))
  if (!runId || !Number.isFinite(expiresAt) || Date.now() > expiresAt) return null
  return runId
}
