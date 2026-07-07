// Skills — reusable, versioned, parameterized capabilities.
//
// A Skill's executable spec is a WorkflowStep[] fragment (one representation
// covers single- and multi-step skills; execution reuses the workflow runtime).
// Inside a fragment, {{param.x}} refers to a declared parameter. Both the
// interactive agent (skill_invoke) and frozen workflows (a tool step carrying
// `skill`) run the same fragment.

import { db } from '@/lib/db'
import { validateWorkflowJSON } from '@/lib/workflow-schema'
import { executeProductionStep } from '@/lib/platform/workflow-executor'
import type { WorkflowStep } from '@/lib/types'

export interface SkillDef {
  id: string
  name: string
  title: string
  description: string
  paramsSchema: Record<string, unknown>
  spec: WorkflowStep[]
  docsMd: string | null
  version: number
}

function parseSpec(specJson: string): WorkflowStep[] {
  try {
    const parsed = JSON.parse(specJson)
    return Array.isArray(parsed) ? (parsed as WorkflowStep[]) : []
  } catch {
    return []
  }
}

/** Load a skill by name for a user, optionally pinned to a version. */
export async function loadSkill(userId: string, name: string, version?: number): Promise<SkillDef | null> {
  const skill = await db.skill.findFirst({ where: { userId, name, status: 'active' } })
  if (!skill) return null
  let specJson = skill.specJson
  let paramsSchemaJson = skill.paramsSchemaJson
  let effectiveVersion = skill.version
  if (version && version !== skill.version) {
    const v = await db.skillVersion.findFirst({ where: { skillId: skill.id, number: version } })
    if (!v) return null
    specJson = v.specJson
    paramsSchemaJson = v.paramsSchemaJson
    effectiveVersion = v.number
  }
  return {
    id: skill.id,
    name: skill.name,
    title: skill.title,
    description: skill.description,
    paramsSchema: JSON.parse(paramsSchemaJson) as Record<string, unknown>,
    spec: parseSpec(specJson),
    docsMd: skill.docsMd,
    version: effectiveVersion,
  }
}

/**
 * Validate a skill fragment. Reuses the workflow validator by wrapping the
 * fragment as a workflow whose refs may include the {{param.*}} namespace.
 * Since validateWorkflowJSON doesn't know `param`, we pre-seed a synthetic
 * first step is unnecessary — instead we tolerate param refs by checking the
 * fragment stands alone otherwise.
 */
export function validateSkillFragment(spec: WorkflowStep[]): { ok: boolean; issues: string[] } {
  if (!Array.isArray(spec) || spec.length === 0) return { ok: false, issues: ['skill has no steps'] }
  // Replace {{param.x}} refs with {{trigger.x}} for validation — both are
  // externally-provided namespaces the validator already allows.
  const forCheck = JSON.parse(JSON.stringify(spec).replace(/\{\{\s*param\./g, '{{trigger.')) as unknown[]
  const res = validateWorkflowJSON({ version: 2, steps: forCheck })
  if (res.ok) return { ok: true, issues: [] }
  return { ok: false, issues: res.issues.map((i) => `${i.path}: ${i.message}`) }
}

/** Bump usage counter (best-effort). */
export async function recordSkillUse(skillId: string): Promise<void> {
  await db.skill.update({ where: { id: skillId }, data: { timesUsed: { increment: 1 } } }).catch(() => {})
}

export interface SkillRunResult {
  ok: boolean
  output: unknown
  error?: string
  stepOutputs: Record<string, unknown>
}

/**
 * Execute a skill fragment with the given params. Each fragment step runs
 * deterministically via the workflow executor; {{param.x}} + earlier step
 * outputs resolve from a scoped map. Returns the last step's output.
 * (v1: fragments are linear tool/http/mcp/code steps — nested control flow
 * inside a skill is not executed here.)
 */
export async function executeSkillFragment(
  skill: SkillDef,
  params: Record<string, unknown>,
  ctx: { userId: string; runtime?: 'local' | 'hosted' },
): Promise<SkillRunResult> {
  const outputs: Record<string, unknown> = { param: params }
  let last: unknown = null
  for (const step of skill.spec) {
    const res = await executeProductionStep(step, {
      userId: ctx.userId,
      workflowId: `skill:${skill.id}`,
      runId: `skill:${skill.id}`,
      runtime: ctx.runtime ?? 'hosted',
      outputs,
    })
    if (!res) {
      return { ok: false, output: null, error: `Skill step "${step.id}" has no executable spec (control-flow inside skills isn't supported yet).`, stepOutputs: outputs }
    }
    if (!res.ok) {
      return { ok: false, output: res.output, error: res.error ?? `step ${step.id} failed`, stepOutputs: outputs }
    }
    outputs[step.id] = res.output
    last = res.output
  }
  return { ok: true, output: last, stepOutputs: outputs }
}

/**
 * The skills catalog block injected into the agent's system context — a compact
 * one-line-per-skill list so the agent prefers invoking a proven skill over
 * re-deriving multi-step work. Never includes secrets.
 */
export async function loadSkillsBlock(userId: string): Promise<string> {
  const skills = await db.skill.findMany({
    where: { userId, status: 'active' },
    orderBy: [{ timesUsed: 'desc' }, { updatedAt: 'desc' }],
    take: 20,
    select: { name: true, title: true, description: true, paramsSchemaJson: true },
  })
  if (skills.length === 0) return ''
  const lines = skills.map((s) => {
    let params = ''
    try {
      const schema = JSON.parse(s.paramsSchemaJson) as { properties?: Record<string, unknown> }
      const keys = Object.keys(schema.properties ?? {})
      if (keys.length) params = ` (params: ${keys.join(', ')})`
    } catch {
      /* ignore */
    }
    return `- ${s.name}: ${s.title}${params} — ${s.description}`
  })
  return (
    `YOUR SKILLS — reusable capabilities you built. PREFER invoking a skill ` +
    `(skill_invoke) over re-deriving multi-step work; after doing novel ` +
    `multi-step work, save it as a skill (skill_save) so next time is one call:\n${lines.join('\n')}\n\n`
  )
}
