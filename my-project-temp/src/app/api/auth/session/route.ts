// GET /api/auth/session — override the NextAuth session endpoint.
//
// Why override? In dev-bypass mode (NODE_ENV=development AND AUTH_BYPASS_DEV=true)
// we want GET /api/auth/session to return a synthesized session for the dev
// user (dev@apical.local) even though no one ever logged in. NextAuth's
// default handler returns {} when there's no JWT cookie — so the brief's "with
// dev bypass, GET /api/auth/session returns a session" verification fails.
//
// This route:
//   • In dev-bypass mode → returns a synthesized session for the dev user.
//   • Otherwise → delegates to NextAuth's handler (so production behavior is
//     unchanged).
//
// Next.js routing gives the static `session` segment precedence over the
// `[...nextauth]` catch-all, so this file wins for GET /api/auth/session
// without affecting any other NextAuth endpoint (signin, signout, callbacks).

import { getServerSession } from 'next-auth'
import { NextResponse } from 'next/server'
import { authOptions, getOrCreateDevUser } from '@/lib/auth'
import { isDevBypass } from '@/lib/dev-bypass'
import { db } from '@/lib/db'

export async function GET() {
  if (!isDevBypass()) {
    try {
      const session = await getServerSession(authOptions)
      return NextResponse.json(session ?? {})
    } catch (err) {
      console.error('[api/auth/session] session lookup failed:', err)
      return NextResponse.json({})
    }
  }

  try {
    const devUser = await getOrCreateDevUser()
    // Load the user's profile name style + any other context, if present.
    const profile = await db.userProfile.findFirst({
      where: { userId: devUser.id },
    })
    return NextResponse.json({
      user: {
        id: devUser.id,
        userId: devUser.id,
        email: devUser.email,
        name: devUser.name ?? 'Developer',
        image: devUser.image ?? null,
        agentNameStyle: profile?.agentNameStyle ?? 'evocative',
      },
      expires: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
    })
  } catch (err) {
    console.error('[api/auth/session] dev-bypass session failed:', err)
    return NextResponse.json({})
  }
}
