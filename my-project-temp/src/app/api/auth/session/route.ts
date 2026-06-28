// GET /api/auth/session — the single client-facing session endpoint.
//
// Resolves the current user via getCurrentUser(), which checks (in order):
//   1. Dev bypass (NODE_ENV=development AND AUTH_BYPASS_DEV=true) → dev user.
//   2. Supabase auth session (the production login path).
//   3. PAT (Authorization: Bearer ap_pat_...).
//
// Returns a NextAuth-compatible shape ({ user, expires }) so the client
// SupabaseSessionProvider/useSession() hook can consume it unchanged. Returns
// {} when nobody is signed in.

import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth-helpers'
import { db } from '@/lib/db'

export async function GET(req: Request) {
  try {
    const user = await getCurrentUser(req)
    if (!user) return NextResponse.json({})

    const profile = await db.userProfile.findFirst({
      where: { userId: user.id },
    })

    return NextResponse.json({
      user: {
        id: user.id,
        userId: user.id,
        email: user.email,
        name: user.name ?? user.email?.split('@')[0] ?? 'User',
        image: user.image ?? null,
        agentNameStyle: profile?.agentNameStyle ?? 'evocative',
      },
      expires: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString(),
    })
  } catch (err) {
    console.error('[api/auth/session] session lookup failed:', err)
    return NextResponse.json({})
  }
}
