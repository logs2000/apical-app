// Apical — auth helpers for API routes + server components.
//
// Three modes of identifying "the current user":
//   1. NextAuth session (Google or Credentials login) → getServerSession.
//   2. PAT (Personal Access Token) → Authorization: Bearer ap_pat_...
//      Used by the apical-mcp mini-service + REST API.
//   3. Dev bypass → when NODE_ENV=development AND AUTH_BYPASS_DEV=true,
//      return a synthesized dev user (dev@apical.local) without auth.
//
// PATs use SHA-256 hashed storage (just like the old DeveloperAccount ApiKey
// flow) so the raw token is never persisted. Replaces src/lib/dev-auth.ts for
// user-facing API auth; the old dev-auth is kept for the legacy
// /api/dev/* routes until they migrate.

import { createHash, randomBytes } from 'crypto'
import { db } from './db'
import { getOrCreateDevUser, isDevBypass } from './auth'
import { createSupabaseServerClient } from './supabase/server'
import type { User as SupabaseUser } from '@supabase/supabase-js'
import type { PersonalAccessToken, User } from '@prisma/client'

// ---------------- Session user ----------------

/**
 * The current user, resolved from (in order):
 *   1. A NextAuth session (Google or Credentials login).
 *   2. A PAT in the Authorization header (ap_pat_...).
 *   3. Dev bypass (returns the dev@apical.local user, creating it if needed).
 * Returns null if none of those apply.
 *
 * `req` is optional — when passed, PAT auth is attempted. NextAuth session
 * resolution doesn't need it (it reads cookies via next/headers).
 */
export async function getCurrentUser(req?: Request): Promise<User | null> {
  // 1. Dev bypass — short-circuit before anything else.
  if (isDevBypass()) {
    if (
      process.env.DESKTOP_LOCAL === 'true' &&
      !process.env.DATABASE_URL?.startsWith('postgres')
    ) {
      return {
        id: 'desktop-local-dev',
        email: DEV_USER_EMAIL,
        name: DEV_USER_NAME,
        provider: 'credentials',
        passwordHash: null,
        image: null,
        emailVerified: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as User
    }
    try {
      return await getOrCreateDevUser()
    } catch (err) {
      console.error('[auth-helpers] dev bypass getOrCreateDevUser failed:', err)
      return null
    }
  }

  // 2. PAT (Authorization: Bearer ap_pat_...).
  if (req) {
    const pat = await authenticatePat(req)
    if (pat) return pat.user
  }

  // 3. Supabase session — resolve the Supabase auth user, then mirror it into
  //    the Prisma `User` table (the app's data anchor) on first use.
  try {
    const supabase = await createSupabaseServerClient()
    if (!supabase) return null
    const {
      data: { user: supaUser },
    } = await supabase.auth.getUser()
    if (!supaUser) return null
    return await syncSupabaseUser(supaUser)
  } catch (err) {
    console.error('[auth-helpers] getCurrentUser session lookup failed:', err)
    return null
  }
}

/**
 * Lazy-mirror a Supabase auth user into the Prisma `User` table. The Prisma row
 * id is set to the Supabase user id so every existing relation keys off it.
 * Links by email if a row already exists (e.g. from another provider).
 */
export async function syncSupabaseUser(supaUser: SupabaseUser): Promise<User> {
  const existingById = await db.user.findUnique({ where: { id: supaUser.id } })
  if (existingById) return existingById

  const email = (supaUser.email ?? '').toLowerCase()
  const meta = (supaUser.user_metadata ?? {}) as Record<string, unknown>
  const name =
    (typeof meta.name === 'string' && meta.name) ||
    (typeof meta.full_name === 'string' && meta.full_name) ||
    (email ? email.split('@')[0] : 'User')
  const image =
    (typeof meta.avatar_url === 'string' && meta.avatar_url) ||
    (typeof meta.picture === 'string' && meta.picture) ||
    null

  if (email) {
    const existingByEmail = await db.user.findUnique({ where: { email } })
    if (existingByEmail) return existingByEmail
  }

  return db.user.create({
    data: {
      id: supaUser.id,
      email: email || `${supaUser.id}@supabase.local`,
      name,
      image,
      provider: 'supabase',
    },
  })
}

/**
 * Throw a 401 Response if there's no current user. Returns the user otherwise.
 * Usage in a route handler:
 *   const user = await requireUser(req)  // throws 401 on no user
 */
export async function requireUser(req?: Request): Promise<User> {
  const user = await getCurrentUser(req)
  if (!user) {
    throw new Error('UNAUTHORIZED')
  }
  return user
}

/**
 * Wrap a route handler with requireUser. On auth failure returns 401
 * `{ error: 'Unauthorized' }`. On success, hands the loaded user to the handler.
 *
 * Usage:
 *   export const POST = withUser(async (req, { user, params }) => { ... })
 */
export function withUser<T extends unknown[]>(
  handler: (
    req: Request,
    ctx: { user: User; params: Record<string, string> },
    ...rest: T
  ) => Promise<Response> | Response,
) {
  return async (
    req: Request,
    routeCtx: { params: Promise<Record<string, string>> },
    ...rest: T
  ): Promise<Response> => {
    try {
      const user = await getCurrentUser(req)
      if (!user) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 })
      }
      const params = await routeCtx.params
      return await handler(req, { user, params }, ...rest)
    } catch (err) {
      console.error('[auth-helpers] withUser handler crashed:', err)
      return Response.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
}

