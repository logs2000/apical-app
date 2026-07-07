// Smoke: M-tier hardening fixes.
//   1. POST /api/agent-runs clamps client-supplied maxIterations (was written
//      to optsJson raw — 1e9 became the engine's loop bound).
//   2. desktop-bridge validates desktop:job_update.status against the states
//      a desktop may report (was written to the row raw — a compromised
//      desktop could roll a job back to 'queued' or write garbage).
//   3. agent-worker /browser/* still rejects a missing/wrong x-worker-secret
//      after the switch to timingSafeEqual.
// Run: bun scripts/smoke/13-mtier.ts

import { spawn, type ChildProcess } from 'node:child_process'
import { db } from '../../src/lib/db'
import { generateApiKey, getWorkspaceForUser } from '../../src/lib/api-key-auth'

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error(`FAIL: ${msg}`)
    process.exit(1)
  }
}

const children: ChildProcess[] = []
const killAll = () => {
  for (const c of children) {
    try {
      c.kill('SIGKILL')
    } catch {
      /* dead */
    }
  }
}
process.on('exit', killAll)

async function waitUp(url: string, tries = 50): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    try {
      if ((await fetch(url)).ok) return true
    } catch {
      /* not yet */
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  return false
}

const user = await db.user.upsert({
  where: { email: 'smoke-mtier@apical.test' },
  create: { email: 'smoke-mtier@apical.test', name: 'Smoke Mtier' },
  update: {},
})
const workspace = await getWorkspaceForUser(user)
const key = generateApiKey('ap_pat_')
await db.apiKey.deleteMany({ where: { workspaceId: workspace.id, label: 'smoke-mtier' } })
await db.apiKey.create({
  data: { workspaceId: workspace.id, createdById: user.id, label: 'smoke-mtier', keyHash: key.hash, keyPrefix: key.prefix },
})

// ---- 1. maxIterations clamp on POST /api/agent-runs ----
const { POST: createAgentRun } = await import('../../src/app/api/agent-runs/route')
const res = await createAgentRun(
  new Request('http://smoke.local/api/agent-runs', {
    method: 'POST',
    headers: { authorization: `Bearer ${key.raw}`, 'content-type': 'application/json' },
    body: JSON.stringify({ goal: 'smoke clamp probe', maxIterations: 1_000_000_000 }),
  }),
  { params: Promise.resolve({}) },
)
assert(res.status === 200 || res.status === 202, `agent-run create failed: ${res.status}`)
const { agentRunId } = (await res.json()) as { agentRunId: string }
const runRow = await db.agentRun.findUnique({ where: { id: agentRunId }, select: { optsJson: true } })
const storedOpts = JSON.parse(runRow?.optsJson ?? '{}') as { maxIterations?: number }
assert(storedOpts.maxIterations === 128, `maxIterations should clamp to 128, stored: ${storedOpts.maxIterations}`)
// Remove the probe run before any worker can claim it.
await db.agentRun.delete({ where: { id: agentRunId } })
console.log('agent-runs: maxIterations 1e9 clamped to 128')

// ---- 2. desktop:job_update status validation on the bridge ----
const serviceDir = (name: string) => new URL(`../../mini-services/${name}/`, import.meta.url).pathname
const bridge = spawn('bun', ['index.ts'], {
  cwd: serviceDir('desktop-bridge'),
  env: { ...process.env, APICAL_BRIDGE_SECRET: 'smoke-mtier-bridge' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
children.push(bridge)
assert(await waitUp('http://127.0.0.1:3005/health'), 'bridge did not come up')

await db.desktopSession.deleteMany({ where: { userId: user.id } })
const session = await db.desktopSession.create({
  data: { userId: user.id, sessionToken: `dsk_smoke_mtier_${Date.now()}`, label: 'Smoke Desktop' },
})
await db.job.deleteMany({ where: { userId: user.id } })
const job = await db.job.create({
  data: {
    userId: user.id,
    label: 'desktop probe',
    kind: 'cli',
    backend: 'desktop',
    status: 'running',
    desktopSessionId: session.id,
    payloadJson: '{}',
  },
})

const { io } = await import('socket.io-client')
const socket = io('http://127.0.0.1:3005', { path: '/socket.io/', transports: ['websocket'] })
await new Promise<void>((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('bridge auth timed out')), 10_000)
  socket.on('desktop:whoareyou', () => socket.emit('desktop:auth', { sessionToken: session.sessionToken }))
  socket.on('desktop:authed', () => {
    clearTimeout(t)
    resolve()
  })
  socket.on('desktop:auth_error', (e: unknown) => {
    clearTimeout(t)
    reject(new Error(`auth_error: ${JSON.stringify(e)}`))
  })
})

// Invalid states must be ignored (no write, no rollback to 'queued').
socket.emit('desktop:job_update', { jobId: job.id, status: 'hacked', note: 'nope' })
socket.emit('desktop:job_update', { jobId: job.id, status: 'queued' })
await new Promise((r) => setTimeout(r, 1500))
const afterInvalid = await db.job.findUnique({ where: { id: job.id }, select: { status: true, progressNote: true } })
assert(afterInvalid?.status === 'running', `invalid status must be ignored, job is now: ${afterInvalid?.status}`)
assert(afterInvalid?.progressNote !== 'nope', 'invalid update must not write any fields')

// A legitimate terminal state still lands and acks.
const acked = new Promise<void>((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('no job_update_ack for valid status')), 10_000)
  socket.on('desktop:job_update_ack', () => {
    clearTimeout(t)
    resolve()
  })
})
socket.emit('desktop:job_update', { jobId: job.id, status: 'completed', progress: 1 })
await acked
const afterValid = await db.job.findUnique({ where: { id: job.id }, select: { status: true, finishedAt: true } })
assert(afterValid?.status === 'completed' && afterValid.finishedAt, 'valid terminal update must persist')
socket.disconnect()
bridge.kill('SIGKILL')
console.log('bridge: invalid job_update states ignored, valid terminal state persisted')

// ---- 3. agent-worker /browser/* auth still enforced ----
const worker = spawn('bun', ['index.ts'], {
  cwd: serviceDir('agent-worker'),
  env: { ...process.env, AGENT_WORKER_SECRET: 'smoke-mtier-worker', PORT: '3006' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
children.push(worker)
assert(await waitUp('http://127.0.0.1:3006/health'), 'agent-worker did not come up')
const noSecret = await fetch('http://127.0.0.1:3006/browser/act', { method: 'POST', body: '{}' })
assert(noSecret.status === 401, `missing worker secret should be 401, got ${noSecret.status}`)
const wrongSecret = await fetch('http://127.0.0.1:3006/browser/act', {
  method: 'POST',
  headers: { 'x-worker-secret': 'smoke-mtier-worker-x' },
  body: '{}',
})
assert(wrongSecret.status === 401, `wrong worker secret should be 401, got ${wrongSecret.status}`)
const rightSecret = await fetch('http://127.0.0.1:3006/browser/act', {
  method: 'POST',
  headers: { 'x-worker-secret': 'smoke-mtier-worker', 'content-type': 'application/json' },
  body: '{}',
})
assert(rightSecret.status !== 401, `right worker secret should pass auth, got 401`)
worker.kill('SIGKILL')
console.log('agent-worker: browser surface auth intact (401 without/wrong secret, passes with it)')

// Cleanup.
await db.job.deleteMany({ where: { userId: user.id } })
await db.desktopSession.deleteMany({ where: { userId: user.id } })
await db.apiKey.deleteMany({ where: { workspaceId: workspace.id, label: 'smoke-mtier' } })

console.log('OK: 13-mtier')
process.exit(0)
