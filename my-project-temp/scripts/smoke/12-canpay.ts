// Smoke: canPay enforcement. Payment-capable credentials (canPay=true) were
// stored with the flag but ANY agent turn could resolve and spend them. Now
// resolveCredentialForAgent refuses them unless the caller carries an explicit
// grant — the credential id listed on the agent's allowedCredentialsJson, or a
// caller-asserted human grant (frozen integration config).
// Run: bun scripts/smoke/12-canpay.ts

import { db } from '../../src/lib/db'
import { encrypt } from '../../src/lib/platform/vault'
import { resolveCredentialForAgent, buildSecureHeaders } from '../../src/lib/platform/agent-credentials'
import { AGENT_TOOLS, type ToolContext } from '../../src/lib/platform/agent-tools'

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error(`FAIL: ${msg}`)
    process.exit(1)
  }
}

const user = await db.user.upsert({
  where: { email: 'smoke-canpay@apical.test' },
  create: { email: 'smoke-canpay@apical.test', name: 'Smoke CanPay' },
  update: {},
})
await db.credential.deleteMany({ where: { userId: user.id } })
await db.workflow.deleteMany({ where: { userId: user.id } })

const payCred = await db.credential.create({
  data: {
    userId: user.id,
    service: 'stripe',
    label: 'Stripe (payments)',
    kind: 'payment',
    canPay: true,
    metaJson: JSON.stringify({ key: encrypt('sk_live_smoke_secret') }),
  },
})
const plainCred = await db.credential.create({
  data: {
    userId: user.id,
    service: 'weatherapi',
    label: 'Weather API',
    kind: 'apikey',
    canPay: false,
    metaJson: JSON.stringify({ key: encrypt('wapi_smoke_key') }),
  },
})

// 1) Direct resolution: payment credential refused without a grant, resolved
// with one; non-payment credential unaffected.
assert((await resolveCredentialForAgent(payCred.id, user.id)) === null, 'canPay cred must not resolve ungrated')
const granted = await resolveCredentialForAgent(payCred.id, user.id, { allowPay: true })
assert(granted?.secret === 'sk_live_smoke_secret', 'canPay cred must resolve with allowPay')
const plain = await resolveCredentialForAgent(plainCred.id, user.id)
assert(plain?.secret === 'wapi_smoke_key', 'non-payment cred must resolve as before')
console.log('resolve: canPay refused without grant, resolved with grant, plain cred unaffected')

// 2) buildSecureHeaders: ungranted → paymentBlocked (NOT "not found"); agent
// with the credential on its allowlist → header injected.
const blocked = await buildSecureHeaders({}, payCred.id, user.id)
assert(blocked.paymentBlocked === true && !blocked.hadCredential, 'expected paymentBlocked signal')

const agentNoGrant = await db.workflow.create({
  data: { userId: user.id, name: 'no-grant agent', description: '', stepsJson: '[]', trigger: 'manual' },
})
const agentGranted = await db.workflow.create({
  data: {
    userId: user.id,
    name: 'granted agent',
    description: '',
    stepsJson: '[]',
    trigger: 'manual',
    allowedCredentialsJson: JSON.stringify([payCred.id]),
  },
})
const viaUngrantedAgent = await buildSecureHeaders({}, payCred.id, user.id, { agentId: agentNoGrant.id })
assert(viaUngrantedAgent.paymentBlocked === true, 'agent without allowlist entry must be blocked')
const viaGrantedAgent = await buildSecureHeaders({}, payCred.id, user.id, { agentId: agentGranted.id })
assert(
  viaGrantedAgent.hadCredential && viaGrantedAgent.headers['Authorization'] === 'Bearer sk_live_smoke_secret',
  'agent with allowlist entry must get the injected header',
)
console.log('headers: paymentBlocked without grant, injected for the granted agent')

// 3) Tool level: http_request explains the block instead of a phantom 401.
const httpRequest = AGENT_TOOLS.find((t) => t.name === 'http_request')!
const ctx: ToolContext = { userId: user.id, agentId: agentNoGrant.id, allowCli: false, maxFetchBytes: 100_000 }
const res = await httpRequest.run({ url: 'https://example.com/charge', credentialId: payCred.id }, ctx)
assert(!res.ok && /payment-capable/.test(res.error ?? ''), `expected payment-block error, got: ${res.error}`)
console.log(`tool: http_request refused with "${res.error?.slice(0, 60)}..."`)

// Cleanup.
await db.workflow.deleteMany({ where: { userId: user.id } })
await db.credential.deleteMany({ where: { userId: user.id } })

console.log('OK: 12-canpay')
process.exit(0)
