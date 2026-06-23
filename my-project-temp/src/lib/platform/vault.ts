// Apical vault — encryption-at-rest for BYOK API keys and data-connection
// configs. Uses AES-256-GCM with a key derived from APICAL_VAULT_KEY.
//
// In dev the env var is set to a placeholder; in production it MUST be a
// 32-byte random secret (openssl rand -base64 32). The plaintext is never
// persisted — only the ciphertext + IV + auth tag.

import { createCipheriv, createDecipheriv, randomBytes, pbkdf2Sync } from 'crypto'

const VAULT_KEY_ENV = process.env.APICAL_VAULT_KEY ?? 'apical-dev-vault-key-change-in-production-32b!'
const SALT = 'apical-vault-salt-v1' // stable; the env secret is the real secret

// Derive a 32-byte key from the env secret via PBKDF2 (stable across restarts).
const KEY = pbkdf2Sync(VAULT_KEY_ENV, SALT, 100_000, 32, 'sha256')

export interface EncryptedBlob {
  // "<iv>:<authTag>:<ciphertext>" — all base64.
  serialized: string
}

export function encrypt(plaintext: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', KEY, iv)
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
  const decipher = createDecipheriv('aes-256-gcm', KEY, iv)
  decipher.setAuthTag(tag)
  const pt = Buffer.concat([decipher.update(ct), decipher.final()])
  return pt.toString('utf8')
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
    case 'deepseek':
      return k.startsWith('sk-')
    case 'anthropic':
      return k.startsWith('sk-ant-')
    case 'google':
      return k.startsWith('AIza')
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
