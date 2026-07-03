// Apical — dev-only auto sign-in.
//
// This is NOT an auth bypass. It activates only when BOTH are true:
//   1. NODE_ENV !== 'production'  (never runs in a production build)
//   2. DEV_AUTH_EMAIL is set in .env.local  (explicit, credential-based opt-in)
//
// When enabled, it resolves — and lazily creates — a REAL User row for the
// configured credentials, so every request runs as a genuine, data-scoped
// account (the same one the /login page accepts). With no DEV_AUTH_EMAIL set,
// this is inert and auth behaves exactly as it does in production.
//
// Configure in .env.local (see .env.example):
//   DEV_AUTH_EMAIL=dev@apical.local
//   DEV_AUTH_PASSWORD=apical-dev      # optional; used when creating the row
//   DEV_AUTH_NAME=Developer           # optional display name

import bcrypt from 'bcryptjs'
import { db } from './db'
import type { User } from '@prisma/client'

/** True when dev auto sign-in is configured and allowed to run. */
export function devAutoLoginEnabled(): boolean {
  return (
    process.env.NODE_ENV !== 'production' &&
    !!process.env.DEV_AUTH_EMAIL?.trim()
  )
}

/**
 * Resolve the configured dev user, creating the row on first use. Returns null
 * when dev auto-login isn't enabled. Never throws — a DB error yields null so
 * callers fall through to the normal (unauthenticated) path.
 */
export async function getDevAutoLoginUser(): Promise<User | null> {
  if (!devAutoLoginEnabled()) return null
  const email = process.env.DEV_AUTH_EMAIL!.trim().toLowerCase()
  try {
    const existing = await db.user.findUnique({ where: { email } })
    if (existing) return existing

    const password = process.env.DEV_AUTH_PASSWORD || 'apical-dev'
    const name = process.env.DEV_AUTH_NAME?.trim() || email.split('@')[0]
    return await db.user.create({
      data: {
        email,
        name,
        provider: 'credentials',
        passwordHash: await bcrypt.hash(password, 10),
      },
    })
  } catch (err) {
    console.error('[dev-login] failed to resolve dev auto-login user:', err)
    return null
  }
}
