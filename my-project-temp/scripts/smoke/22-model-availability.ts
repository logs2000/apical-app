// Smoke: honest model-availability gate (B1). getModelAvailability is the one
// truthful signal every ask-surface gates on, so a fresh install never lets a
// user type into a void:
//   - no provider key / cloud token / custom model → needsSetup (the gate)
//   - a hosted provider key makes a sensible default appear (env-only, no call)
//   - anthropic is preferred when configured
//   - a BYOK/local custom model answers even with no hosted provider
// Run: bun scripts/smoke/22-model-availability.ts

import { db } from '../../src/lib/db'
import {
  getModelAvailability,
  configuredHostedProviders,
} from '../../src/lib/platform/llm-gateway'

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error(`FAIL: ${msg}`)
    process.exit(1)
  }
}

const PROVIDER_KEYS = [
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'GOOGLE_API_KEY',
  'XAI_API_KEY',
  'LLM_DEFAULT_PROVIDER',
] as const

// Isolate from whatever the ambient env carries so the baseline is truly "none".
const savedEnv: Record<string, string | undefined> = {}
for (const k of PROVIDER_KEYS) {
  savedEnv[k] = process.env[k]
  delete process.env[k]
}

// A fresh account: no cloud PAT, no custom models.
const user = await db.user.upsert({
  where: { email: 'smoke-models@apical.test' },
  create: { email: 'smoke-models@apical.test', name: 'Smoke Models' },
  update: {},
})
await db.customModel.deleteMany({ where: { userId: user.id } })

// 1) Nothing configured → honest gate.
assert(configuredHostedProviders().length === 0, 'baseline: no hosted providers configured')
let a = await getModelAvailability(user.id)
assert(
  a.hasModel === false && a.defaultModelId === null && a.needsSetup === true,
  'no provider → { hasModel:false, defaultModelId:null, needsSetup:true }',
)
console.log('gate: fresh account with no model → needsSetup=true, defaultModelId=null')

// 2) A hosted provider key → a sensible default appears (env-only, no network).
process.env.OPENAI_API_KEY = 'sk-smoke-test'
a = await getModelAvailability(user.id)
assert(a.hasModel === true && a.needsSetup === false, 'openai key → hasModel, no setup needed')
assert(
  typeof a.defaultModelId === 'string' && a.defaultModelId.startsWith('openai:'),
  `default should be an openai model, got ${a.defaultModelId}`,
)
console.log(`default: OPENAI_API_KEY set → hasModel, default=${a.defaultModelId}`)

// 3) Anthropic is preferred when configured (a quality default, not just first).
process.env.ANTHROPIC_API_KEY = 'sk-ant-smoke'
a = await getModelAvailability(user.id)
assert(
  typeof a.defaultModelId === 'string' && a.defaultModelId.startsWith('anthropic:'),
  `anthropic should be preferred, got ${a.defaultModelId}`,
)
console.log(`preference: anthropic preferred when configured → default=${a.defaultModelId}`)
delete process.env.OPENAI_API_KEY
delete process.env.ANTHROPIC_API_KEY

// 4) A BYOK/local custom model answers even with no hosted provider at all.
assert(configuredHostedProviders().length === 0, 'hosted providers cleared again')
const custom = await db.customModel.create({
  data: {
    userId: user.id,
    name: 'Local Llama',
    type: 'offline',
    provider: 'ollama',
    modelId: 'llama3.1',
    baseUrl: 'http://127.0.0.1:11434',
    isDefault: false,
    enabled: true,
    contextWindow: 128_000,
    inputCostCentsPer1M: 0,
    outputCostCentsPer1M: 0,
  },
})
a = await getModelAvailability(user.id)
assert(a.hasModel === true && a.needsSetup === false, 'custom model → hasModel with no hosted provider')
assert(a.defaultModelId === custom.id, `default should be the custom model, got ${a.defaultModelId}`)
console.log('fallback: a local/BYOK custom model makes the account answer with no hosted provider')

// Cleanup + restore env.
await db.customModel.deleteMany({ where: { userId: user.id } })
for (const k of PROVIDER_KEYS) {
  if (savedEnv[k] === undefined) delete process.env[k]
  else process.env[k] = savedEnv[k]
}

console.log('OK: 22-model-availability')
process.exit(0)
