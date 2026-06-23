// Apical — Developer Platform auth.
//
// API keys are SHA-256 hashed at creation; the raw key is shown to the developer
// exactly once and never stored. Authenticating a request means: read the key
// from a cookie (SaaS Developer Console) or an Authorization/x-apical-key header
// (the apical-mcp server / REST API), hash it, look it up in the ApiKey table.
//
// Every successful authentication touches `lastUsedAt` + `lastUsedFrom` so the
// dashboard can show "last used 2 minutes ago from mcp".

import { createHash, randomBytes } from 'crypto'
import { cookies } from 'next/headers'
import { db } from './db'
import type { ApiKey, DeveloperAccount } from '@prisma/client'

// ---------------- Key generation + hashing ----------------

/** SHA-256 hex of the raw key. What we store in `ApiKey.keyHash`. */
export function hashApiKey(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

/**
 * Generate a new `ap_sk_` + 32 hex chars key.
 * Returns the raw key (shown once), the hash (stored), and the prefix
 * (first 12 chars, used for display in the dashboard).
 */
export function generateApiKey(): {
  raw: string
  hash: string
  prefix: string
} {
  const raw = 'ap_sk_' + randomBytes(16).toString('hex') // 32 hex chars
  return {
    raw,
    hash: hashApiKey(raw),
    prefix: raw.slice(0, 12),
  }
}

// ---------------- Auth ----------------

export interface DevAuthResult {
  developer: DeveloperAccount
  apiKey: ApiKey
}

/** The cookie name we use to keep the raw developer API key for the console. */
export const DEV_KEY_COOKIE = 'apical_dev_key'

/**
 * Tolerantly read the raw API key from a request:
 *   1. `Authorization: Bearer ap_sk_...` header (the apical-mcp / REST pattern)
 *   2. `x-apical-key: ap_sk_...` header (alternate REST pattern)
 *   3. `apical_dev_key` cookie (the SaaS Developer Console)
 *
 * Be tolerant of the `Bearer ` prefix even when sent via x-apical-key.
 */
async function readRawKey(req: Request): Promise<string | null> {
  // 1. Authorization: Bearer ...
  const auth = req.headers.get('authorization') || req.headers.get('Authorization')
  if (auth) {
    const trimmed = auth.trim()
    const raw = trimmed.startsWith('Bearer ')
      ? trimmed.slice('Bearer '.length).trim()
      : trimmed
    if (raw) return raw
  }
  // 2. x-apical-key
  const xKey = req.headers.get('x-apical-key')
  if (xKey) {
    const trimmed = xKey.trim()
    const raw = trimmed.startsWith('Bearer ')
      ? trimmed.slice('Bearer '.length).trim()
      : trimmed
    if (raw) return raw
  }
  // 3. Cookie (server-side, via next/headers).
  try {
    const c = await cookies()
    const cookieKey = c.get(DEV_KEY_COOKIE)?.value
    if (cookieKey) return cookieKey
  } catch {
    // cookies() can throw outside a request scope — fall through.
  }
  return null
}

/** Derive 'mcp' | 'rest' from `?source=` query param or `x-apical-source` header. */
function deriveSource(req: Request): 'mcp' | 'rest' {
  try {
    const url = new URL(req.url)
    const q = url.searchParams.get('source')
    if (q === 'mcp' || q === 'rest') return q
  } catch {
    // ignore
  }
  const h = req.headers.get('x-apical-source')
  if (h === 'mcp' || h === 'rest') return h
  return 'rest'
}

/**
 * Authenticate a developer request. Reads the raw key, hashes it, looks up an
 * active ApiKey by keyHash, loads the DeveloperAccount, and bumps lastUsedAt
 * + lastUsedFrom. Returns null on any failure (no/invalid key, revoked key,
 * suspended account) — never throws.
 */
export async function authenticateDev(
  req: Request,
): Promise<DevAuthResult | null> {
  try {
    const raw = await readRawKey(req)
    if (!raw) return null
    const hash = hashApiKey(raw)

    const apiKey = await db.apiKey.findUnique({
      where: { keyHash: hash },
      include: { developer: true },
    })
    if (!apiKey) return null
    if (apiKey.status !== 'active') return null
    if (apiKey.developer.status !== 'active') return null

    // Touch last-used metadata (best-effort; never blocks the request).
    const source = deriveSource(req)
    void db.apiKey
      .update({
        where: { id: apiKey.id },
        data: { lastUsedAt: new Date(), lastUsedFrom: source },
      })
      .catch((e) => {
        console.error('[dev-auth] lastUsedAt update failed:', e)
      })

    return { developer: apiKey.developer, apiKey }
  } catch (err) {
    console.error('[dev-auth] authenticateDev failed:', err)
    return null
  }
}

// ---------------- Route handler wrapper ----------------

type DevAuthHandler = (
  req: Request,
  ctx: { developer: DeveloperAccount; apiKey: ApiKey; params: Record<string, string> },
) => Promise<Response> | Response

/**
 * Wrap a route handler with developer auth. On failure returns 401
 * `{ error: 'Invalid or missing API key' }`. On success, hands the loaded
 * developer + apiKey to the handler.
 *
 * Usage:
 *   export const POST = withDevAuth(async (req, { developer, apiKey, params }) => { ... })
 */
export function withDevAuth(handler: DevAuthHandler) {
  return async (
    req: Request,
    routeCtx?: { params?: Promise<Record<string, string>> },
  ): Promise<Response> => {
    try {
      const auth = await authenticateDev(req)
      if (!auth) {
        return Response.json(
          { error: 'Invalid or missing API key' },
          { status: 401 },
        )
      }
      const params = routeCtx?.params ? await routeCtx.params : {}
      return await handler(req, {
        developer: auth.developer,
        apiKey: auth.apiKey,
        params,
      })
    } catch (err) {
      console.error('[dev-auth] handler crashed:', err)
      return Response.json(
        { error: 'Internal server error' },
        { status: 500 },
      )
    }
  }
}
