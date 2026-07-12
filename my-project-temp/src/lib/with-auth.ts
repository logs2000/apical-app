// Apical — THE unified auth middleware.
//
// One entry point for every authenticated route: browser session OR unified
// API key, resolved to the same shape:
//
//   { workspace, user, apiKey, scopes }
//
// - Session (Supabase cookie / dev auto-login): user + their primary
//   workspace, all scopes.
// - API key (Authorization: Bearer ap_...): the key's workspace + resolvable
//   acting user, the key's scopes ([] = all).
//
// New routes (and the /v1 surface) should use this instead of
// withUser/withDevAuth. Scope checks are opt-in per route:
//
//   export const POST = withAuth(async (req, { workspace, user }) => {...},
//                                 { scope: 'workflows:write' })

import { getCurrentUser } from './auth-helpers'
import {
  authenticateApiKey,
  getWorkspaceForUser,
  keyHasScope,
  ALL_SCOPES,
  type ApiKeyScope,
} from './api-key-auth'
import { rateLimit, rateKeyForRequest } from './rate-limit'
import { ApiError, toErrorResponse } from './api/respond'
import type { ApiKey, User, Workspace } from '@prisma/client'

export interface AuthContext {
  workspace: Workspace
  /** The acting user. Null only for machine keys with no resolvable owner. */
  user: User | null
  /** Set when the request authenticated via API key. */
  apiKey: ApiKey | null
  /** Granted scopes (fail closed — empty grants nothing). Browser sessions
   *  are granted every scope; keys carry their own explicit list. */
  scopes: string[]
}

/**
 * Resolve the auth context from a request: API key first (explicit bearer
 * credential wins), then browser session. Returns null when unauthenticated.
 */
export async function resolveAuth(req: Request): Promise<AuthContext | null> {
  const keyAuth = await authenticateApiKey(req)
  if (keyAuth) {
    return {
      workspace: keyAuth.workspace,
      user: keyAuth.user,
      apiKey: keyAuth.apiKey,
      scopes: keyAuth.scopes,
    }
  }

  const user = await getCurrentUser(req)
  if (!user) return null
  const workspace = await getWorkspaceForUser(user)
  // Browser/desktop sessions are first-party and fully trusted — grant every
  // scope explicitly so the fail-closed scope check (empty = none) never
  // denies a legitimate session.
  return { workspace, user, apiKey: null, scopes: [...ALL_SCOPES] }
}

/** True when the context grants the scope. Fail closed (empty grants none). */
export function authHasScope(ctx: AuthContext, scope: ApiKeyScope): boolean {
  return keyHasScope({ scopes: ctx.scopes }, scope)
}

type AuthedHandler = (
  req: Request,
  ctx: AuthContext & { params: Record<string, string> },
) => Promise<Response> | Response

/**
 * Wrap a route handler with unified auth for the canonical (/v1) surface.
 * Composes: auth → scope → optional rate limit → handler. Every failure — the
 * wrapper's own 401/403/429 and any ApiError the handler throws — is rendered
 * through the shared error envelope ({ error: { code, message, details? } });
 * unexpected throws become a generic 500 with no internal-text leak.
 *
 * For handlers that also want declarative zod body/query validation, use
 * `route()` (src/lib/api/route.ts), which layers that on the same primitives.
 */
export function withAuth(
  handler: AuthedHandler,
  opts: { scope?: ApiKeyScope; rateLimit?: { limit: number; windowMs: number } } = {},
) {
  return async (
    req: Request,
    routeCtx: { params: Promise<Record<string, string>> },
  ): Promise<Response> => {
    try {
      const ctx = await resolveAuth(req)
      if (!ctx) throw new ApiError('unauthorized', 'Authentication required.')
      if (opts.scope && !authHasScope(ctx, opts.scope)) {
        throw new ApiError('forbidden', `Missing required scope: ${opts.scope}`)
      }
      if (opts.rateLimit) {
        const key = rateKeyForRequest(req, ctx.apiKey?.id ?? null, ctx.user?.id ?? null)
        const rl = rateLimit(key, opts.rateLimit.limit, opts.rateLimit.windowMs)
        if (!rl.ok) {
          throw new ApiError('rate_limited', 'Rate limit exceeded. Retry later.', {
            details: { retryAfter: rl.retryAfter },
            headers: { 'Retry-After': String(rl.retryAfter) },
          })
        }
      }
      const params = await routeCtx.params
      return await handler(req, { ...ctx, params })
    } catch (err) {
      return toErrorResponse(err)
    }
  }
}
