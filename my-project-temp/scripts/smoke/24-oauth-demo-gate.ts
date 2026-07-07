// Smoke: demo OAuth is off in production (B2). Demo connections mint a
// fake-but-active credential, so a launched product must not offer them — a
// user would see a provider as "Connected" when nothing is. Verifies the policy
// gate that both /api/oauth/start and /api/oauth/demo-connect enforce.
// Run: bun scripts/smoke/24-oauth-demo-gate.ts

import { demoOAuthAllowed } from '../../src/lib/env'

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error(`FAIL: ${msg}`)
    process.exit(1)
  }
}

/** NODE_ENV is typed readonly; this test needs to flip it. */
function setNodeEnv(v: string) {
  ;(process.env as Record<string, string>).NODE_ENV = v
}

const prevNodeEnv = process.env.NODE_ENV ?? 'test'
const prevOptIn = process.env.ALLOW_DEMO_OAUTH
delete process.env.ALLOW_DEMO_OAUTH

// Production, no opt-in → demo OAuth is refused.
setNodeEnv('production')
assert(demoOAuthAllowed() === false, 'production without opt-in → demo OAuth disabled')
console.log('gate: production disables demo OAuth (no fake "Connected")')

// Production + explicit opt-in (a sales-demo instance) → allowed.
process.env.ALLOW_DEMO_OAUTH = 'true'
assert(demoOAuthAllowed() === true, 'production + ALLOW_DEMO_OAUTH=true → allowed')
console.log('opt-in: ALLOW_DEMO_OAUTH=true re-enables it for demo instances')
delete process.env.ALLOW_DEMO_OAUTH

// Dev / preview → allowed (handy for local demos).
setNodeEnv('development')
assert(demoOAuthAllowed() === true, 'development → demo OAuth allowed')
console.log('dev: demo OAuth allowed outside production')

// Restore.
setNodeEnv(prevNodeEnv)
if (prevOptIn === undefined) delete process.env.ALLOW_DEMO_OAUTH
else process.env.ALLOW_DEMO_OAUTH = prevOptIn

console.log('OK: 24-oauth-demo-gate')
process.exit(0)
