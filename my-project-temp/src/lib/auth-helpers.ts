// Apical — auth helpers for API routes + server components.
//
// Three modes of identifying "the current user":
//   1. Unified API key → Authorization: Bearer ap_pat_... / ap_sk_...
//      (workspace-scoped keys; see src/lib/api-key-auth.ts).
//   2. Desktop device token → Authorization: Bearer dsk_...
//      (a DesktopSession minted via the device-authorization login).
//   3. Supabase session (Google or Credentials login).
//
// There is NO production auth bypass — every request authenticates for real.
// In development only, an opt-in auto sign-in (src/lib/dev-login.ts) can resolve
// a configured DEV_AUTH_EMAIL account as a final fallback. It is inert unless
// NODE_ENV !== 'production' and DEV_AUTH_EMAIL is set in .env.local.

import { db } from './db'
import { createSupabaseServerClient } from './supabase/server'
import { authenticateApiKey, getWorkspaceForUser } from './api-key-auth'
import { authenticateDesktopToken } from './desktop/device-auth'
import { getDevAutoLoginUser } from './dev-login'
import type { User as SupabaseUser } from '@supabase/supabase-js'
import type { User } from '@prisma/client'

export { getWorkspaceForUser }

// ---------------- Session user ----------------

/**
 * The current user, resolved from (in order):
 *   1. A unified API key in the Authorization header (ap_pat_/ap_sk_).
 *   2. A desktop device token in the Authorization header (dsk_).
 *   3. A Supabase session (cookies).
 * Returns null if none of those apply.
 *
 * `req` is optional — when passed, bearer-token auth is attempted. Session
 * resolution doesn't need it (it reads cookies via next/headers).
 */
export async function getCurrentUser(req?: Request): Promise<User | null> {
  // 1. Unified API key (Authorization: Bearer ap_pat_... / ap_sk_...).
  if (req) {
    const keyAuth = await authenticateApiKey(req)
    if (keyAuth?.user) return keyAuth.user

    // 2. Desktop device token (Authorization: Bearer dsk_...).
    const desktopAuth = await authenticateDesktopToken(req)
    if (desktopAuth) return desktopAuth.user
  }

  // 3. Supabase session — resolve the Supabase auth user, then mirror it into
  //    the Prisma `User` table (the app's data anchor) on first use.
  try {
    const supabase = await createSupabaseServerClient()
    if (supabase) {
      const {
        data: { user: supaUser },
      } = await supabase.auth.getUser()
      if (supaUser) return await syncSupabaseUser(supaUser)
    }
  } catch (err) {
    console.error('[auth-helpers] getCurrentUser session lookup failed:', err)
  }

  // 4. Dev-only auto sign-in (final fallback). Inert in production and unless
  //    DEV_AUTH_EMAIL is configured — a real session above always wins.
  return await getDevAutoLoginUser()
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

// ---------------- Admin gate ----------------

/**
 * Platform-admin check for operator-only endpoints (e.g. editing global OAuth
 * provider credentials). Admins are declared via APICAL_ADMIN_EMAILS (comma-
 * separated). Fails closed when the env var is unset.
 */
export function isAdminUser(user: User): boolean {
  const raw = process.env.APICAL_ADMIN_EMAILS ?? ''
  const admins = raw
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
  return admins.length > 0 && admins.includes(user.email.toLowerCase())
}

// (Personal Access Tokens are now ordinary unified API keys with the
// `ap_pat_` display prefix, stored in the workspace-scoped ApiKey table.
// See src/lib/api-key-auth.ts — there is no separate PAT code path anymore.)
