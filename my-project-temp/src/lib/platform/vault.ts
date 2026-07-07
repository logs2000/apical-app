// Apical vault — encryption-at-rest for BYOK API keys and data-connection
// configs. Uses AES-256-GCM with a key derived from APICAL_VAULT_KEY.
//
// SECURITY: in production APICAL_VAULT_KEY is REQUIRED — the vault fails
// closed (throws at first use) rather than silently encrypting everything
// with a publicly-known fallback key. In local dev, a dev-only fallback is
// allowed so the app boots without setup, but a warning is logged.

import { createCipheriv, createDecipheriv, randomBytes, pbkdf2Sync } from 'crypto'

const SALT = 'apical-vault-salt-v1' // stable; the env secret is the real secret

function resolveVaultKeyMaterial(): string {
  const fromEnv = process.env.APICAL_VAULT_KEY
  if (fromEnv && fromEnv.trim()) return fromEnv.trim()
  if (process.env.NODE_ENV !== 'production') {
    console.warn(
      '[vault] APICAL_VAULT_KEY is not set — using the DEV-ONLY fallback key. ' +
        'Set a random 32+ char secret before storing real credentials.',
    )
    return 'apical-dev-vault-key-change-in-production-32b!'
  }
  throw new Error(
    'APICAL_VAULT_KEY must be set in production. Generate one with ' +
      '`openssl rand -base64 32` and set it in the environment.',
  )
}

// Derive a 32-byte key from the env secret via PBKDF2 (stable across
// restarts). Lazy so a missing key in production fails at first vault use
// with a clear error instead of crashing every module that imports this file.
let KEY: Buffer | null = null
function getKey(): Buffer {
  if (!KEY) {
    KEY = pbkdf2Sync(resolveVaultKeyMaterial(), SALT, 100_000, 32, 'sha256')
  }
  return KEY
}

export interface EncryptedBlob {
  // "<iv>:<authTag>:<ciphertext>" — all base64.
  serialized: string
}

export function encrypt(plaintext: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', getKey(), iv)
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join(':')
}

export function decrypt(serialized: string): string {
  const [ivB64, tagB64, ctB64] = serialized.split(':')
  if (!ivB64 || !tagB64 || !ctB64) throw new Error('Invalid ciphertext format')
  const iv = Buffer.from(ivB64, 'base64')
  const tag = Buffer.from(tagB64, 'base64')
  const ct = Buffer.from(ctB64, 'base64')
  const decipher = createDecipheriv('aes-256-gcm', getKey(), iv)
  decipher.setAuthTag(tag)
  const pt = Buffer.concat([decipher.update(ct), decipher.final()])
  return pt.toString('utf8')
}

// ---------------- Secret meta-field helpers ----------------

/** metaJson keys that hold secret values and must be encrypted at rest. */
export const SECRET_META_FIELDS = new Set([
  'key',
  'token',
  'apikey',
  'api_key',
  'secret',
  'accesstoken',
  'access_token',
  'refreshtoken',
  'refresh_token',
  'bearer',
  'password',
  'clientsecret',
  'client_secret',
  'customclientsecret',
  'privatekey',
  'private_key',
])

/**
 * True when a string is a vault blob (`iv:tag:ct`, all base64, with the exact
 * AES-256-GCM byte lengths: iv=12, tag=16). The old check — "3 parts split on
 * ':'" — misclassified any secret containing two colons (a connection string,
 * a `user:pass:host` token) as already-encrypted, so encryptSecretMetaFields
 * skipped it and stored the plaintext. Validating base64 + the GCM sizes makes
 * a false positive on real secret input effectively impossible, while every
 * genuine blob (produced by encrypt()) still matches.
 */
export function looksEncrypted(value: string): boolean {
  const parts = value.split(':')
  if (parts.length !== 3) return false
  const [ivB64, tagB64, ctB64] = parts
  const isBase64 = (s: string) => s.length > 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(s)
  if (!isBase64(ivB64) || !isBase64(tagB64) || !isBase64(ctB64)) return false
  try {
    return Buffer.from(ivB64, 'base64').length === 12 && Buffer.from(tagB64, 'base64').length === 16
  } catch {
    return false
  }
}

/**
 * Encrypt every secret-shaped string field in a credential meta object.
 * Non-secret fields and already-encrypted values pass through unchanged.
 */
export function encryptSecretMetaFields(
  meta: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(meta)) {
    if (
      SECRET_META_FIELDS.has(k.toLowerCase()) &&
      typeof v === 'string' &&
      v.trim() &&
      !looksEncrypted(v)
    ) {
      out[k] = encrypt(v)
    } else {
      out[k] = v
    }
  }
  return out
}

/**
 * Redact secret-shaped fields for display (API responses / UI). Encrypted
 * blobs and plaintext secrets are both replaced with a mask.
 */
export function redactSecretMetaFields(
  meta: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(meta)) {
    if (SECRET_META_FIELDS.has(k.toLowerCase()) && typeof v === 'string' && v) {
      out[k] = '••••••••'
    } else {
      out[k] = v
    }
  }
  return out
}

// Mask a key for display: show the first `head` and last `tail` chars.
export function maskKey(key: string, head = 4, tail = 4): string {
  if (key.length <= head + tail + 1) return '••••'
  return `${key.slice(0, head)}…${key.slice(-tail)}`
}

// Validate that a key looks plausible for a provider (basic shape check).
export function looksLikeKey(provider: string, key: string): boolean {
  const k = key.trim()
  if (k.length < 10) return false
  switch (provider) {
    case 'openai':
      return k.startsWith('sk-')
    case 'anthropic':
      return k.startsWith('sk-ant-')
    case 'google':
      return k.startsWith('AIza')
    case 'xai':
      return k.startsWith('xai-')
    case 'openrouter':
      return k.startsWith('sk-or-')
    case 'groq':
      return k.startsWith('gsk_')
    case 'azure_openai':
      return k.length >= 20
    case 'ollama':
    case 'llamacpp':
    case 'vllm':
      return true // no key needed
    default:
      return true
  }
}
