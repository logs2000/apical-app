// Smoke: /api/health liveness + readiness (A6). It is public and
// unauthenticated, so it must report only booleans + an overall status, leak no
// secrets, never cache, and return 200 while serving / 503 when the DB is down.
// Run: bun scripts/smoke/23-health.ts

import { GET } from '../../src/app/api/health/route'

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error(`FAIL: ${msg}`)
    process.exit(1)
  }
}

// Postgres is up in the smoke env → serving, HTTP 200.
const res = await GET()
assert(res.status === 200, `DB is up → expect HTTP 200, got ${res.status}`)

const body = (await res.json()) as {
  status: string
  checks: { database: boolean; config: boolean }
  uptimeSeconds: number
  tookMs: number
}
assert(body.checks?.database === true, 'database check true when Postgres reachable')
assert(['ok', 'degraded'].includes(body.status), `status should be ok|degraded when DB up, got ${body.status}`)
assert(typeof body.checks.config === 'boolean', 'config check is a boolean')
assert(typeof body.uptimeSeconds === 'number', 'uptimeSeconds present')
assert(res.headers.get('cache-control') === 'no-store', 'health must not be cached')

// No secret leakage: neither env values nor the names of missing vars.
const raw = JSON.stringify(body)
for (const leak of [
  'DATABASE_URL',
  'APICAL_VAULT_KEY',
  'NEXTAUTH_SECRET',
  'SUPABASE',
  'postgres://',
  'postgresql://',
]) {
  assert(!raw.includes(leak), `health body must not leak "${leak}"`)
}

console.log(`health: status=${body.status}, database=${body.checks.database}, config=${body.checks.config}`)
console.log('OK: 23-health')
process.exit(0)
