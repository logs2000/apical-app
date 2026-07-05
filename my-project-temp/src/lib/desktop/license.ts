/**
 * Enterprise license verification (offline-capable).
 *
 * Licenses are compact signed tokens: base64url(payload).base64url(signature)
 * where signature = Ed25519-SHA512 over the payload JSON. The public key is
 * embedded in the app; the private key stays server-side for issuance.
 */

import { createPrivateKey, createPublicKey, sign, verify } from 'crypto'

export interface LicensePayload {
  org: string
  plan: 'enterprise'
  seats: number
  features: string[]
  expiresAt: string
}

/** Ed25519 public key (PEM). Replace with production key at ship time. */
const LICENSE_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAplaceholderReplaceWithRealEnterpriseLicensePublicKey==
-----END PUBLIC KEY-----`

function decodeBase64Url(s: string): Buffer {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/')
  const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4))
  return Buffer.from(padded + pad, 'base64')
}

export function parseLicenseToken(token: string): { payload: LicensePayload; raw: string } | null {
  const trimmed = token.trim()
  const dot = trimmed.lastIndexOf('.')
  if (dot <= 0) return null
  const payloadB64 = trimmed.slice(0, dot)
  const sigB64 = trimmed.slice(dot + 1)
  try {
    const payloadJson = decodeBase64Url(payloadB64).toString('utf8')
    const payload = JSON.parse(payloadJson) as LicensePayload
    if (!payload || payload.plan !== 'enterprise') return null
    if (!Array.isArray(payload.features) || !payload.features.includes('local_only'))
      return null
    return { payload, raw: trimmed }
  } catch {
    return null
  }
}

export interface LicenseVerifyResult {
  valid: boolean
  reason?: string
  payload?: LicensePayload
}

/** Verify a license token offline (no network). */
export function verifyLicenseToken(token: string): LicenseVerifyResult {
  const parsed = parseLicenseToken(token)
  if (!parsed) return { valid: false, reason: 'Malformed license token.' }

  const dot = token.trim().lastIndexOf('.')
  const payloadB64 = token.trim().slice(0, dot)
  const sigB64 = token.trim().slice(dot + 1)

  try {
    const key = createPublicKey(LICENSE_PUBLIC_KEY_PEM)
    const ok = verify(
      null,
      Buffer.from(payloadB64, 'utf8'),
      key,
      decodeBase64Url(sigB64),
    )
    if (!ok) return { valid: false, reason: 'Invalid signature.' }
  } catch {
    return { valid: false, reason: 'License verification failed.' }
  }

  const expiresAt = new Date(parsed.payload.expiresAt)
  if (Number.isNaN(expiresAt.getTime())) {
    return { valid: false, reason: 'Invalid expiry date.' }
  }
  if (expiresAt.getTime() < Date.now()) {
    return { valid: false, reason: 'License expired.' }
  }

  return { valid: true, payload: parsed.payload }
}

/** Issue a signed license (server-side only — requires APICAL_LICENSE_PRIVATE_KEY_PEM). */
export function issueLicenseToken(payload: LicensePayload): string | null {
  const privatePem = process.env.APICAL_LICENSE_PRIVATE_KEY_PEM?.trim()
  if (!privatePem) return null
  try {
    const key = createPrivateKey(privatePem)
    const payloadJson = JSON.stringify(payload)
    const payloadB64 = Buffer.from(payloadJson, 'utf8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
    const sig = sign(null, Buffer.from(payloadB64, 'utf8'), key)
    const sigB64 = sig
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
    return `${payloadB64}.${sigB64}`
  } catch {
    return null
  }
}
