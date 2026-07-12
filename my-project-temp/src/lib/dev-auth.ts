// Apical — developer-platform route auth (legacy /api/dev surface).
//
// THIN WRAPPER over the unified API key system (src/lib/api-key-auth.ts).
// The old DeveloperAccount model is gone — a "developer" is now simply a
// workspace (which carries plan + balanceCents + billing). These helpers keep
// the /api/dev routes working until they're replaced by /v1.

import {
  authenticateApiKey,
  generateApiKey,
  hashApiKey,
  DEV_KEY_COOKIE,
  type ApiKeyAuthResult,
} from './api-key-auth'
import type { ApiKey, Workspace } from '@prisma/client'

export { generateApiKey, hashApiKey, DEV_KEY_COOKIE }

export interface DevAuthResult {
  workspace: Workspace
  apiKey: ApiKey
  scopes: string[]
}

/**
 * Authenticate a developer request via unified API key. Returns null on any
 * failure — never throws.
 */
export async function authenticateDev(req: Request): Promise<DevAuthResult | null> {
  const result: ApiKeyAuthResult | null = await authenticateApiKey(req)
  if (!result) return null
  return { workspace: result.workspace, apiKey: result.apiKey, scopes: result.scopes }
}

// ---------------- Route handler wrapper ----------------

type DevAuthHandler = (
  req: Request,
  ctx: { workspace: Workspace; apiKey: ApiKey; scopes: string[]; params: Record<string, string> },
) => Promise<Response> | Response

/**
 * Wrap a route handler with developer auth. On failure returns 401.
 * On success, hands the workspace + apiKey to the handler.
 *
 * Usage:
 *   export const POST = withDevAuth(async (req, { workspace, apiKey, params }) => { ... })
 */
// The /api/dev/* surface predates /v1 and is DEPRECATED — /v1 is the one
// canonical programmatic surface (scope-enforced, enveloped, paginated,
// rate-limited, documented via /v1/openapi.json). Every /api/dev response
// carries RFC 8594 Deprecation + Link headers pointing callers there. It
// stays functional until its capabilities are ported forward and it is
// removed in a later pass.
const DEPRECATION_HEADERS: Record<string, string> = {
  Deprecation: 'true',
  Link: '</v1>; rel="successor-version", </v1/openapi.json>; rel="describedby"',
  Warning: '299 - "The /api/dev API is deprecated; migrate to /v1."',
}

function withDeprecation(res: Response): Response {
  for (const [k, v] of Object.entries(DEPRECATION_HEADERS)) res.headers.set(k, v)
  return res
}

export function withDevAuth(handler: DevAuthHandler) {
  return async (
    req: Request,
    routeCtx: { params: Promise<Record<string, string>> },
  ): Promise<Response> => {
    try {
      const auth = await authenticateDev(req)
      if (!auth) {
        return withDeprecation(
          Response.json({ error: 'Invalid or missing API key' }, { status: 401 }),
        )
      }
      const params = await routeCtx.params
      return withDeprecation(await handler(req, { ...auth, params }))
    } catch (err) {
      console.error('[dev-auth] handler crashed:', err)
      return withDeprecation(Response.json({ error: 'Internal server error' }, { status: 500 }))
    }
  }
}
