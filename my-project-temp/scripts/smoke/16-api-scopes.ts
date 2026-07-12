// Smoke: API-key scope enforcement + the closed /api scope-bypass. Drives the
// real /v1 and /api workflow route handlers in-process with minted keys.
//   - a scoped key is allowed on the matching /v1 route, 403 on an
//     out-of-scope one (scopes enforced on /v1),
//   - that same key is 401 on /api/* (keys no longer authenticate the
//     first-party session surface — the bypass is closed),
//   - an empty-scope key grants nothing (fail closed),
//   - scope normalization at creation defaults to full access, never [].
// Run: bun scripts/smoke/16-api-scopes.ts

import { db } from '../../src/lib/db'
import {
  generateApiKey,
  hashApiKey,
  ALL_SCOPES,
  normalizeScopesForCreate,
} from '../../src/lib/api-key-auth'
import { getWorkspaceForUser } from '../../src/lib/auth-helpers'
import { GET as v1WorkflowsGET, POST as v1WorkflowsPOST } from '../../src/app/v1/workflows/route'
import { GET as apiWorkflowsGET } from '../../src/app/api/workflows/route'

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error(`FAIL: ${msg}`)
    process.exit(1)
  }
}

const user = await db.user.upsert({
  where: { email: 'smoke-scopes@apical.test' },
  create: { email: 'smoke-scopes@apical.test', name: 'Smoke Scopes' },
  update: {},
})
const workspace = await getWorkspaceForUser(user)
await db.apiKey.deleteMany({ where: { workspaceId: workspace.id, label: { startsWith: 'smoke-scopes' } } })

async function mintKey(scopes: string[]): Promise<string> {
  const { raw, hash, prefix } = generateApiKey('ap_pat_')
  await db.apiKey.create({
    data: {
      workspaceId: workspace.id,
      createdById: user.id,
      label: `smoke-scopes-${scopes.join('.') || 'empty'}`,
      keyHash: hash,
      keyPrefix: prefix,
      scopesJson: JSON.stringify(scopes),
      status: 'active',
    },
  })
  return raw
}

const v1Req = (raw: string, method: string) =>
  new Request('http://smoke.local/v1/workflows', {
    method,
    headers: { authorization: `Bearer ${raw}`, 'content-type': 'application/json' },
    ...(method === 'POST' ? { body: '{}' } : {}),
  })
const noParams = { params: Promise.resolve({}) }

// 1. workflows:read key — allowed to read, 403 to write.
const readKey = await mintKey(['workflows:read'])
const readGet = await v1WorkflowsGET(v1Req(readKey, 'GET'), noParams)
assert(readGet.status === 200, `read key GET /v1/workflows should be 200, got ${readGet.status}`)
const readPost = await v1WorkflowsPOST(v1Req(readKey, 'POST'), noParams)
assert(readPost.status === 403, `read key POST /v1/workflows should be 403, got ${readPost.status}`)
console.log('scopes: workflows:read key reads (200) but cannot write (403)')

// 2. workflows:write key — passes the scope gate (may 400 on empty body, but
// never 401/403).
const writeKey = await mintKey(['workflows:read', 'workflows:write'])
const writePost = await v1WorkflowsPOST(v1Req(writeKey, 'POST'), noParams)
assert(
  writePost.status !== 401 && writePost.status !== 403,
  `write key POST should pass auth+scope, got ${writePost.status}`,
)
console.log(`scopes: workflows:write key passes the write gate (status ${writePost.status})`)

// 3. Scope bypass closed — the same key cannot authenticate /api/*.
const apiResp = await apiWorkflowsGET(
  new Request('http://smoke.local/api/workflows', { headers: { authorization: `Bearer ${readKey}` } }),
)
assert(apiResp.status === 401, `API key on /api/workflows must be 401 (bypass closed), got ${apiResp.status}`)
console.log('bypass: API key rejected (401) on the first-party /api surface')

// 4. Empty-scope key grants nothing (fail closed).
const emptyKey = await mintKey([])
const emptyGet = await v1WorkflowsGET(v1Req(emptyKey, 'GET'), noParams)
assert(emptyGet.status === 403, `empty-scope key must be denied (403), got ${emptyGet.status}`)
// Sanity: the stored row really is empty (fail-closed, not just missing scope).
const emptyRow = await db.apiKey.findFirst({ where: { keyHash: hashApiKey(emptyKey) }, select: { scopesJson: true } })
assert(emptyRow?.scopesJson === '[]', 'empty key stored with [] scopes')
console.log('fail-closed: empty-scope key is denied (403), not granted everything')

// 5. Creation-time normalization: [] → all scopes; junk filtered.
assert(
  JSON.stringify(normalizeScopesForCreate([])) === JSON.stringify(ALL_SCOPES),
  'normalizeScopesForCreate([]) must default to all scopes',
)
assert(
  JSON.stringify(normalizeScopesForCreate(['workflows:read', 'bogus'])) === JSON.stringify(['workflows:read']),
  'normalizeScopesForCreate filters unknown scopes',
)
console.log('creation: no-scopes defaults to full access; unknown scopes filtered')

// Cleanup.
await db.apiKey.deleteMany({ where: { workspaceId: workspace.id, label: { startsWith: 'smoke-scopes' } } })

console.log('OK: 16-api-scopes')
process.exit(0)
