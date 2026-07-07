// One-time backfill: widen legacy empty-scope API keys to explicit full
// scopes, so flipping keyHasScope to fail-closed (empty = no access) changes
// no existing key's effective access.
//
// Before this migration, `scopesJson: "[]"` meant ALL scopes (fail-open).
// After the flip it would mean NONE. Every key that still carries the empty
// sentinel had full access, so we record that access explicitly here.
//
// Idempotent — safe to run repeatedly. Run once against each environment's DB
// BEFORE deploying the fail-closed change:
//   bun prisma/backfill-key-scopes.ts
//
// Run with DATABASE_URL / DIRECT_URL pointed at the target database.

import { PrismaClient } from '@prisma/client'
import { ALL_SCOPES } from '../src/lib/api-key-auth'

const db = new PrismaClient()

function isEmptyScopes(scopesJson: string | null | undefined): boolean {
  if (!scopesJson || !scopesJson.trim()) return true
  try {
    const parsed = JSON.parse(scopesJson) as unknown
    return Array.isArray(parsed) && parsed.length === 0
  } catch {
    // Unparseable → treat as empty so it gets an explicit, valid value.
    return true
  }
}

async function main() {
  const keys = await db.apiKey.findMany({ select: { id: true, scopesJson: true } })
  const stale = keys.filter((k) => isEmptyScopes(k.scopesJson))
  console.log(`[backfill-key-scopes] ${keys.length} keys, ${stale.length} with empty scopes → full scopes`)

  const full = JSON.stringify(ALL_SCOPES)
  let updated = 0
  for (const k of stale) {
    await db.apiKey.update({ where: { id: k.id }, data: { scopesJson: full } })
    updated++
  }
  console.log(`[backfill-key-scopes] updated ${updated} key(s).`)
}

main()
  .catch((err) => {
    console.error('[backfill-key-scopes] failed:', err)
    process.exit(1)
  })
  .finally(() => void db.$disconnect())
