// Vault key rotation: re-encrypt every stored secret under the current PRIMARY
// APICAL_VAULT_KEY. Idempotent — a blob already under the primary key is left
// untouched (reencryptToPrimary is a no-op for it).
//
// Rotation procedure (zero downtime):
//   1. Generate a new key:  openssl rand -base64 32
//   2. Deploy with APICAL_VAULT_KEY=<new> and APICAL_VAULT_KEY_PREVIOUS=<old>.
//      New writes use <new>; existing data still decrypts via <old>.
//   3. Run this script:  bun prisma/rotate-vault.ts   (or: bun run db:rotate-vault)
//   4. Once it reports 0 remaining, drop APICAL_VAULT_KEY_PREVIOUS and redeploy.
//
// Safe to re-run; safe to run before/after step 4 (it just finds nothing to do).

import { PrismaClient } from '@prisma/client'
import { reencryptToPrimary, looksEncrypted, SECRET_META_FIELDS } from '../src/lib/platform/vault'

const db = new PrismaClient()

let changed = 0
let scanned = 0

/** Re-encrypt a single blob column; returns the new value if it changed. */
function rotateBlob(value: string | null): string | null {
  if (!value || !looksEncrypted(value)) return value
  scanned++
  const next = reencryptToPrimary(value)
  if (next !== value) changed++
  return next
}

/** Re-encrypt the secret-shaped string fields inside a metaJson blob. */
function rotateMeta(metaJson: string | null): string | null {
  if (!metaJson) return metaJson
  let meta: Record<string, unknown>
  try {
    meta = JSON.parse(metaJson) as Record<string, unknown>
  } catch {
    return metaJson
  }
  let touched = false
  for (const [k, v] of Object.entries(meta)) {
    if (SECRET_META_FIELDS.has(k.toLowerCase()) && typeof v === 'string' && looksEncrypted(v)) {
      scanned++
      const next = reencryptToPrimary(v)
      if (next !== v) {
        meta[k] = next
        touched = true
        changed++
      }
    }
  }
  return touched ? JSON.stringify(meta) : metaJson
}

async function main() {
  // ByokKey.encryptedKey
  for (const row of await db.byokKey.findMany({ select: { id: true, encryptedKey: true } })) {
    const next = rotateBlob(row.encryptedKey)
    if (next !== row.encryptedKey && next) {
      await db.byokKey.update({ where: { id: row.id }, data: { encryptedKey: next } })
    }
  }

  // Credential: oauth tokens + secret meta fields.
  for (const row of await db.credential.findMany({
    select: { id: true, oauthAccessToken: true, oauthRefreshToken: true, metaJson: true },
  })) {
    const data: Record<string, string | null> = {}
    const at = rotateBlob(row.oauthAccessToken)
    if (at !== row.oauthAccessToken) data.oauthAccessToken = at
    const rt = rotateBlob(row.oauthRefreshToken)
    if (rt !== row.oauthRefreshToken) data.oauthRefreshToken = rt
    const meta = rotateMeta(row.metaJson)
    if (meta !== row.metaJson) data.metaJson = meta
    if (Object.keys(data).length) await db.credential.update({ where: { id: row.id }, data })
  }

  // OAuthState.customClientSecret (short-lived, but rotate for completeness).
  for (const row of await db.oAuthState.findMany({ select: { state: true, customClientSecret: true } })) {
    const next = rotateBlob(row.customClientSecret)
    if (next && next !== row.customClientSecret) {
      await db.oAuthState.update({ where: { state: row.state }, data: { customClientSecret: next } })
    }
  }

  // DataConnection + IntegrationSession metaJson secret fields.
  for (const row of await db.dataConnection.findMany({ select: { id: true, metaJson: true } })) {
    const meta = rotateMeta(row.metaJson)
    if (meta && meta !== row.metaJson) {
      await db.dataConnection.update({ where: { id: row.id }, data: { metaJson: meta } })
    }
  }
  for (const row of await db.integrationSession.findMany({ select: { id: true, metaJson: true } })) {
    const meta = rotateMeta(row.metaJson)
    if (meta && meta !== row.metaJson) {
      await db.integrationSession.update({ where: { id: row.id }, data: { metaJson: meta } })
    }
  }

  console.log(`[rotate-vault] scanned ${scanned} secret(s), re-encrypted ${changed} to the primary key.`)
  if (changed === 0) {
    console.log('[rotate-vault] nothing left under an old key — safe to drop APICAL_VAULT_KEY_PREVIOUS.')
  }
}

main()
  .catch((err) => {
    console.error('[rotate-vault] failed:', err)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
