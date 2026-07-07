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
 * Wrap a route handler with unified auth. 401 when unauthenticated, 403 when
 * the key lacks the required scope.
 */
export function withAuth(
  handler: AuthedHandler,
  opts: { scope?: ApiKeyScope } = {},
) {
  return async (
    req: Request,
    routeCtx: { params: Promise<Record<string, string>> },
  ): Promise<Response> => {
    try {
      const ctx = await resolveAuth(req)
      if (!ctx) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 })
      }
      if (opts.scope && !authHasScope(ctx, opts.scope)) {
        return Response.json(
          { error: `Missing required scope: ${opts.scope}` },
          { status: 403 },
        )
      }
      const params = await routeCtx.params
      return await handler(req, { ...ctx, params })
    } catch (err) {
      console.error('[with-auth] handler crashed:', err)
      return Response.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
}
