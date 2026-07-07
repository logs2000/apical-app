// Smoke: Part-5 non-API hardening.
//   - OAuth CSRF state is DB-backed (survives across "instances"), one-shot,
//     TTL-expiring, with the BYO client secret encrypted at rest.
//   - vault looksEncrypted no longer misclassifies a 2-colon secret as
//     already-encrypted (which would store it in plaintext).
//   - clientIp resists x-forwarded-for spoofing (takes the trusted rightmost
//     hop, not the client-controlled leftmost).
// Run: bun scripts/smoke/19-security-hardening.ts

import { db } from '../../src/lib/db'
import { setOAuthState, consumeOAuthState, getOAuthState, _debugClearOAuthStates } from '../../src/lib/oauth-state'
import { looksEncrypted, encrypt, encryptSecretMetaFields } from '../../src/lib/platform/vault'
import { clientIp } from '../../src/lib/rate-limit'

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error(`FAIL: ${msg}`)
    process.exit(1)
  }
}

// ---- 1. OAuth state: DB-backed, one-shot, encrypted secret, TTL ----
await _debugClearOAuthStates()
await setOAuthState('smoke-state-1', {
  userId: 'u_smoke',
  provider: 'google',
  providerName: 'Google',
  customClientId: 'client-abc',
  customClientSecret: 'super-secret-oauth-client',
})

// The secret is encrypted at rest (a fresh DB read, as another instance would do).
const raw = await db.oAuthState.findUnique({ where: { state: 'smoke-state-1' } })
assert(raw?.customClientSecret && raw.customClientSecret !== 'super-secret-oauth-client', 'client secret must be encrypted at rest')
assert(looksEncrypted(raw!.customClientSecret!), 'stored client secret is a vault blob')

// getOAuthState decrypts and does NOT consume.
const peek = await getOAuthState('smoke-state-1')
assert(peek?.customClientSecret === 'super-secret-oauth-client', 'getOAuthState decrypts the secret')
assert((await db.oAuthState.findUnique({ where: { state: 'smoke-state-1' } })) !== null, 'getOAuthState does not consume')

// consumeOAuthState returns it once, then it is gone (replay rejected).
const first = await consumeOAuthState('smoke-state-1')
assert(first?.userId === 'u_smoke', 'consume returns the entry')
const second = await consumeOAuthState('smoke-state-1')
assert(second === null, 'consume is one-shot (replay rejected)')
console.log('oauth-state: DB-backed, secret encrypted at rest, one-shot consume')

// Expired state is rejected + cleaned up.
await setOAuthState('smoke-state-exp', { userId: 'u2', provider: 'x', providerName: 'X' })
await db.oAuthState.update({ where: { state: 'smoke-state-exp' }, data: { expiresAt: new Date(Date.now() - 1000) } })
assert((await getOAuthState('smoke-state-exp')) === null, 'expired state rejected')
assert((await db.oAuthState.findUnique({ where: { state: 'smoke-state-exp' } })) === null, 'expired state cleaned up')
console.log('oauth-state: expired states are rejected and purged')

// ---- 2. vault looksEncrypted no longer misclassifies real secrets ----
assert(looksEncrypted(encrypt('hello')), 'a real vault blob is detected')
// The classic false positive: a secret that happens to contain two colons.
assert(!looksEncrypted('user:pass:host'), '2-colon secret is NOT treated as encrypted')
assert(!looksEncrypted('postgres://a:b@c'), 'connection-string-ish value is not "encrypted"')
assert(!looksEncrypted('aaa:bbb:ccc'), 'short 3-part non-blob is not "encrypted"')
// Therefore such a secret gets encrypted rather than stored raw.
const out = encryptSecretMetaFields({ password: 'user:pass:host' })
assert(out.password !== 'user:pass:host' && looksEncrypted(out.password as string), '2-colon secret is encrypted at rest, not stored plaintext')
console.log('vault: looksEncrypted rejects 2-colon secrets; they are encrypted, not leaked')

// ---- 3. clientIp resists x-forwarded-for spoofing ----
// Default 1 trusted hop → the real client is the rightmost XFF entry; a
// client-prepended fake sits to the left and is ignored.
delete process.env.TRUSTED_PROXY_HOPS
const spoofed = clientIp(new Request('http://x', { headers: { 'x-forwarded-for': '1.2.3.4, 9.9.9.9' } }))
assert(spoofed === '9.9.9.9', `expected trusted rightmost hop, got ${spoofed}`)
// x-real-ip (set by the immediate proxy) wins when present.
const real = clientIp(new Request('http://x', { headers: { 'x-real-ip': '5.6.7.8', 'x-forwarded-for': '1.1.1.1' } }))
assert(real === '5.6.7.8', 'x-real-ip preferred')
console.log('clientIp: takes the trusted hop / x-real-ip, not the spoofable leftmost')

// Cleanup.
await _debugClearOAuthStates()

console.log('OK: 19-security-hardening')
process.exit(0)
