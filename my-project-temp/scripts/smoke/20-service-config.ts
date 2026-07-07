// Smoke: service-URL centralization + boot-time env validation (A1).
//   - RELAY_URL / BRIDGE_URL / AGENT_WORKER_URL resolve from env, default to
//     localhost, and strip trailing slashes; BRIDGE_INVOKE_URL appends /invoke.
//   - checkEnv() reports missing hard-required vars and never throws; assertEnv
//     throws in production when a hard var is missing, warns otherwise.
// Run: bun scripts/smoke/20-service-config.ts

import { resolveServiceUrls } from '../../src/lib/service-urls'
import { checkEnv, assertEnv } from '../../src/lib/env'

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

// 1. Defaults (empty env).
{
  const m = resolveServiceUrls({})
  assert(m.RELAY_URL === 'http://localhost:3003', `relay default: ${m.RELAY_URL}`)
  assert(m.BRIDGE_URL === 'http://localhost:3005', `bridge default: ${m.BRIDGE_URL}`)
  assert(m.BRIDGE_INVOKE_URL === 'http://localhost:3005/invoke', `invoke default: ${m.BRIDGE_INVOKE_URL}`)
  assert(m.AGENT_WORKER_URL === 'http://localhost:3006', `worker default: ${m.AGENT_WORKER_URL}`)
}

// 2. Env overrides + trailing-slash strip + legacy DESKTOP_BRIDGE_URL fallback.
{
  const m = resolveServiceUrls({ RELAY_URL: 'https://relay.example.com/', DESKTOP_BRIDGE_URL: 'https://bridge.example.com//' })
  assert(m.RELAY_URL === 'https://relay.example.com', `relay override: ${m.RELAY_URL}`)
  assert(m.BRIDGE_URL === 'https://bridge.example.com', `bridge legacy fallback: ${m.BRIDGE_URL}`)
  assert(m.BRIDGE_INVOKE_URL === 'https://bridge.example.com/invoke', `invoke override: ${m.BRIDGE_INVOKE_URL}`)
}
// BRIDGE_URL wins over the legacy DESKTOP_BRIDGE_URL when both are set.
assert(
  resolveServiceUrls({ BRIDGE_URL: 'https://a.co', DESKTOP_BRIDGE_URL: 'https://b.co' }).BRIDGE_URL === 'https://a.co',
  'BRIDGE_URL precedence over DESKTOP_BRIDGE_URL',
)
console.log('service-urls: defaults, env overrides, trailing-slash strip, legacy fallback + precedence')

// 3. Env validation.
const saved = { ...process.env }
// Missing a hard-required var → report.ok false, but checkEnv never throws.
delete process.env.DATABASE_URL
const report = checkEnv()
assert(report.ok === false && report.missingHard.includes('DATABASE_URL'), 'checkEnv flags missing DATABASE_URL')
assert(Array.isArray(report.lines) && report.lines.length > 0, 'checkEnv returns a checklist')

// assertEnv: throws in production, warns (does not throw) otherwise.
const prevNodeEnv = process.env.NODE_ENV ?? 'test'
setNodeEnv('production')
let threw = false
try {
  assertEnv()
} catch {
  threw = true
}
assert(threw, 'assertEnv throws in production when a hard var is missing')

setNodeEnv('development')
let threwDev = false
try {
  assertEnv()
} catch {
  threwDev = true
}
assert(!threwDev, 'assertEnv only warns (no throw) outside production')
console.log('env: checkEnv reports without throwing; assertEnv fails fast in production only')

// Restore.
setNodeEnv(prevNodeEnv)
for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k]
Object.assign(process.env, saved)

console.log('OK: 20-service-config')
process.exit(0)
