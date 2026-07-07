// Smoke: desktop-bridge /invoke authentication (audit: /invoke was an
// unauthenticated remote-execution surface on port 3005 — anything that could
// reach the port could drive fs/cli on a connected desktop). Boots the real
// mini-service and proves:
//   - it refuses to START without APICAL_BRIDGE_SECRET (fail closed)
//   - /invoke without / with a wrong secret → 401 before any work
//   - /invoke with the right secret proceeds to session lookup
//   - the Next proxy route refuses to forward when the secret is unset,
//     and forwards (reaching desktop_offline) when configured
// Run: bun scripts/smoke/11-bridge-auth.ts

import { spawn } from 'node:child_process'
import { db } from '../../src/lib/db'
import { generateApiKey, getWorkspaceForUser } from '../../src/lib/api-key-auth'

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error(`FAIL: ${msg}`)
    process.exit(1)
  }
}

const SECRET = 'smoke-bridge-secret-abc123'
const BRIDGE = 'http://127.0.0.1:3005'
const serviceDir = new URL('../../mini-services/desktop-bridge/', import.meta.url).pathname

// 1) Fail-closed startup: no APICAL_BRIDGE_SECRET → process exits nonzero.
const { APICAL_BRIDGE_SECRET: _drop, ...envWithoutSecret } = process.env
const noSecret = spawn('bun', ['index.ts'], { cwd: serviceDir, env: envWithoutSecret })
const noSecretExit: number = await new Promise((resolve) => noSecret.on('exit', (code) => resolve(code ?? -1)))
assert(noSecretExit !== 0, 'bridge should refuse to start without APICAL_BRIDGE_SECRET')
console.log('startup: refuses to boot without APICAL_BRIDGE_SECRET')

// 2) Boot the bridge for real with a secret.
const bridge = spawn('bun', ['index.ts'], {
  cwd: serviceDir,
  env: { ...process.env, APICAL_BRIDGE_SECRET: SECRET },
  stdio: ['ignore', 'pipe', 'pipe'],
})
const kill = () => {
  try {
    bridge.kill('SIGKILL')
  } catch {
    /* already dead */
  }
}
process.on('exit', kill)

let up = false
for (let i = 0; i < 50; i++) {
  try {
    const r = await fetch(`${BRIDGE}/health`)
    if (r.ok) {
      up = true
      break
    }
  } catch {
    /* not yet */
  }
  await new Promise((r) => setTimeout(r, 200))
}
assert(up, 'bridge did not come up on :3005')

const invoke = (secret: string | null, body: Record<string, unknown>) =>
  fetch(`${BRIDGE}/invoke`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(secret ? { 'x-bridge-secret': secret } : {}) },
    body: JSON.stringify(body),
  })

// 3) No secret / wrong secret → 401. Right secret → passes auth, hits the
// session lookup (404 for a bogus session id).
const probe = { sessionId: 'nope', tool: 'desktop.fs.list', args: { path: '/tmp' } }
assert((await invoke(null, probe)).status === 401, 'missing secret should be 401')
assert((await invoke('wrong-secret', probe)).status === 401, 'wrong secret should be 401')
const authed = await invoke(SECRET, probe)
assert(authed.status === 404, `right secret should reach session lookup (404), got ${authed.status}`)
console.log('invoke: unauthenticated 401, authenticated request proceeds')

// 4) Next proxy route: fail-closed without the secret; forwards with it.
const user = await db.user.upsert({
  where: { email: 'smoke-bridge@apical.test' },
  create: { email: 'smoke-bridge@apical.test', name: 'Smoke Bridge' },
  update: {},
})
const workspace = await getWorkspaceForUser(user)
const key = generateApiKey('ap_pat_')
await db.apiKey.deleteMany({ where: { workspaceId: workspace.id, label: 'smoke-bridge' } })
await db.apiKey.create({
  data: { workspaceId: workspace.id, createdById: user.id, label: 'smoke-bridge', keyHash: key.hash, keyPrefix: key.prefix },
})
await db.desktopSession.deleteMany({ where: { userId: user.id } })
const session = await db.desktopSession.create({
  data: { userId: user.id, sessionToken: `dsk_smoke_${Date.now()}`, label: 'Smoke Desktop' },
})

const { POST } = await import('../../src/app/api/desktop/bridge/invoke/route')
const callProxy = () =>
  POST(
    new Request('http://smoke.local/api/desktop/bridge/invoke', {
      method: 'POST',
      headers: { authorization: `Bearer ${key.raw}`, 'content-type': 'application/json' },
      // desktop.notify: no granted-folder prerequisite, so the request exercises
      // the secret handling + forward instead of the fs sandbox gate.
      body: JSON.stringify({ sessionId: session.id, tool: 'desktop.notify', args: { title: 'smoke' } }),
    }),
    { params: Promise.resolve({}) },
  )

delete process.env.APICAL_BRIDGE_SECRET
const unconfigured = await callProxy()
const unconfiguredBody = (await unconfigured.json()) as { error?: string }
assert(
  unconfigured.status === 503 && unconfiguredBody.error === 'bridge_not_configured',
  `proxy without secret should 503 bridge_not_configured, got ${unconfigured.status} ${unconfiguredBody.error}`,
)

process.env.APICAL_BRIDGE_SECRET = SECRET
const forwarded = await callProxy()
const forwardedBody = (await forwarded.json()) as { error?: string }
assert(
  forwarded.status === 503 && forwardedBody.error === 'desktop_offline',
  `configured proxy should reach the bridge (desktop_offline), got ${forwarded.status} ${forwardedBody.error}`,
)
console.log('proxy: fail-closed without secret, forwards with it (desktop_offline as expected)')

// Cleanup.
await db.desktopSession.deleteMany({ where: { userId: user.id } })
await db.apiKey.deleteMany({ where: { workspaceId: workspace.id, label: 'smoke-bridge' } })
kill()

console.log('OK: 11-bridge-auth')
process.exit(0)
