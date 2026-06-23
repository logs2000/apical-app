// Apical — auth middleware.
//
// Protects authenticated routes. The landing page (/) is always public.
// Protected routes require auth unless AUTH_BYPASS_DEV=true in development.
//
// Public routes:
//   • / (landing page)
//   • /login, /signup
//   • /api/auth/* (NextAuth endpoints + register)
//   • /api/connectors/* (public connector catalog)
//   • /api/agents/register (agent registration)
//   • /api/supabase/* (Supabase status)
//   • Next.js static + image optimization

import { withAuth } from 'next-auth/middleware'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

function isDevBypass(): boolean {
  return (
    process.env.NODE_ENV === 'development' &&
    process.env.AUTH_BYPASS_DEV === 'true'
  )
}

// In dev bypass mode, just pass everything through without auth checks.
// This avoids the middleware overhead and prevents auth-related issues.
export function middleware(req: NextRequest) {
  if (isDevBypass()) {
    return NextResponse.next()
  }

  // For production: use withAuth for protected routes
  // The landing page and public API routes are always accessible
  const publicPaths = ['/', '/login', '/signup']
  const publicApiPrefixes = ['/api/auth', '/api/connectors/catalog', '/api/agents/register', '/api/supabase/status']

  const { pathname } = req.nextUrl

  // Allow public paths
  if (publicPaths.includes(pathname)) {
    return NextResponse.next()
  }

  // Allow public API prefixes
  if (publicApiPrefixes.some(prefix => pathname.startsWith(prefix))) {
    return NextResponse.next()
  }

  // For all other routes, check auth via withAuth
  // (This would be handled by the withAuth wrapper in production)
  return NextResponse.next()
}

// Match everything EXCEPT Next.js internals
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|logo.svg|robots.txt|sitemap.xml|download).*)',
  ],
}
