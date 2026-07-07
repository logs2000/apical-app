// Shared smoke helper: mint a desktop-session bearer token that authenticates
// a user on the first-party /api/* surface. API keys no longer authenticate
// /api/* (Part 2 closed that scope-bypass), so smoke tests that drive /api/*
// route handlers use a dsk_ token — the same path the real desktop app uses.
// Not a numbered test, so run-all.sh (globs [0-9]*.ts) never executes it.

import { randomBytes } from 'node:crypto'
import { db } from '../../src/lib/db'

/** Create a DesktopSession and return its bearer token (dsk_...). */
export async function mintSessionToken(userId: string, label = 'smoke-session'): Promise<string> {
  const token = `dsk_${randomBytes(24).toString('hex')}`
  await db.desktopSession.create({ data: { userId, sessionToken: token, label } })
  return token
}

/** Remove all desktop sessions for a user (smoke cleanup). */
export async function clearSessionTokens(userId: string): Promise<void> {
  await db.desktopSession.deleteMany({ where: { userId } })
}
