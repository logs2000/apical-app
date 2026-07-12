// Backfill: widen legacy empty-scope API keys to explicit full scopes, so the
// fail-closed keyHasScope (empty = no access) changes no existing key's
// effective access. Before the flip, `scopesJson: "[]"` meant ALL scopes
// (fail-open); every key still carrying the empty sentinel had full access, so
// we record that access explicitly.
//
// Idempotent — safe to run repeatedly. Registered in the ordered backfill
// runner (prisma/backfill/run.ts), which runs after `prisma migrate deploy`.
// Can also be run standalone: `bun prisma/backfill-key-scopes.ts`.

import { PrismaClient } from '@prisma/client'
import { ALL_SCOPES } from '../src/lib/api-key-auth'

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

/** Idempotent. Accepts a shared PrismaClient (from the runner) or makes its own. */
export async function backfillKeyScopes(db: PrismaClient): Promise<{ updated: number }> {
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
  return { updated }
}

// Standalone execution.
if (import.meta.main) {
  const db = new PrismaClient()
  backfillKeyScopes(db)
    .catch((err) => {
      console.error('[backfill-key-scopes] failed:', err)
      process.exit(1)
    })
    .finally(() => void db.$disconnect())
}
