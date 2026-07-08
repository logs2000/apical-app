/// <reference types="bun-types" />
// Unit: vault crypto core — round-trips, tamper detection, the looksEncrypted
// classifier (the historical plaintext-leak bug), and key rotation.
import { test, expect, describe, beforeEach, afterEach } from 'bun:test'
import { encrypt, decrypt, looksEncrypted, reencryptToPrimary } from '../../src/lib/platform/vault'

const savedKey = process.env.APICAL_VAULT_KEY
const savedPrev = process.env.APICAL_VAULT_KEY_PREVIOUS

beforeEach(() => {
  process.env.APICAL_VAULT_KEY = 'unit-test-vault-key-000000000000'
  delete process.env.APICAL_VAULT_KEY_PREVIOUS
})
afterEach(() => {
  if (savedKey === undefined) delete process.env.APICAL_VAULT_KEY
  else process.env.APICAL_VAULT_KEY = savedKey
  if (savedPrev === undefined) delete process.env.APICAL_VAULT_KEY_PREVIOUS
  else process.env.APICAL_VAULT_KEY_PREVIOUS = savedPrev
})

describe('encrypt/decrypt', () => {
  test('round-trips arbitrary strings', () => {
    // Callers never encrypt empty strings (they check .trim() first), so the
    // supported domain is non-empty values.
    for (const s of ['hello', 'user:pass:host', 'sk-ant-xxx', '🔐 unicode', 'a'.repeat(5000)]) {
      expect(decrypt(encrypt(s))).toBe(s)
    }
  })
  test('produces a fresh IV each time (ciphertexts differ)', () => {
    expect(encrypt('same')).not.toBe(encrypt('same'))
  })
  test('rejects a tampered blob', () => {
    const blob = encrypt('secret')
    const [iv, tag, ct] = blob.split(':')
    const flipped = ct[0] === 'A' ? 'B' : 'A'
    expect(() => decrypt([iv, tag, flipped + ct.slice(1)].join(':'))).toThrow()
  })
  test('rejects malformed input', () => {
    expect(() => decrypt('not-a-blob')).toThrow()
    expect(() => decrypt('a:b')).toThrow()
  })
})

describe('looksEncrypted', () => {
  test('accepts real vault blobs', () => {
    expect(looksEncrypted(encrypt('x'))).toBe(true)
  })
  test('rejects 2-colon and connection-string-shaped secrets (the leak bug)', () => {
    for (const s of ['user:pass:host', 'postgres://a:b@c', 'aaa:bbb:ccc', 'sk-ant-abc', '']) {
      expect(looksEncrypted(s)).toBe(false)
    }
  })
})

describe('key rotation', () => {
  test('a previous key decrypts old data while the primary writes new data', () => {
    process.env.APICAL_VAULT_KEY = 'rot-key-A-00000000000000000000000'
    const old = encrypt('secret')
    process.env.APICAL_VAULT_KEY = 'rot-key-B-11111111111111111111111'
    process.env.APICAL_VAULT_KEY_PREVIOUS = 'rot-key-A-00000000000000000000000'
    expect(decrypt(old)).toBe('secret') // via previous key
    const migrated = reencryptToPrimary(old)
    expect(migrated).not.toBe(old)
    expect(decrypt(migrated)).toBe('secret')
    // Idempotent on a primary-key blob.
    expect(reencryptToPrimary(migrated)).toBe(migrated)
    // Drop the previous key: old is unreadable, migrated still reads.
    delete process.env.APICAL_VAULT_KEY_PREVIOUS
    expect(() => decrypt(old)).toThrow()
    expect(decrypt(migrated)).toBe('secret')
  })
})
