// Ordered, idempotent backfill runner. Runs AFTER `prisma migrate deploy` as
// part of every release, so data backfills that must accompany a schema change
// can't be forgotten (the old contract was "remember to run backfill-*.ts by
// hand before deploy", which is trivially violated).
//
//   bun prisma/backfill/run.ts    (or: bun run db:backfill)
//
// Register each backfill below in the order it must run. Every backfill MUST be
// idempotent — the runner may execute on every deploy, and a backfill may run
// against a DB where it has already partially or fully applied.
//
// Note: prisma/backfill-workspaces.ts is a historical one-time db-push-era
// migration (takes export/import args) and is intentionally NOT registered here.

import { PrismaClient } from '@prisma/client'
import { backfillKeyScopes } from '../backfill-key-scopes'

interface Backfill {
  name: string
  run: (db: PrismaClient) => Promise<unknown>
}

const BACKFILLS: Backfill[] = [{ name: 'key-scopes', run: backfillKeyScopes }]

export async function runBackfills(db: PrismaClient): Promise<void> {
  console.log(`[backfill] running ${BACKFILLS.length} backfill(s)…`)
  for (const b of BACKFILLS) {
    console.log(`[backfill] → ${b.name}`)
    await b.run(db)
  }
  console.log('[backfill] all backfills complete')
}

if (import.meta.main) {
  const db = new PrismaClient()
  runBackfills(db)
    .catch((err) => {
      console.error('[backfill] failed:', err)
      process.exit(1)
    })
    .finally(() => void db.$disconnect())
}
