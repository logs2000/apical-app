// Smoke: POST /api/jobs submission ceilings — per-user rate limit + active-job
// quota (audit: the endpoint previously accepted unbounded compute). Exercises
// the REAL route handler in-process, authenticated with a desktop-session
// token (the first-party path; API keys don't authenticate /api/* anymore).
// Run: bun scripts/smoke/10-jobs-limits.ts

import { db } from '../../src/lib/db'
import { mintSessionToken, clearSessionTokens } from './_session-auth'
import { POST } from '../../src/app/api/jobs/route'

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error(`FAIL: ${msg}`)
    process.exit(1)
  }
}

const user = await db.user.upsert({
  where: { email: 'smoke-jobs-limits@apical.test' },
  create: { email: 'smoke-jobs-limits@apical.test', name: 'Smoke Jobs Limits' },
  update: {},
})
await db.job.deleteMany({ where: { userId: user.id } })
await clearSessionTokens(user.id)
const token = await mintSessionToken(user.id, 'smoke-jobs-limits')

function submit(body: Record<string, unknown>): Promise<Response> {
  const req = new Request('http://smoke.local/api/jobs', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return POST(req, { params: Promise.resolve({}) })
}
const goodJob = { label: 'smoke limit probe', language: 'javascript', source: 'console.log(1)' }

// 1) A normal submit is accepted (202) — ceilings must not break the happy path.
const ok = await submit(goodJob)
assert(ok.status === 202, `first submit should be 202, got ${ok.status}`)
const { jobId } = (await ok.json()) as { jobId: string }
assert(jobId, 'no jobId returned')
console.log(`submit ok: job ${jobId} queued`)

// 2) Active-job quota: fill the user up to the cap with queued jobs, then the
// next submit must be refused with a quota error (429).
const active = await db.job.count({ where: { userId: user.id, status: { in: ['queued', 'accepted', 'running'] } } })
const QUOTA = 25 // MAX_ACTIVE_JOBS in the route
for (let i = active; i < QUOTA; i++) {
  await db.job.create({
    data: { userId: user.id, label: `filler ${i}`, kind: 'script', backend: 'server', payloadJson: '{}' },
  })
}
const overQuota = await submit(goodJob)
const overQuotaBody = (await overQuota.json()) as { error?: string }
assert(overQuota.status === 429, `over-quota submit should be 429, got ${overQuota.status}`)
assert(/quota/.test(overQuotaBody.error ?? ''), `expected quota error, got: ${overQuotaBody.error}`)
console.log(`quota: submit #${QUOTA + 1} refused (${overQuotaBody.error})`)

// 3) Rate limit: 30 submits/min/user. Every authenticated POST consumes a
// token (2 spent above); hammer until the bucket runs dry and expect
// rate_limited + Retry-After.
let rateLimited: Response | null = null
for (let i = 0; i < 35; i++) {
  const res = await submit(goodJob)
  if (res.status === 429) {
    const body = (await res.json()) as { error?: string; retryAfter?: number }
    if (body.error === 'rate_limited') {
      assert(Number(res.headers.get('retry-after')) > 0, 'rate_limited response missing Retry-After')
      rateLimited = res
      break
    }
    // quota 429s are expected until the bucket empties — keep going
  }
}
assert(rateLimited, 'rate limit never triggered after 35+ submits in one window')
console.log('rate limit: burst refused with rate_limited + Retry-After')

// Cleanup.
await db.job.deleteMany({ where: { userId: user.id } })
await clearSessionTokens(user.id)

console.log('OK: 10-jobs-limits')
process.exit(0)
