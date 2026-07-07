// Smoke: code_eval + script env isolation. Proves a script (even one that
// escapes the JS context) cannot read platform secrets from the environment.
// Run: bun scripts/smoke/08-exec-isolation.ts

import { runCodeEval } from '../../src/lib/platform/script-runner'

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error(`FAIL: ${msg}`)
    process.exit(1)
  }
}

// Seed a fake secret in the PARENT env — it must NOT be visible to eval'd code.
process.env.APICAL_VAULT_KEY = 'super-secret-vault-key-should-not-leak'
process.env.DATABASE_URL = 'postgresql://should-not-leak'

// 1. Normal computation still works.
const ok = await runCodeEval('return [1,2,3].map(x=>x*2)')
assert(ok.ok, `basic eval failed: ${ok.error}`)
assert(JSON.stringify(ok.result) === JSON.stringify([2, 4, 6]), `wrong result: ${JSON.stringify(ok.result)}`)
console.log(`compute: [1,2,3]*2 = ${JSON.stringify(ok.result)}`)

// 2. data binding works.
const withData = await runCodeEval('return data.n + 1', { n: 41 })
assert(withData.result === 42, `data binding failed: ${JSON.stringify(withData.result)}`)

// 3. console logs are captured.
const logged = await runCodeEval('console.log("hello"); return 1')
assert((logged.logs ?? '').includes('hello'), 'logs not captured')

// 4. THE KEY TEST: the classic sandbox escape must NOT reach secrets.
const escape = await runCodeEval(
  'try { const p = this.constructor.constructor("return process")(); return { vault: p.env.APICAL_VAULT_KEY || null, db: p.env.DATABASE_URL || null }; } catch (e) { return { err: String(e) }; }',
)
// Either the escape is blocked (err) OR it reaches a process with NO secrets.
const out = (escape.result ?? {}) as { vault?: string | null; db?: string | null; err?: string }
assert(!out.vault, `LEAKED vault key via escape: ${out.vault}`)
assert(!out.db, `LEAKED database url via escape: ${out.db}`)
console.log(`escape attempt: ${out.err ? 'blocked' : 'reached a scrubbed process (no secrets)'} — vault=${out.vault ?? 'null'} db=${out.db ?? 'null'}`)

// 5. Direct process.env read returns nothing sensitive.
const envRead = await runCodeEval('return { vault: process.env.APICAL_VAULT_KEY || null, db: process.env.DATABASE_URL || null }')
const er = (envRead.result ?? {}) as { vault?: string | null; db?: string | null }
assert(!er.vault && !er.db, `LEAKED secrets via process.env: ${JSON.stringify(er)}`)
console.log(`process.env read: vault=${er.vault ?? 'null'} db=${er.db ?? 'null'}`)

console.log('OK: 08-exec-isolation')
process.exit(0)
