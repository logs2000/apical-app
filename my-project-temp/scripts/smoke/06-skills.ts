// Smoke: skills — create, invoke (with params), use inside a workflow via a
// `skill` step, and version pinning (editing a skill doesn't change a workflow
// pinned to an older version). Needs DATABASE_URL. Run: bun scripts/smoke/06-skills.ts

import { db } from '../../src/lib/db'
import { loadSkill, executeSkillFragment, validateSkillFragment, loadSkillsBlock } from '../../src/lib/platform/skills'
import { validateWorkflowJSON } from '../../src/lib/workflow-schema'
import { executeRun } from '../../src/lib/runtime'
import type { WorkflowStep } from '../../src/lib/types'

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error(`FAIL: ${msg}`)
    process.exit(1)
  }
}

const user = await db.user.upsert({
  where: { email: 'smoke-skills@apical.test' },
  create: { email: 'smoke-skills@apical.test', name: 'Smoke Skills' },
  update: {},
})
await db.skill.deleteMany({ where: { userId: user.id } })
await db.workflow.deleteMany({ where: { userId: user.id, name: 'smoke-skill-wf' } })

// A skill: multiply the param `n` by 10 (a code fragment referencing {{param.n}}).
const specV1: WorkflowStep[] = [
  { id: 's1', kind: 'tool', label: 'times ten', code: { language: 'javascript', source: 'return (data.n||0)*10', data: { n: '{{param.n}}' } } },
]
assert(validateSkillFragment(specV1).ok, 'v1 fragment should validate')

const paramsSchema = { type: 'object', properties: { n: { type: 'number' } }, required: ['n'] }
const skill = await db.skill.create({
  data: { userId: user.id, name: 'times-ten', title: 'Times Ten', description: 'multiply n by 10', specJson: JSON.stringify(specV1), paramsSchemaJson: JSON.stringify(paramsSchema) },
})
await db.skillVersion.create({ data: { skillId: skill.id, number: 1, specJson: JSON.stringify(specV1), paramsSchemaJson: JSON.stringify(paramsSchema), author: 'user' } })

// Invoke it directly.
const loaded = await loadSkill(user.id, 'times-ten')
assert(loaded, 'skill should load')
const res = await executeSkillFragment(loaded!, { n: 5 }, { userId: user.id })
assert(res.ok, `skill run failed: ${res.error}`)
assert((res.output as { result?: number })?.result === 50, `expected 50, got ${JSON.stringify(res.output)}`)
console.log(`skill_invoke: times-ten(5) = ${(res.output as { result?: number }).result}`)

// Skills catalog block includes it.
const block = await loadSkillsBlock(user.id)
assert(block.includes('times-ten') && block.includes('params: n'), 'skills block missing skill/params')

// A workflow that USES the skill via a `skill` step, pinned to v1.
const steps: WorkflowStep[] = [
  { id: 'seed', kind: 'tool', label: 'seed', code: { language: 'javascript', source: 'return 7' } },
  { id: 'use', kind: 'tool', label: 'use skill', skill: { name: 'times-ten', version: 1, params: { n: '{{seed.result}}' } } },
]
const wfValid = validateWorkflowJSON({ version: 2, steps })
assert(wfValid.ok, `skill-using workflow invalid: ${JSON.stringify(!wfValid.ok && wfValid.issues)}`)

const wf = await db.workflow.create({
  data: { userId: user.id, name: 'smoke-skill-wf', description: 'uses a skill', stepsJson: JSON.stringify({ version: 2, steps }), trigger: 'manual', runtime: 'hosted' },
})

async function runWorkflow(): Promise<Record<string, unknown>> {
  const run = await db.run.create({ data: { workflowId: wf.id, status: 'running', trigger: 'manual', startedAt: new Date() } })
  await db.runStep.createMany({ data: steps.map((s, i) => ({ runId: run.id, stepId: s.id, kind: s.kind, label: s.label, status: 'pending', order: i })) })
  await executeRun(run.id, { ...wf, userId: user.id } as never, steps as never, 'manual')
  const useStep = await db.runStep.findFirst({ where: { runId: run.id, stepId: 'use' } })
  const status = (await db.run.findUnique({ where: { id: run.id } }))?.status
  return { status, output: useStep?.outputJson ? JSON.parse(useStep.outputJson) : null }
}

const r1 = await runWorkflow()
assert(r1.status === 'completed', `workflow run 1 ended ${r1.status}`)
assert((r1.output as { result?: number })?.result === 70, `expected 70 (7*10), got ${JSON.stringify(r1.output)}`)
console.log(`workflow skill step: 7 -> ${(r1.output as { result?: number }).result}`)

// Now EDIT the skill to v2 (multiply by 100). The workflow is pinned to v1,
// so its result must NOT change.
const specV2: WorkflowStep[] = [
  { id: 's1', kind: 'tool', label: 'times hundred', code: { language: 'javascript', source: 'return (data.n||0)*100', data: { n: '{{param.n}}' } } },
]
await db.skillVersion.create({ data: { skillId: skill.id, number: 2, specJson: JSON.stringify(specV2), paramsSchemaJson: JSON.stringify(paramsSchema), author: 'user' } })
await db.skill.update({ where: { id: skill.id }, data: { specJson: JSON.stringify(specV2), version: 2 } })

const r2 = await runWorkflow()
assert((r2.output as { result?: number })?.result === 70, `version pinning broken — expected still 70, got ${JSON.stringify(r2.output)}`)
console.log(`version pinning: workflow pinned to v1 still returns ${(r2.output as { result?: number }).result} after skill edited to v2`)

// A fresh invoke (latest) uses v2.
const latest = await loadSkill(user.id, 'times-ten')
const rLatest = await executeSkillFragment(latest!, { n: 5 }, { userId: user.id })
assert((rLatest.output as { result?: number })?.result === 500, `latest should be v2 (500), got ${JSON.stringify(rLatest.output)}`)

await db.workflow.deleteMany({ where: { id: wf.id } })
await db.skill.deleteMany({ where: { userId: user.id } })
console.log('OK: 06-skills')
process.exit(0)
