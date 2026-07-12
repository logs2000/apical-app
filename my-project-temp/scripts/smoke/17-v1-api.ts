// Smoke: the canonical /v1 surface after migration — response envelope,
// cursor pagination, zod validation (422 with details), scope-as-envelope
// (403), and live rate-limiting (429 + Retry-After) — all driven through the
// real route handlers in-process with a minted key.
// Run: bun scripts/smoke/17-v1-api.ts

import { db } from '../../src/lib/db'
import { generateApiKey, ALL_SCOPES } from '../../src/lib/api-key-auth'
import { getWorkspaceForUser } from '../../src/lib/auth-helpers'
import { GET as listWorkflows, POST as createWorkflow } from '../../src/app/v1/workflows/route'
import { GET as getWorkflow } from '../../src/app/v1/workflows/[id]/route'

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error(`FAIL: ${msg}`)
    process.exit(1)
  }
}
const body = (r: Response) => r.json() as Promise<Record<string, unknown>>

const user = await db.user.upsert({
  where: { email: 'smoke-v1@apical.test' },
  create: { email: 'smoke-v1@apical.test', name: 'Smoke V1' },
  update: {},
})
const workspace = await getWorkspaceForUser(user)
await db.workflow.deleteMany({ where: { userId: user.id, name: { startsWith: 'smoke-v1-' } } })
await db.apiKey.deleteMany({ where: { workspaceId: workspace.id, label: { startsWith: 'smoke-v1' } } })

async function mintKey(scopes: string[]): Promise<string> {
  const { raw, hash, prefix } = generateApiKey('ap_pat_')
  await db.apiKey.create({
    data: {
      workspaceId: workspace.id,
      createdById: user.id,
      label: `smoke-v1-${scopes.join('.') || 'none'}`,
      keyHash: hash,
      keyPrefix: prefix,
      scopesJson: JSON.stringify(scopes),
      status: 'active',
    },
  })
  return raw
}
const fullKey = await mintKey([...ALL_SCOPES])

// Seed three workflows to paginate over.
for (let i = 0; i < 3; i++) {
  await db.workflow.create({
    data: {
      userId: user.id,
      workspaceId: workspace.id,
      name: `smoke-v1-wf-${i}`,
      description: '',
      stepsJson: '[]',
      trigger: 'manual',
    },
  })
}

const req = (url: string, raw: string, init?: RequestInit) =>
  new Request(url, { ...init, headers: { authorization: `Bearer ${raw}`, 'content-type': 'application/json', ...(init?.headers ?? {}) } })
const listReq = (raw: string, qs = '') => listWorkflows(req(`http://smoke.local/v1/workflows${qs}`, raw), { params: Promise.resolve({}) })

// 1. Success envelope + cursor pagination.
const p1 = await listReq(fullKey, '?limit=2')
assert(p1.status === 200, `list should be 200, got ${p1.status}`)
const p1b = (await body(p1)) as { data?: unknown[]; page?: { nextCursor: string | null; hasMore: boolean } }
assert(Array.isArray(p1b.data) && p1b.data.length === 2, `page 1 should have 2 items, got ${p1b.data?.length}`)
assert(p1b.page?.hasMore === true && typeof p1b.page.nextCursor === 'string', 'page 1 hasMore + nextCursor')

const p2 = await listReq(fullKey, `?limit=2&cursor=${encodeURIComponent(p1b.page!.nextCursor!)}`)
const p2b = (await body(p2)) as { data: Array<{ id: string }>; page: { hasMore: boolean } }
const ids1 = (p1b.data as Array<{ id: string }>).map((w) => w.id)
const ids2 = p2b.data.map((w) => w.id)
assert(ids2.length >= 1 && ids2.every((id) => !ids1.includes(id)), 'page 2 has no overlap with page 1')
assert(p2b.page.hasMore === false, 'page 2 is the last page (3 total, 2+1)')
console.log(`envelope+pagination: {data,page}; paged 3 workflows as 2 + ${ids2.length} with no overlap`)

// 2. Single entity → { data: {...} }.
const one = await getWorkflow(req(`http://smoke.local/v1/workflows/${ids1[0]}`, fullKey), { params: Promise.resolve({ id: ids1[0] }) })
const oneB = (await body(one)) as { data?: { id: string } }
assert(one.status === 200 && oneB.data?.id === ids1[0], 'single entity wrapped under data')

// 3. Validation → 422 { error: { code, details } }.
const bad = await createWorkflow(req('http://smoke.local/v1/workflows', fullKey, { method: 'POST', body: '{}' }), { params: Promise.resolve({}) })
assert(bad.status === 422, `bad create should be 422, got ${bad.status}`)
const badB = (await body(bad)) as { error?: { code: string; details?: unknown } }
assert(badB.error?.code === 'validation_failed' && Array.isArray(badB.error.details), '422 error envelope with issue details')
console.log('validation: empty create → 422 validation_failed with details')

// 4. Scope as envelope → 403 { error: { code: 'forbidden' } }.
const noScopeKey = await mintKey(['runs:read'])
const denied = await listReq(noScopeKey)
assert(denied.status === 403, `out-of-scope list should be 403, got ${denied.status}`)
const deniedB = (await body(denied)) as { error?: { code: string } }
assert(deniedB.error?.code === 'forbidden', 'scope denial uses forbidden envelope')
console.log('scope: workflows:read missing → 403 forbidden envelope')

// 5. Live rate-limit on a real route (GET /v1/workflows is 120/min).
let limited: Response | null = null
for (let i = 0; i < 130; i++) {
  const r = await listReq(fullKey, '?limit=1')
  if (r.status === 429) {
    limited = r
    break
  }
}
assert(limited, 'rate limit (120/min) never tripped after 130 calls')
assert(Number(limited!.headers.get('retry-after')) > 0, 'rate-limited response has Retry-After')
const rlB = (await body(limited!)) as { error?: { code: string } }
assert(rlB.error?.code === 'rate_limited', 'rate-limit uses rate_limited envelope')
console.log('rate-limit: GET /v1/workflows 429s past 120/min with Retry-After')

// Cleanup.
await db.workflow.deleteMany({ where: { userId: user.id, name: { startsWith: 'smoke-v1-' } } })
await db.apiKey.deleteMany({ where: { workspaceId: workspace.id, label: { startsWith: 'smoke-v1' } } })

console.log('OK: 17-v1-api')
process.exit(0)
