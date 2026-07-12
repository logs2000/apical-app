// The declarative route wrapper for the canonical API surface. One call
// composes the whole cross-cutting stack in a fixed order:
//
//   auth (API key or session) → scope check → rate limit → input validation
//   → handler → error envelope
//
// Every stage funnels failures through `ApiError`/`toErrorResponse`, so a
// route never hand-rolls a status code or an error shape again. Built on the
// existing `resolveAuth`/`authHasScope` (src/lib/with-auth.ts) and
// `rateLimit`/`rateKeyForRequest` (src/lib/rate-limit.ts).
//
// Example:
//   export const POST = route(
//     async (req, { workspace, body }) => ok(await create(workspace.id, body)),
//     { scope: 'workflows:write', rateLimit: { limit: 60, windowMs: 60_000 },
//       body: CreateWorkflowSchema },
//   )

import { z } from 'zod'
import { resolveAuth, authHasScope, type AuthContext } from '../with-auth'
import { rateLimit, rateKeyForRequest } from '../rate-limit'
import type { ApiKeyScope } from '../api-key-auth'
import { ApiError, toErrorResponse } from './respond'
import { parseBody, parseQuery } from './validate'

export interface RouteOptions<B extends z.ZodTypeAny, Q extends z.ZodTypeAny> {
  /** Required scope. Sessions and (post-migration) full-scope keys pass. */
  scope?: ApiKeyScope
  /** Fixed-window rate limit, keyed by API key → user → IP. */
  rateLimit?: { limit: number; windowMs: number }
  /** Zod schema for the JSON body. Parsed result arrives as `ctx.body`. */
  body?: B
  /** Zod schema for the query string. Parsed result arrives as `ctx.query`. */
  query?: Q
  /** Skip authentication (public endpoints that do their own auth). */
  public?: boolean
}

type HandlerContext<B extends z.ZodTypeAny, Q extends z.ZodTypeAny> = AuthContext & {
  params: Record<string, string>
  body: B extends z.ZodTypeAny ? z.infer<B> : undefined
  query: Q extends z.ZodTypeAny ? z.infer<Q> : undefined
}

type Handler<B extends z.ZodTypeAny, Q extends z.ZodTypeAny> = (
  req: Request,
  ctx: HandlerContext<B, Q>,
) => Promise<Response> | Response

const ANON_CONTEXT: AuthContext = {
  workspace: null as unknown as AuthContext['workspace'],
  user: null,
  apiKey: null,
  scopes: [],
}

export function route<
  B extends z.ZodTypeAny = z.ZodTypeAny,
  Q extends z.ZodTypeAny = z.ZodTypeAny,
>(handler: Handler<B, Q>, opts: RouteOptions<B, Q> = {}) {
  return async (
    req: Request,
    routeCtx: { params: Promise<Record<string, string>> },
  ): Promise<Response> => {
    try {
      const params = (await routeCtx.params) ?? {}

      // 1. Authentication (unless the route opts out).
      let ctx: AuthContext = ANON_CONTEXT
      if (!opts.public) {
        const resolved = await resolveAuth(req)
        if (!resolved) throw new ApiError('unauthorized', 'Authentication required.')
        ctx = resolved
        // 2. Scope.
        if (opts.scope && !authHasScope(ctx, opts.scope)) {
          throw new ApiError('forbidden', `Missing required scope: ${opts.scope}`)
        }
      }

      // 3. Rate limit (per key/user/IP + method + path).
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

      // 4. Input validation.
      const body = (opts.body ? await parseBody(req, opts.body) : undefined) as HandlerContext<
        B,
        Q
      >['body']
      const query = (opts.query
        ? parseQuery(new URL(req.url), opts.query)
        : undefined) as HandlerContext<B, Q>['query']

      // 5. Handler.
      return await handler(req, { ...ctx, params, body, query })
    } catch (err) {
      return toErrorResponse(err)
    }
  }
}
