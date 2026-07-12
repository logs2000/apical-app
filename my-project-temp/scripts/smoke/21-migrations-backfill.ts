// Smoke: real migrations + ordered backfill runner (A3).
//   - the committed initial migration + lock exist; the destructive
//     `db push --accept-data-loss` is gone from package.json.
//   - the backfill runner is idempotent: it widens an empty-scope key to full
//     scopes, and a second run is a no-op.
// (The migration applying cleanly on a fresh DB with no drift is verified
// manually + in CI, which runs `prisma migrate deploy` against a fresh
// Postgres — too heavy/flaky to spin a database inside a unit smoke.)
// Run: bun scripts/smoke/21-migrations-backfill.ts

import { readFileSync, existsSync } from 'node:fs'
import { db } from '../../src/lib/db'
import { generateApiKey, ALL_SCOPES } from '../../src/lib/api-key-auth'
import { getWorkspaceForUser } from '../../src/lib/auth-helpers'
import { runBackfills } from '../../prisma/backfill/run'

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error(`FAIL: ${msg}`)
    process.exit(1)
  }
}

const root = new URL('../../', import.meta.url).pathname

// 1. Migration history is committed.
const initSql = `${root}prisma/migrations/0_init/migration.sql`
assert(existsSync(initSql), '0_init migration exists')
assert(readFileSync(initSql, 'utf8').includes('CREATE TABLE'), 'initial migration has table DDL')
const lock = `${root}prisma/migrations/migration_lock.toml`
assert(existsSync(lock) && readFileSync(lock, 'utf8').includes('postgresql'), 'migration_lock.toml declares postgresql')

// 2. No destructive push; deploy/backfill scripts present.
const pkg = JSON.parse(readFileSync(`${root}package.json`, 'utf8')) as { scripts: Record<string, string> }
assert(!JSON.stringify(pkg.scripts).includes('accept-data-loss'), 'no --accept-data-loss in scripts')
assert(pkg.scripts['db:migrate:deploy'] === 'prisma migrate deploy', 'db:migrate:deploy present')
assert(typeof pkg.scripts['db:backfill'] === 'string', 'db:backfill present')
console.log('migrations: committed 0_init + lock; destructive push removed; deploy/backfill scripts present')

// 3. Backfill idempotency against a seeded empty-scope key.
const user = await db.user.upsert({
  where: { email: 'smoke-backfill@apical.test' },
  create: { email: 'smoke-backfill@apical.test', name: 'Smoke Backfill' },
  update: {},
})
const workspace = await getWorkspaceForUser(user)
await db.apiKey.deleteMany({ where: { workspaceId: workspace.id, label: 'smoke-backfill' } })
const key = generateApiKey('ap_pat_')
const created = await db.apiKey.create({
  data: {
    workspaceId: workspace.id,
    createdById: user.id,
    label: 'smoke-backfill',
    keyHash: key.hash,
    keyPrefix: key.prefix,
    scopesJson: '[]', // the fail-open legacy sentinel
    status: 'active',
  },
})

await runBackfills(db)
const after1 = await db.apiKey.findUnique({ where: { id: created.id }, select: { scopesJson: true } })
assert(
  JSON.stringify(JSON.parse(after1!.scopesJson)) === JSON.stringify(ALL_SCOPES),
  'backfill widened empty scopes to full',
)

// Second run: no change, no error (idempotent).
await runBackfills(db)
const after2 = await db.apiKey.findUnique({ where: { id: created.id }, select: { scopesJson: true } })
assert(after2!.scopesJson === after1!.scopesJson, 'second backfill run is a no-op')
console.log('backfill: empty-scope key widened once, second run idempotent')

await db.apiKey.deleteMany({ where: { workspaceId: workspace.id, label: 'smoke-backfill' } })

console.log('OK: 21-migrations-backfill')
process.exit(0)
