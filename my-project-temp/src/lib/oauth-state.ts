// Apical — OAuth state store (DB-backed).
//
// The OAuth `state` parameter prevents CSRF: we mint a random token when the
// user starts the flow, embed it in the authorization URL, and verify it on
// callback. We keep the (userId, provider, custom client) triple tied to that
// state so the callback knows who started what.
//
// This lives in Postgres (OAuthState model), NOT an in-memory Map. On a
// multi-instance / serverless deploy the start and callback requests can land
// on different instances; an in-memory store would lose the state between
// them and break the CSRF check (or fail the login outright). A BYO client
// secret is encrypted at rest with the vault. States are one-shot (deleted on
// consume) and TTL'd.

import { db } from './db'
import { encrypt, decrypt } from './platform/vault'

const STATE_TTL_MS = 10 * 60 * 1000 // 10 minutes — generous for OAuth handoff.

export interface OAuthStateEntry {
  userId: string
  provider: string // provider key, e.g. "google"
  providerName: string // display name, for the credential label
  /** When the user supplies their own OAuth client (BYO credentials). */
  customClientId?: string
  customClientSecret?: string
  /** Present on stored entries; callers omit it on input. */
  createdAt?: number
}

export async function setOAuthState(state: string, entry: OAuthStateEntry): Promise<void> {
  await db.oAuthState.upsert({
    where: { state },
    create: {
      state,
      userId: entry.userId,
      provider: entry.provider,
      providerName: entry.providerName,
      customClientId: entry.customClientId ?? null,
      customClientSecret: entry.customClientSecret ? encrypt(entry.customClientSecret) : null,
      expiresAt: new Date(Date.now() + STATE_TTL_MS),
    },
    update: {
      userId: entry.userId,
      provider: entry.provider,
      providerName: entry.providerName,
      customClientId: entry.customClientId ?? null,
      customClientSecret: entry.customClientSecret ? encrypt(entry.customClientSecret) : null,
      expiresAt: new Date(Date.now() + STATE_TTL_MS),
    },
  })
}

function mapRow(row: {
  userId: string
  provider: string
  providerName: string
  customClientId: string | null
  customClientSecret: string | null
  createdAt: Date
}): OAuthStateEntry {
  let customClientSecret: string | undefined
  if (row.customClientSecret) {
    try {
      customClientSecret = decrypt(row.customClientSecret)
    } catch {
      customClientSecret = undefined
    }
  }
  return {
    userId: row.userId,
    provider: row.provider,
    providerName: row.providerName,
    customClientId: row.customClientId ?? undefined,
    customClientSecret,
    createdAt: row.createdAt.getTime(),
  }
}

/** Look up a state entry. Returns null if not found or expired (expired rows
 *  are deleted). Does NOT consume — use consumeOAuthState for the callback. */
export async function getOAuthState(state: string): Promise<OAuthStateEntry | null> {
  const row = await db.oAuthState.findUnique({ where: { state } })
  if (!row) return null
  if (row.expiresAt.getTime() < Date.now()) {
    await db.oAuthState.delete({ where: { state } }).catch(() => {})
    return null
  }
  return mapRow(row)
}

/** Look up + delete (one-shot) so a state can't be replayed. Used by the
 *  callback. Returns null when unknown or expired. */
export async function consumeOAuthState(state: string): Promise<OAuthStateEntry | null> {
  const row = await db.oAuthState.findUnique({ where: { state } })
  // Delete unconditionally (best-effort) — the state is spent either way.
  await db.oAuthState.delete({ where: { state } }).catch(() => {})
  if (!row) return null
  if (row.expiresAt.getTime() < Date.now()) return null
  return mapRow(row)
}

/** For debugging / tests. */
export async function _debugClearOAuthStates(): Promise<void> {
  await db.oAuthState.deleteMany({})
}
