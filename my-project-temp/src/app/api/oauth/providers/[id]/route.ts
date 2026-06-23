// PATCH /api/oauth/providers/[id] — admin: update an OAuthProvider's
// clientId/clientSecret/scopes.
//
// Lets operators set OAuth credentials via the API (so they don't need raw DB
// access). Auth requirement: a signed-in user (admin-only in production, but
// with AUTH_BYPASS_DEV=true the dev user satisfies the check). Returns the
// updated provider (mapped through mapOAuthProvider so we never leak the
// secret — only `hasClientId: true`).
//
// Body (all optional, only provided fields are updated):
//   {
//     clientId?: string,
//     clientSecret?: string,
//     scopes?: string,        // space-separated scope string
//     status?: "active" | "coming_soon",
//     demoMode?: boolean,
//     supportsCustomCreds?: boolean
//   }

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { mapOAuthProvider } from '@/lib/mappers'
import { getCurrentUser } from '@/lib/auth-helpers'

interface RouteCtx {
  params: Promise<{ id: string }>
}

interface PatchBody {
  clientId?: string
  clientSecret?: string
  scopes?: string
  status?: string
  demoMode?: boolean
  supportsCustomCreds?: boolean
}

export async function PATCH(req: Request, ctx: RouteCtx) {
  try {
    const user = await getCurrentUser(req)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await ctx.params
    const existing = await db.oAuthProvider.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json(
        { error: 'OAuth provider not found.' },
        { status: 404 },
      )
    }

    const body = (await req.json().catch(() => ({}))) as PatchBody

    // Build the update payload — only fields that were explicitly provided.
    const data: Record<string, unknown> = {}
    if (typeof body.clientId === 'string') {
      data.clientId = body.clientId.trim()
    }
    if (typeof body.clientSecret === 'string') {
      // Allow empty string to clear the secret; otherwise store as-is.
      data.clientSecret = body.clientSecret
    }
    if (typeof body.scopes === 'string') {
      data.scopes = body.scopes.trim()
    }
    if (typeof body.status === 'string') {
      const s = body.status.trim().toLowerCase()
      if (s === 'active' || s === 'coming_soon') {
        data.status = s
      }
    }
    if (typeof body.demoMode === 'boolean') {
      data.demoMode = body.demoMode
    }
    if (typeof body.supportsCustomCreds === 'boolean') {
      data.supportsCustomCreds = body.supportsCustomCreds
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json(
        { error: 'No updatable fields provided.' },
        { status: 400 },
      )
    }

    const updated = await db.oAuthProvider.update({
      where: { id },
      data,
    })

    // Audit log (best-effort). Kept in console for now — wire to a real audit
    // table when one exists.
    console.log(
      `[api/oauth/providers/${id}] PATCH by ${user.email}:`,
      Object.keys(data).join(', '),
    )

    // Map through mapOAuthProvider so we never leak the clientSecret to the
    // client — only `hasClientId: true/false` is exposed.
    return NextResponse.json(mapOAuthProvider(updated))
  } catch (err) {
    console.error('[api/oauth/providers/[id]] PATCH failed:', err)
    return NextResponse.json(
      { error: 'Failed to update OAuth provider.' },
      { status: 500 },
    )
  }
}

// GET /api/oauth/providers/[id] — fetch a single OAuthProvider by id.
// Also requires auth. Useful for an admin detail page.
export async function GET(req: Request, ctx: RouteCtx) {
  try {
    const user = await getCurrentUser(req)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const { id } = await ctx.params
    const row = await db.oAuthProvider.findUnique({ where: { id } })
    if (!row) {
      return NextResponse.json(
        { error: 'OAuth provider not found.' },
        { status: 404 },
      )
    }
    return NextResponse.json(mapOAuthProvider(row))
  } catch (err) {
    console.error('[api/oauth/providers/[id]] GET failed:', err)
    return NextResponse.json(
      { error: 'Failed to load OAuth provider.' },
      { status: 500 },
    )
  }
}
