// Smoke: workflow-schema + deploy normalization invariants.
// Run: bun scripts/smoke/00-schema.ts   (exits non-zero on failure)

import { validateWorkflowJSON, KNOWN_STEP_KINDS } from '../../src/lib/workflow-schema'
import { normalizeSteps } from '../../src/lib/deploy'

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error(`FAIL: ${msg}`)
    process.exit(1)
  }
}

// 1) CodeCallSpec retains `packages` through zod validation.
const res = validateWorkflowJSON({
  version: 2,
  steps: [
    {
      id: 's1',
      kind: 'tool',
      label: 'Run script',
      code: { language: 'python', source: 'print(1)', packages: ['numpy'] },
    },
    {
      id: 's2',
      kind: 'tool',
      label: 'Post result',
      http: { method: 'POST', url: 'https://example.com', body: { v: '{{s1.stdout}}' } },
    },
  ],
})
assert(res.ok, `valid workflow rejected: ${JSON.stringify(!res.ok && res.issues)}`)
assert(
  res.ok && Array.isArray(res.workflow.steps[0].code?.packages) && res.workflow.steps[0].code!.packages![0] === 'numpy',
  'code.packages was stripped by validation',
)

// 2) normalizeSteps preserves every known kind (spawn was previously coerced to tool).
assert(KNOWN_STEP_KINDS.includes('spawn'), 'spawn missing from KNOWN_STEP_KINDS')
const normalized = normalizeSteps([
  { id: 'a', kind: 'spawn', spawnPrompt: 'do the thing', spawnTools: ['web_search'] },
  { id: 'b', kind: 'gate', gateMessage: 'ok?' },
  { id: 'c', kind: 'tool', code: { language: 'python', source: 'x', packages: ['pandas'] }, retry: { maxAttempts: 3 }, timeoutMs: 5000 },
])
assert(normalized[0].kind === 'spawn', `spawn kind was coerced to ${normalized[0].kind}`)
assert(normalized[0].spawnPrompt === 'do the thing', 'spawnPrompt dropped')
assert(normalized[0].spawnTools?.[0] === 'web_search', 'spawnTools dropped')
assert(normalized[1].kind === 'gate', 'gate kind broken')
assert(normalized[2].code?.packages?.[0] === 'pandas', 'code.packages dropped by normalizeSteps')
assert(normalized[2].retry?.maxAttempts === 3, 'retry dropped by normalizeSteps')
assert(normalized[2].timeoutMs === 5000, 'timeoutMs dropped by normalizeSteps')

// 3) Unknown kinds are NOT silently downgraded — they pass through and fail validation loudly.
const weird = normalizeSteps([{ id: 'z', kind: 'teleport' }])
assert((weird[0].kind as string) === 'teleport', 'unknown kind was silently coerced')
const bad = validateWorkflowJSON({ version: 2, steps: [{ id: 'z', kind: 'teleport', label: 'x' }] })
assert(!bad.ok, 'unknown kind passed validation')

console.log('OK: 00-schema')