export { isDevBypass }

// ---------------- PAT: generation + hashing ----------------

export const PAT_PREFIX = 'ap_pat_'

/** SHA-256 hex of the raw PAT. What we store in `PersonalAccessToken.tokenHash`. */
export function hashPat(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

/**
 * Generate a new `ap_pat_` + 32 hex chars token.
 * Returns the raw token (shown ONCE), the hash (stored), and the prefix
 * (first 12 chars — used for display in the dashboard).
 */
export function generatePat(userId: string): {
  raw: string
  hash: string
  prefix: string
  userId: string
} {
  // 16 random bytes → 32 hex chars.
  const raw = PAT_PREFIX + randomBytes(16).toString('hex')
  return {
    raw,
    hash: hashPat(raw),
    prefix: raw.slice(0, 12),
    userId,
  }
}

// ---------------- PAT: authentication ----------------

export interface PatAuthResult {
  user: User
  pat: PersonalAccessToken
}

/**
 * Authenticate a request via Personal Access Token.
 * Reads `Authorization: Bearer ap_pat_...` (also tolerates a raw `ap_pat_...`
 * value with no Bearer prefix). Hashes it, looks up an active PAT, loads the
 * user. Returns null on any failure — never throws.
 *
 * Used by the apical-mcp mini-service + the REST API.
 */
export async function authenticatePat(
  req: Request,
): Promise<PatAuthResult | null> {
  try {
    const raw = readRawPat(req)
    if (!raw) return null
    if (!raw.startsWith(PAT_PREFIX)) return null

    const hash = hashPat(raw)
    const pat = await db.personalAccessToken.findUnique({
      where: { tokenHash: hash },
      include: { user: true },
    })
    if (!pat) return null
    if (pat.status !== 'active') return null

    // Touch lastUsedAt (best-effort; never blocks the request).
    void db.personalAccessToken
      .update({ where: { id: pat.id }, data: { lastUsedAt: new Date() } })
      .catch((e) => {
        console.error('[auth-helpers] PAT lastUsedAt update failed:', e)
      })

    return { user: pat.user, pat }
  } catch (err) {
    console.error('[auth-helpers] authenticatePat failed:', err)
    return null
  }
}

/** Read the raw PAT string from a request's Authorization header. */
function readRawPat(req: Request): string | null {
  const auth = req.headers.get('authorization') || req.headers.get('Authorization')
  if (!auth) return null
  const trimmed = auth.trim()
  const raw = trimmed.startsWith('Bearer ') ? trimmed.slice('Bearer '.length).trim() : trimmed
  return raw || null
}
