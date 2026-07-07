// Smoke: workflow control flow — schema validation + runtime execution of
// branch/loop/map over deterministic code steps, plus RunStep tree shape.
// Needs DATABASE_URL. Run: bun scripts/smoke/05-controlflow.ts

import { db } from '../../src/lib/db'
import { validateWorkflowJSON } from '../../src/lib/workflow-schema'
import { executeRun } from '../../src/lib/runtime'

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error(`FAIL: ${msg}`)
    process.exit(1)
  }
}

// ---- 1. Validation: scope-aware refs + rejections ----

// item/$index valid inside a map body.
const good = validateWorkflowJSON({
  version: 2,
  steps: [
    { id: 'seed', kind: 'tool', label: 'seed', code: { language: 'javascript', source: 'return [1,2,3]' } },
    {
      id: 'm', kind: 'map', label: 'map', itemsRef: '{{seed.result}}', concurrency: 2,
      bodySteps: [{ id: 'dbl', kind: 'tool', label: 'double', code: { language: 'javascript', source: 'return (data.item||0)*2', data: { item: '{{item}}', i: '{{$index}}' } } }],
    },
  ],
})
assert(good.ok, `valid map workflow rejected: ${JSON.stringify(!good.ok && good.issues)}`)

// {{item}} outside a map/loop body is invalid.
const badItem = validateWorkflowJSON({
  version: 2,
  steps: [{ id: 's1', kind: 'tool', label: 'x', code: { language: 'javascript', source: 'return {{item}}' } }],
})
assert(!badItem.ok, 'item ref outside a body should be rejected')

// gate inside a body is rejected.
const badGate = validateWorkflowJSON({
  version: 2,
  steps: [
    { id: 'seed', kind: 'tool', label: 'seed', code: { language: 'javascript', source: 'return [1]' } },
    { id: 'm', kind: 'map', label: 'm', itemsRef: '{{seed.result}}', bodySteps: [{ id: 'g', kind: 'gate', label: 'approve', gateMessage: 'ok?' }] },
  ],
})
assert(!badGate.ok, 'gate inside a map body should be rejected')

// branch requires when + thenSteps.
const badBranch = validateWorkflowJSON({ version: 2, steps: [{ id: 'b', kind: 'branch', label: 'b' }] })
assert(!badBranch.ok, 'branch without when/thenSteps should be rejected')
console.log('validation: map ok, item-outside rejected, body-gate rejected, incomplete-branch rejected')

// ---- 2. Runtime: execute branch + loop + map over code steps ----

const user = await db.user.upsert({
  where: { email: 'smoke-cf@apical.test' },
  create: { email: 'smoke-cf@apical.test', name: 'Smoke CF' },
  update: {},
})
await db.workflow.deleteMany({ where: { userId: user.id, name: 'smoke-cf-wf' } })

const steps = [
  { id: 'seed', kind: 'tool', label: 'seed list', code: { language: 'javascript', source: 'return [10, 20, 30]' } },
  {
    id: 'mapped', kind: 'map', label: 'triple each', itemsRef: '{{seed.result}}', concurrency: 2,
    bodySteps: [{ id: 'trip', kind: 'tool', label: 'triple', code: { language: 'javascript', source: 'return (data.v||0)*3', data: { v: '{{item}}' } } }],
  },
  {
    id: 'branch1', kind: 'branch', label: 'check count',
    when: { left: '{{mapped.count}}', op: 'eq', right: 3 },
    thenSteps: [{ id: 'yes', kind: 'tool', label: 'ok', code: { language: 'javascript', source: 'return "count-was-3"' } }],
    elseSteps: [{ id: 'no', kind: 'tool', label: 'no', code: { language: 'javascript', source: 'return "unexpected"' } }],
  },
  {
    id: 'loop1', kind: 'loop', label: 'count to 3', maxIterations: 10,
    until: { left: '{{$iteration}}', op: 'gte', right: 2 },
    bodySteps: [{ id: 'emit', kind: 'tool', label: 'emit', code: { language: 'javascript', source: 'return data.i', data: { i: '{{$index}}' } } }],
  },
]

const validation = validateWorkflowJSON({ version: 2, steps })
assert(validation.ok, `runtime workflow invalid: ${JSON.stringify(!validation.ok && validation.issues)}`)

const wf = await db.workflow.create({
  data: { userId: user.id, name: 'smoke-cf-wf', description: 'control flow smoke', stepsJson: JSON.stringify({ version: 2, steps }), trigger: 'manual', runtime: 'hosted' },
})
const run = await db.run.create({ data: { workflowId: wf.id, status: 'running', trigger: 'manual', startedAt: new Date() } })
await db.runStep.createMany({ data: steps.map((s, i) => ({ runId: run.id, stepId: s.id, kind: s.kind, label: s.label, status: 'pending', order: i })) })

await executeRun(run.id, { ...wf, userId: user.id } as never, steps as never, 'manual')

const finished = await db.run.findUnique({ where: { id: run.id } })
assert(finished?.status === 'completed', `run ended ${finished?.status}, expected completed`)

const allSteps = await db.runStep.findMany({ where: { runId: run.id }, orderBy: [{ order: 'asc' }] })
const mapOut = allSteps.find((s) => s.stepId === 'mapped' && s.parentStepId === null)
const mapResult = mapOut?.outputJson ? JSON.parse(mapOut.outputJson) : null
assert(mapResult?.count === 3, `map count ${mapResult?.count} != 3`)
// Each body step is a code_eval, whose output wraps the value as { result }.
const mapValues = (mapResult?.outputs ?? []).map((o: { result?: number }) => o?.result)
assert(JSON.stringify(mapValues) === JSON.stringify([30, 60, 90]), `map outputs wrong: ${JSON.stringify(mapValues)}`)

// Map body produced child rows with iterationIndex.
const childRows = allSteps.filter((s) => s.parentStepId === 'mapped')
assert(childRows.length === 3, `expected 3 map child rows, got ${childRows.length}`)
assert(childRows.every((r) => typeof r.iterationIndex === 'number'), 'map child rows missing iterationIndex')

const branchOut = allSteps.find((s) => s.stepId === 'branch1' && s.parentStepId === null)
const branchResult = branchOut?.outputJson ? JSON.parse(branchOut.outputJson) : null
assert(branchResult?.taken === 'then', `branch took ${branchResult?.taken}, expected then`)

const loopOut = allSteps.find((s) => s.stepId === 'loop1' && s.parentStepId === null)
const loopResult = loopOut?.outputJson ? JSON.parse(loopOut.outputJson) : null
assert(loopResult?.iterations === 3, `loop ran ${loopResult?.iterations} iterations, expected 3`)

console.log(`runtime: map=${JSON.stringify(mapResult.outputs)} branch=${branchResult.taken} loop=${loopResult.iterations}iters, ${childRows.length} map child rows`)

await db.workflow.deleteMany({ where: { id: wf.id } })
console.log('OK: 05-controlflow')
process.exit(0)
