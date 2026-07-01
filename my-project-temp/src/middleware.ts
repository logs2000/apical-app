// Apical — auth + pre-launch middleware.
//
// Responsibilities (in order):
//   1. Desktop shell: never show the marketing home inside the Tauri shell.
//   2. Dev bypass: short-circuit everything in local development.
//   3. Pre-launch passcode gate: when PRELAUNCH_PASSCODE is set, require the
//      `apical-prelaunch` cookie before serving anything but the gate itself.
//   4. Supabase session refresh: keep the auth cookie fresh on every request.

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { isDevBypass } from '@/lib/dev-bypass'
import {
  DESKTOP_SHELL_COOKIE,
  DESKTOP_SHELL_VALUE,
} from '@/lib/desktop/shell-cookie'
import { desktopAppUrl } from '@/lib/desktop/desktop-origin'
import { PRELAUNCH_COOKIE } from '@/lib/prelaunch'

/**
 * Returns a redirect to /gate when the pre-launch passcode is enabled and the
 * visitor hasn't entered it yet. Returns null when the gate should let the
 * request through (gate disabled, allow-listed path, or cookie present).
 */
function gateRedirect(req: NextRequest): NextResponse | null {
  const passcode = process.env.PRELAUNCH_PASSCODE
  if (!passcode) return null // gate disabled (e.g. local dev)

  const { pathname } = req.nextUrl
  const allow =
    pathname === '/gate' ||
    pathname.startsWith('/api/gate') ||
    pathname.startsWith('/auth/callback') ||
    pathname.startsWith('/api/auth') ||
    pathname.startsWith('/downloads')
  if (allow) return null

  if (req.cookies.get(PRELAUNCH_COOKIE)?.value === '1') return null

  const url = req.nextUrl.clone()
  url.pathname = '/gate'
  url.searchParams.set('next', pathname)
  return NextResponse.redirect(url)
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl
  const isDesktopShell =
    req.cookies.get(DESKTOP_SHELL_COOKIE)?.value === DESKTOP_SHELL_VALUE

  // Never show the marketing home page inside the desktop shell.
  if (isDesktopShell && pathname === '/') {
    return NextResponse.redirect(desktopAppUrl('/api/auth/desktop-ui'))
  }

  // Local development: skip the gate and Supabase refresh entirely.
  if (isDevBypass()) {
    return NextResponse.next()
  }

  // Pre-launch passcode gate.
  const gate = gateRedirect(req)
  if (gate) return gate

  // Keep the Supabase auth session fresh. Dynamic import keeps @supabase/supabase-js
  // out of the edge bundle when Supabase env vars are unset (desktop CI builds).
  if (
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ) {
    const { updateSession } = await import('@/lib/supabase/middleware')
    return updateSession(req)
  }
  return NextResponse.next()
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|logo.svg|robots.txt|sitemap.xml|download).*)',
  ],
}
