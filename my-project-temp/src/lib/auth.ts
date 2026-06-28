// Apical — NextAuth configuration (AUTH-1).
//
// Session strategy: JWT (no database sessions) — simpler, works without a
// Session table, and survives serverless restarts.
//
// Providers:
//   • Google    — OAuth. Disabled gracefully when GOOGLE_CLIENT_ID is empty
//                 (so the app boots in dev without OAuth configured).
//   • Credentials — email + password (bcrypt-hashed). Used by the signup +
//                 login pages. Looks up User by email, verifies the hash.
//
// Dev bypass: on by default in development (set AUTH_BYPASS_DEV=false to disable).
// The app pretends you're logged in as dev@apical.local. Middleware skips
// protection and getCurrentUser() returns the dev user without NextAuth login.
//
// Export `authOptions` for use in:
//   - src/app/api/auth/[...nextauth]/route.ts (the NextAuth route handlers)
//   - src/lib/auth-helpers.ts (getServerSession)
//   - src/middleware.ts (NextAuth's withAuth)

import type { NextAuthOptions } from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import bcrypt from 'bcryptjs'
import { db } from './db'
import {
  DEV_USER_EMAIL,
  DEV_USER_NAME,
  isDevBypass,
} from './dev-bypass'
import { sessionCookieName, useSecureSessionCookies } from '@/lib/desktop/session-cookie'

export { DEV_USER_EMAIL, DEV_USER_NAME, isDevBypass }

/**
 * Get-or-create the dev user. Used by getCurrentUser() when dev bypass is on,
 * so routes that hit `requireUser()` still get a real User row with a real id
 * (and any seed data linked to that id shows up).
 */
export async function getOrCreateDevUser() {
  let user = await db.user.findUnique({ where: { email: DEV_USER_EMAIL } })
  if (!user) {
    user = await db.user.create({
      data: {
        email: DEV_USER_EMAIL,
        name: DEV_USER_NAME,
        provider: 'credentials',
        // Dev user has no password — they don't log in, they're auto-attached.
        passwordHash: null,
      },
    })
  }
  return user
}

// ---------------- Provider list (built dynamically) ----------------

function buildProviders(): NextAuthOptions['providers'] {
  const providers: NextAuthOptions['providers'] = []

  // Google (optional — only enabled when both env vars are set).
  const googleId = process.env.GOOGLE_CLIENT_ID
  const googleSecret = process.env.GOOGLE_CLIENT_SECRET
  if (googleId && googleSecret) {
    // Dynamic import keeps NextAuth from crashing when the package isn't
    // configured — though next-auth/providers/google ships with next-auth.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const GoogleProvider = require('next-auth/providers/google').default
    providers.push(
      GoogleProvider({ clientId: googleId, clientSecret: googleSecret }),
    )
  }

  // Credentials (email + password). Always available — it's the signup flow.
  providers.push(
    CredentialsProvider({
      name: 'Email + Password',
      credentials: {
        email: { label: 'Email', type: 'email', placeholder: 'you@example.com' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        const email = credentials?.email?.trim().toLowerCase()
        const password = credentials?.password ?? ''
        if (!email || !password) return null

        try {
          const user = await db.user.findUnique({ where: { email } })
          if (!user || !user.passwordHash) return null
          const ok = await bcrypt.compare(password, user.passwordHash)
          if (!ok) return null
          return {
            id: user.id,
            email: user.email,
            name: user.name ?? undefined,
            image: user.image ?? undefined,
          }
        } catch (err) {
          console.error('[auth] credentials authorize failed:', err)
          return null
        }
      },
    }),
  )

  return providers
}

// ---------------- authOptions ----------------

export const authOptions: NextAuthOptions = {
  // JWT strategy — no database sessions.
  session: { strategy: 'jwt' },

  // http://127.0.0.1 desktop must not use Secure cookies (production default breaks auth).
  useSecureCookies: useSecureSessionCookies(),
  cookies: {
    sessionToken: {
      name: sessionCookieName(),
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: useSecureSessionCookies(),
      },
    },
  },

  providers: buildProviders(),

  pages: {
    signIn: '/login',
  },

  callbacks: {
    /**
     * JWT callback: attach the user id to the token on first sign-in
     * (when `user` is passed), then propagate it on subsequent requests.
     */
    async jwt({ token, user }) {
      if (user?.id) {
        token.userId = user.id
      }
      // Dev bypass: synthesize a token for the dev user so getServerSession
      // returns something sensible even when the user never actually signed in.
      if (!token.userId && isDevBypass()) {
        try {
          const dev = await getOrCreateDevUser()
          token.userId = dev.id
          token.email = dev.email
          token.name = dev.name ?? undefined
        } catch (err) {
          console.error('[auth] dev-bypass jwt setup failed:', err)
        }
      }
      return token
    },

    /**
     * Session callback: expose userId + image + name on the client session
     * so `useSession()` and `getServerSession()` can read them.
     */
    async session({ session, token }) {
      if (token.userId && session.user) {
        // NextAuth's Session type doesn't know about `userId` — extend at the
        // call site with a cast.
        ;(session.user as { userId?: string }).userId = token.userId as string
      }
      if (token.email && session.user) {
        session.user.email = token.email as string
      }
      if (token.name && session.user) {
        session.user.name = token.name as string
      }
      if (token.picture && session.user) {
        session.user.image = token.picture as string
      }
      return session
    },
  },
}
