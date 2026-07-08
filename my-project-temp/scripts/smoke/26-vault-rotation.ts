// Smoke: vault key rotation (C3). The vault can rotate APICAL_VAULT_KEY with no
// downtime: a new primary key encrypts new data while a previous key still
// decrypts old data, and a rotation pass re-encrypts everything to the new key.
// Run: bun scripts/smoke/26-vault-rotation.ts

import { encrypt, decrypt, reencryptToPrimary } from '../../src/lib/platform/vault'

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error(`FAIL: ${msg}`)
    process.exit(1)
  }
}

const prevKey = process.env.APICAL_VAULT_KEY
const prevPrevious = process.env.APICAL_VAULT_KEY_PREVIOUS

function setKeys(primary: string, previous?: string) {
  process.env.APICAL_VAULT_KEY = primary
  if (previous) process.env.APICAL_VAULT_KEY_PREVIOUS = previous
  else delete process.env.APICAL_VAULT_KEY_PREVIOUS
}

const KEY_A = 'vault-key-alpha-000000000000000000'
const KEY_B = 'vault-key-bravo-111111111111111111'
const secret = 'sk-super-secret-credential-value'

// 1) Encrypt under key A.
setKeys(KEY_A)
const blobA = encrypt(secret)
assert(decrypt(blobA) === secret, 'round-trips under the original key')
console.log('baseline: encrypt/decrypt under key A')

// 2) Rotate — B is primary, A is the previous (decrypt-only) key. Old data
// still decrypts; new data is written under B.
setKeys(KEY_B, KEY_A)
assert(decrypt(blobA) === secret, 'old blob still decrypts via the previous key during rotation')
const blobB = encrypt(secret)
assert(decrypt(blobB) === secret, 'new blob encrypts + decrypts under the new key')
console.log('rotation: old blobs read via previous key, new blobs written under the new key')

// 3) Re-encrypt an old blob to the primary key; an already-primary blob is left
// as-is (so a rotation pass is idempotent).
const migrated = reencryptToPrimary(blobA)
assert(migrated !== blobA, 'the A-blob is re-encrypted to a new blob')
assert(decrypt(migrated) === secret, 'the migrated blob decrypts')
assert(reencryptToPrimary(blobB) === blobB, 'an already-primary blob is returned unchanged')
console.log('re-encrypt: migrates old blobs to the primary key, idempotent on current ones')

// 4) Drop the previous key (rotation complete). Old-key data is now unreadable;
// migrated data still reads under B alone.
setKeys(KEY_B)
let failed = false
try {
  decrypt(blobA)
} catch {
  failed = true
}
assert(failed, 'once the previous key is dropped, old-key blobs no longer decrypt')
assert(decrypt(migrated) === secret, 'migrated blobs still decrypt under the new key alone')
console.log('finalize: after dropping the previous key, only migrated data remains readable')

// Restore.
if (prevKey === undefined) delete process.env.APICAL_VAULT_KEY
else process.env.APICAL_VAULT_KEY = prevKey
if (prevPrevious === undefined) delete process.env.APICAL_VAULT_KEY_PREVIOUS
else process.env.APICAL_VAULT_KEY_PREVIOUS = prevPrevious

console.log('OK: 26-vault-rotation')
process.exit(0)
