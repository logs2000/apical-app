// Apical — in-memory OAuth state store.
//
// The OAuth `state` parameter prevents CSRF: we mint a random token when the
// user starts the flow, embed it in the authorization URL, and verify it on
// callback. We keep the (userId, provider, customClientId/Secret) triple tied
// to that state so the callback knows who started what.
//
// In-memory Map → fine for single-server dev. For production behind multiple
// instances, swap this for a Redis-backed store (TTL'd key with the JSON entry
// as the value). The interface stays the same.

const STATE_TTL_MS = 10 * 60 * 1000 // 10 minutes — generous for OAuth handoff.

export interface OAuthStateEntry {
  userId: string
  provider: string // provider key, e.g. "google"
  providerName: string // display name, for the credential label
  /** When the user supplies their own OAuth client (BYO credentials). */
  customClientId?: string
  customClientSecret?: string
  /**
   * Set internally by `setOAuthState()` — callers don't need to provide it.
   * Marked optional on input so callers can omit it; the stored entry always
   * has it.
   */
  createdAt?: number
}

// Singleton across HMR reloads in dev.
declare global {
  var __apicalOAuthStates: Map<string, OAuthStateEntry> | undefined
}

const states: Map<string, OAuthStateEntry> =
  globalThis.__apicalOAuthStates ?? new Map<string, OAuthStateEntry>()
if (process.env.NODE_ENV !== 'production') {
  globalThis.__apicalOAuthStates = states
}

export function setOAuthState(state: string, entry: OAuthStateEntry): void {
  states.set(state, { ...entry, createdAt: Date.now() })
}

/** Look up a state entry. Returns null if not found or expired. */
export function getOAuthState(state: string): OAuthStateEntry | null {
  const e = states.get(state)
  if (!e) return null
  const createdAt = e.createdAt ?? 0
  if (Date.now() - createdAt > STATE_TTL_MS) {
    states.delete(state)
    return null
  }
  return e
}

/** Look up + delete (one-shot). Used by the callback so a state can't be replayed. */
export function consumeOAuthState(state: string): OAuthStateEntry | null {
  const e = getOAuthState(state)
  if (e) states.delete(state)
  return e
}

/** For debugging / tests. */
export function _debugClearOAuthStates(): void {
  states.clear()
}
