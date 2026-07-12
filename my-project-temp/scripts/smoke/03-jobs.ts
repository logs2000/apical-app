// Smoke: async job layer — server backend end-to-end (submit → run → progress
// → artifact → collect) + timeout + cancel. Needs DATABASE_URL + python3.
// Run: bun scripts/smoke/03-jobs.ts

import { db } from '../../src/lib/db'
import { jobWorkerTick } from '../../src/lib/platform/jobs'
import { readAssetBytes } from '../../src/lib/platform/assets'

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error(`FAIL: ${msg}`)
    process.exit(1)
  }
}

async function waitTerminal(jobId: string, timeoutMs = 60_000): Promise<string> {
  const inFlight = new Map<string, Promise<void>>()
  const deadline = Date.now() + timeoutMs
  for (;;) {
    await jobWorkerTick('smoke-jobworker', inFlight, 2)
    const job = await db.job.findUnique({ where: { id: jobId }, select: { status: true } })
    if (job && ['completed', 'failed', 'cancelled', 'timeout'].includes(job.status)) {
      await Promise.allSettled([...inFlight.values()])
      return job.status
    }
    if (Date.now() > deadline) throw new Error(`job ${jobId} did not finish (last: ${job?.status})`)
    await new Promise((r) => setTimeout(r, 500))
  }
}

const user = await db.user.upsert({
  where: { email: 'smoke-jobs@apical.test' },
  create: { email: 'smoke-jobs@apical.test', name: 'Smoke Jobs' },
  update: {},
})
await db.job.deleteMany({ where: { userId: user.id } })

// 1) A python job that reports progress and writes an artifact.
const source = [
  'import os, json, time',
  'd = os.environ["APICAL_JOB_DIR"]',
  'open(os.path.join(d, "progress.json"), "w").write(json.dumps({"progress": 0.5, "note": "halfway"}))',
  'os.makedirs(os.path.join(d, "out"), exist_ok=True)',
  'open(os.path.join(d, "out", "result.txt"), "w").write("bobsled track mesh v1")',
  'print("done computing")',
].join('\n')

const job = await db.job.create({
  data: {
    userId: user.id,
    label: 'smoke server job',
    kind: 'script',
    backend: 'server',
    timeoutMs: 60_000,
    payloadJson: JSON.stringify({ language: 'python', source, packages: [] }),
  },
})

const status = await waitTerminal(job.id)
assert(status === 'completed', `server job ended ${status}, expected completed`)

const done = await db.job.findUnique({ where: { id: job.id } })
assert(done?.progress === 1, 'completed job should report progress 1')
const artifactIds: string[] = done?.artifactIdsJson ? JSON.parse(done.artifactIdsJson) : []
assert(artifactIds.length === 1, `expected 1 artifact, got ${artifactIds.length}`)
const bytes = await readAssetBytes(user.id, artifactIds[0])
assert(bytes && bytes.toString().includes('bobsled track mesh'), 'artifact content missing/incorrect')
const result = done?.resultJson ? JSON.parse(done.resultJson) : null
assert(result?.stdoutTail?.includes('done computing'), 'stdout tail not captured')
console.log(`server job: ${status}, ${artifactIds.length} artifact, progress=${done?.progress}`)

// 2) Timeout: a job that sleeps past its (tiny) timeout ends as 'timeout'.
const slow = await db.job.create({
  data: {
    userId: user.id,
    label: 'smoke timeout job',
    kind: 'script',
    backend: 'server',
    timeoutMs: 2000,
    payloadJson: JSON.stringify({ language: 'python', source: 'import time\ntime.sleep(30)', packages: [] }),
  },
})
const slowStatus = await waitTerminal(slow.id, 30_000)
assert(slowStatus === 'timeout', `expected timeout, got ${slowStatus}`)
console.log(`timeout job: ${slowStatus}`)

// 3) Cloud backend stub fails fast with a clear message.
const cloud = await db.job.create({
  data: {
    userId: user.id,
    label: 'smoke cloud job',
    kind: 'script',
    backend: 'cloud',
    timeoutMs: 60_000,
    payloadJson: JSON.stringify({ language: 'python', source: 'print(1)', packages: [] }),
  },
})
const cloudStatus = await waitTerminal(cloud.id, 15_000)
assert(cloudStatus === 'failed', `cloud stub should fail, got ${cloudStatus}`)
const cloudRow = await db.job.findUnique({ where: { id: cloud.id } })
assert(cloudRow?.error?.includes('not configured'), 'cloud stub error message missing')
console.log(`cloud stub: ${cloudStatus} (${cloudRow?.error?.slice(0, 40)})`)

await db.job.deleteMany({ where: { userId: user.id } })
console.log('OK: 03-jobs')
process.exit(0)
