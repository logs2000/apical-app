// Smoke: durable agent-run plumbing — claim/lease/execute/persist/cancel.
// Needs DATABASE_URL (uses the dev DB). Does NOT need an LLM provider: a run
// with no provider configured must still terminate cleanly as 'failed' with
// the error persisted — that is the crash-safety contract under test.
// Run: bun scripts/smoke/02-durable-run.ts

import { db } from '../../src/lib/db'
import { claimAgentRuns, executeAgentRun, agentRunWorkerTick } from '../../src/lib/platform/agent-run-worker'

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error(`FAIL: ${msg}`)
    process.exit(1)
  }
}

const user = await db.user.upsert({
  where: { email: 'smoke-durable@apical.test' },
  create: { email: 'smoke-durable@apical.test', name: 'Smoke Durable' },
  update: {},
})

// Clean slate for repeat runs. claimAgentRuns is cross-user by design, so
// stale claimable rows left by OTHER smoke tests (e.g. 07-memory's oversight
// escalation) would eat the claim budget and flake the "was claimed" assert —
// clear every claimable row in this dev-only DB, not just ours.
await db.agentRun.deleteMany({ where: { userId: user.id } })
await db.agentRun.deleteMany({ where: { status: { in: ['queued', 'running', 'cancelling'] } } })

// 1) queued → claimed → executed → terminal ('failed' here: no LLM provider).
const run = await db.agentRun.create({
  data: { userId: user.id, goal: 'Say hello.', optsJson: '{}' },
})
const claimed = await claimAgentRuns('smoke-worker', 4)
assert(claimed.includes(run.id), 'queued run was not claimed')
const mid = await db.agentRun.findUnique({ where: { id: run.id } })
assert(mid?.status === 'running' && mid.claimedBy === 'smoke-worker' && mid.leaseUntil, 'claim did not set lease')

await executeAgentRun(run.id, 'smoke-worker')
const done = await db.agentRun.findUnique({ where: { id: run.id } })
assert(done && ['failed', 'completed'].includes(done.status), `run not terminal: ${done?.status}`)
assert(done!.finishedAt, 'finishedAt not set')
assert(done!.claimedBy === null && done!.leaseUntil === null, 'lease not released')
if (done!.status === 'failed') assert(done!.error, 'failed run must persist its error')
console.log(`run terminal: ${done!.status}${done!.error ? ` (${done!.error.slice(0, 60)}…)` : ''}`)

// 2) cancel of a queued run — immediate.
const q = await db.agentRun.create({ data: { userId: user.id, goal: 'x', optsJson: '{}' } })
await db.agentRun.updateMany({ where: { id: q.id, status: 'queued' }, data: { status: 'cancelled', finishedAt: new Date() } })
const qDone = await db.agentRun.findUnique({ where: { id: q.id } })
assert(qDone?.status === 'cancelled', 'queued cancel failed')

// 3) crashed-worker reclaim: running row with an expired lease gets re-claimed.
const stale = await db.agentRun.create({
  data: {
    userId: user.id,
    goal: 'resume me',
    optsJson: '{}',
    status: 'running',
    claimedBy: 'dead-worker',
    leaseUntil: new Date(Date.now() - 60_000),
    checkpointJson: JSON.stringify({ messages: [{ role: 'system', content: 's' }], iterations: 3, toolCalls: 1, tokensUsed: 10, answerText: '' }),
  },
})
const reclaimed = await claimAgentRuns('smoke-worker-2', 4)
assert(reclaimed.includes(stale.id), 'expired-lease run was not reclaimed')
const reclaimedRow = await db.agentRun.findUnique({ where: { id: stale.id } })
assert(reclaimedRow?.claimedBy === 'smoke-worker-2', 'reclaim did not transfer the lease')
await executeAgentRun(stale.id, 'smoke-worker-2')
const resumed = await db.agentRun.findUnique({ where: { id: stale.id } })
assert(resumed && ['failed', 'completed'].includes(resumed.status), 'reclaimed run not terminal')

// 4) expired-lease 'cancelling' rows are finalized by the claim sweep.
const c = await db.agentRun.create({
  data: {
    userId: user.id,
    goal: 'cancel me',
    optsJson: '{}',
    status: 'cancelling',
    claimedBy: 'dead-worker',
    leaseUntil: new Date(Date.now() - 60_000),
  },
})
await claimAgentRuns('smoke-worker-3', 4)
const cDone = await db.agentRun.findUnique({ where: { id: c.id } })
assert(cDone?.status === 'cancelled', `orphaned cancelling run not finalized: ${cDone?.status}`)

// 5) tick respects the concurrency budget (0 slots → claims nothing).
const extra = await db.agentRun.create({ data: { userId: user.id, goal: 'y', optsJson: '{}' } })
const full = new Map<string, Promise<void>>([['a', Promise.resolve()], ['b', Promise.resolve()]])
await agentRunWorkerTick('smoke-worker-4', full, 2)
const extraRow = await db.agentRun.findUnique({ where: { id: extra.id } })
assert(extraRow?.status === 'queued', 'tick over budget must not claim')

await db.agentRun.deleteMany({ where: { userId: user.id } })
console.log('OK: 02-durable-run')
process.exit(0)
