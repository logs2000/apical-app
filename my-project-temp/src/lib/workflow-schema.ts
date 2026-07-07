// Apical — WorkflowJSON v2 contract, defined in Zod.
//
// This module is the single source of truth for the public workflow format:
//   - The served JSON Schema (/schemas/workflow/v2.json) is generated from it.
//   - parseWorkflowJSON / parseSteps validate against it (no more silently
//     swallowing corrupt rows).
//   - /v1/workflows validate + deploy run `validateWorkflowJSON` before save.
//
// v2 is a superset of v1: it adds optional per-step `retry` + `timeoutMs`
// (consumed by the execution runtime) and formalizes the referential rules
// ({{stepId.field}} must target an EARLIER step).

import { z } from 'zod'
import {
  toolCapability,
  type DesktopCapability,
} from '@/lib/desktop/desktop-settings'
import type { WorkflowStep } from './types'

// ---------------- Step sub-specs ----------------

export const HttpCallSpecSchema = z
  .object({
    method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).describe('HTTP method.'),
    url: z.string().min(1).describe('Request URL. May use {{stepId.field}} and {{cred:service.field}} refs.'),
    headers: z.record(z.string(), z.string()).optional().describe('Request headers. Values may use {{cred:service.field}} vault refs.'),
    body: z.unknown().optional().describe('Request body. May use {{stepId.field}} refs to earlier step outputs.'),
    auth: z
      .object({
        type: z.enum(['bearer', 'apikey_header', 'basic', 'none']),
        ref: z.string().optional().describe('Credential vault reference, e.g. "cred_stripe".'),
        headerName: z.string().optional().describe('For apikey_header: which header carries the key.'),
      })
      .optional()
      .describe('Auth resolved from the credential vault at runtime.'),
    description: z.string().optional().describe('Friendly label for what this call does.'),
  })
  .describe('An inline raw HTTP call (no Integration record needed).')

export const McpCallSpecSchema = z
  .object({
    integrationId: z.string().min(1).describe('The MCP integration that owns the tool.'),
    tool: z.string().min(1).describe('MCP tool name to invoke.'),
    args: z.record(z.string(), z.unknown()).optional().describe('Tool arguments. May use {{stepId.field}} refs.'),
  })
  .describe('A deterministic MCP tool call — production runs invoke this without an agent.')

export const CodeCallSpecSchema = z
  .object({
    language: z.enum(['javascript', 'python', 'shell']),
    source: z.string().min(1).describe('The script source.'),
    data: z.unknown().optional().describe('Optional JSON passed as `data` to JS scripts.'),
    packages: z
      .array(z.string())
      .max(20)
      .optional()
      .describe('npm/PyPI packages installed into the script environment before running.'),
  })
  .describe('A deterministic code/script node — executes without an agent.')

// A reference to a reusable Skill. The workflow doc stores only name+version+
// params; the executable fragment is looked up from the pinned SkillVersion at
// run time (like an integration's frozen artifact — never inlined).
export const SkillRefSchema = z
  .object({
    name: z.string().min(1).describe('The skill slug.'),
    version: z.number().int().optional().describe('Pinned version (defaults to latest at deploy time).'),
    params: z.record(z.string(), z.unknown()).optional().describe('Param values; may use {{stepId.field}} refs.'),
  })
  .describe('Invoke a reusable Skill. Runs its pinned fragment with these params.')

export const RetryPolicySchema = z
  .object({
    maxAttempts: z.number().int().min(1).max(5).describe('Total attempts including the first (1-5).'),
    backoffMs: z.number().int().min(0).max(600_000).default(1000).describe('Base delay between attempts, in ms.'),
    backoffMultiplier: z.number().min(1).max(10).default(2).describe('Exponential backoff multiplier applied per retry.'),
  })
  .describe('Per-step retry policy (v2). Applies to tool steps that fail with a retryable error.')

// ---------------- Steps ----------------

export const StepKindSchema = z.enum(['tool', 'reason', 'gate', 'spawn', 'branch', 'loop', 'map'])

/** Every step kind the schema knows. Normalizers must preserve these verbatim —
 *  coercing an unknown-but-known kind to `tool` silently breaks the step. */
export const KNOWN_STEP_KINDS: readonly string[] = StepKindSchema.options

// A deterministic comparison used by branch (when) and loop (until). No eval —
// a fixed operator over a ref-able left value and an optional literal right.
export const ConditionSchema = z
  .object({
    left: z.string().describe('Value to test — usually a {{stepId.field}} / {{item.field}} ref.'),
    op: z.enum(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains', 'truthy', 'falsy']),
    right: z.unknown().optional().describe('Comparison value (not needed for truthy/falsy).'),
  })
  .describe('A deterministic condition. left is compared to right using op.')

export const WorkflowStepSchema: z.ZodType<WorkflowStep> = z
  .object({
    id: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-zA-Z0-9_-]+$/, 'Step ids are alphanumeric with _ or - only.')
      .describe('Unique step id, referenced by later steps via {{stepId.field}}.'),
    kind: StepKindSchema.describe('tool = deterministic call; reason = bounded LLM judgment; gate = human approval pause; spawn = delegated subagent task.'),
    label: z.string().min(1).max(300).describe('Human-readable step label shown in run reports.'),

    // ---- tool steps ----
    tool: z.string().optional().describe('For tool steps: the named tool to call, e.g. "gmail.send" or "rule.apply".'),
    inputs: z.record(z.string(), z.unknown()).optional().describe('For tool steps: inputs. May reference earlier outputs via {{stepId.field}}.'),
    http: HttpCallSpecSchema.optional(),
    mcp: McpCallSpecSchema.optional(),
    code: CodeCallSpecSchema.optional(),
    skill: SkillRefSchema.optional(),
    integrationId: z.string().optional().describe('Integration that owns this tool step.'),

    // ---- reason steps ----
    prompt: z.string().optional().describe('For reason steps: the prompt the model reasons over (required for kind=reason).'),
    allowedTools: z.array(z.string()).optional().describe('For reason steps: tools the model may call while reasoning.'),
    outputShape: z.record(z.string(), z.string()).optional().describe('For reason steps: required output fields → type descriptions.'),
    confidenceThreshold: z.number().min(0).max(1).optional().describe('Below this confidence the run flags the item for human review.'),

    // ---- spawn steps ----
    spawnPrompt: z.string().optional().describe('For spawn steps: the task delegated to a temporary subagent (required for kind=spawn).'),
    spawnTools: z.array(z.string()).optional(),
    spawnOutputShape: z.record(z.string(), z.string()).optional(),

    // ---- gate steps ----
    gateMessage: z.string().optional().describe('For gate steps: what the human is approving.'),

    // ---- control flow (v2) ----
    // branch: run thenSteps when `when` is true, else elseSteps.
    when: ConditionSchema.optional().describe('For branch steps: the condition deciding then vs else.'),
    thenSteps: z.array(z.lazy((): z.ZodType<WorkflowStep> => WorkflowStepSchema)).optional().describe('For branch steps: steps run when `when` is true.'),
    elseSteps: z.array(z.lazy((): z.ZodType<WorkflowStep> => WorkflowStepSchema)).optional().describe('For branch steps: steps run when `when` is false.'),
    // loop: repeat bodySteps over loopOver (an array ref) OR until `until` is true.
    loopOver: z.string().optional().describe('For loop steps: a {{stepId.field}} ref to an array to iterate.'),
    until: ConditionSchema.optional().describe('For loop steps: stop when this condition becomes true.'),
    bodySteps: z.array(z.lazy((): z.ZodType<WorkflowStep> => WorkflowStepSchema)).optional().describe('For loop/map steps: the steps run each iteration.'),
    maxIterations: z.number().int().min(1).max(100).optional().describe('For loop steps: hard cap on iterations (default 10).'),
    // map: run bodySteps once per item in itemsRef, up to `concurrency` in parallel.
    itemsRef: z.string().optional().describe('For map steps: a {{stepId.field}} ref to the array to map over.'),
    concurrency: z.number().int().min(1).max(8).optional().describe('For map steps: parallel iterations (default 4).'),
    continueOnError: z.boolean().optional().describe('For map steps: keep going if one item fails.'),

    // ---- hardening ----
    hardened: z.boolean().optional().describe('True when this step was flipped from reason → deterministic rule.'),
    rule: z.string().optional().describe('The deterministic rule applied when hardened.'),

    // ---- v2 execution controls ----
    retry: RetryPolicySchema.optional(),
    timeoutMs: z.number().int().min(1000).max(3_600_000).optional().describe('Hard per-step timeout in ms (v2).'),

    note: z.string().optional().describe('Optional note shown in the UI.'),
  })
  .describe('A single workflow step.')

export const WorkflowJSONSchema = z
  .object({
    version: z
      .union([z.literal(1), z.literal(2)])
      .describe('Schema version. v2 adds retry/timeoutMs; v1 documents remain valid v2 documents.'),
    steps: z.array(WorkflowStepSchema).describe('Ordered list of steps. Later steps may reference earlier outputs.'),
  })
  .describe('An Apical workflow: an ordered list of deterministic nodes executed without an agent.')

export type WorkflowJSONInput = z.input<typeof WorkflowJSONSchema>

// ---------------- AutomationFile ----------------

export const AutomationFileSchema = z
  .object({
    apicalVersion: z.union([z.literal(1), z.literal(2)]).describe('AutomationFile format version.'),
    name: z.string().min(1).max(200).describe('Workflow name.'),
    description: z.string().max(2000).optional().describe('One-line description of what the workflow does.'),
    trigger: z
      .object({
        type: z.enum(['manual', 'schedule']),
        schedule: z.string().optional().describe('For schedule triggers: cron or natural-language schedule, e.g. "every day at 9am".'),
      })
      .optional(),
    integrations: z
      .array(
        z.object({
          id: z.string().min(1).describe('Local id referenced by steps via integrationId.'),
          name: z.string().min(1),
          kind: z.enum(['mcp', 'api', 'http']),
          description: z.string().optional(),
          config: z.record(z.string(), z.unknown()).optional().describe('IntegrationConfig: url/specUrl/auth/mcp transport.'),
        }),
      )
      .optional()
      .describe('Inline integrations installed on import.'),
    credentials: z
      .array(
        z.object({
          service: z.string().min(1).describe('Vault service key, referenced via {{cred:service.field}}.'),
          fields: z.array(z.string()).min(1).describe('Field names the user must supply (values are NEVER embedded in the file).'),
          description: z.string().optional(),
        }),
      )
      .optional()
      .describe('Credential placeholders the importer prompts for. AutomationFiles never contain secret values.'),
    steps: z.array(WorkflowStepSchema).min(1),
  })
  .describe('A portable, self-contained workflow definition: steps + inline integrations + credential placeholders.')

// ---------------- Validation (schema + referential) ----------------

export interface WorkflowValidationIssue {
  path: string
  message: string
}

export type WorkflowValidationResult =
  | { ok: true; workflow: z.output<typeof WorkflowJSONSchema>; warnings: WorkflowValidationIssue[] }
  | { ok: false; issues: WorkflowValidationIssue[]; warnings: WorkflowValidationIssue[] }

/**
 * Rewrite common near-miss ref syntaxes to their canonical form so
 * agent-authored workflows don't fail validation over punctuation. Only the
 * unambiguous aliases are rewritten:
 *   {{cred.svc.field}}  -> {{cred:svc.field}}  (a colon, not a dot, opens a vault ref)
 *   {{steps.sId.field}} -> {{sId.field}}       (step outputs are read by id — there is no "steps." namespace)
 *   {{step.sId.field}}  -> {{sId.field}}
 * Ambiguous namespaces (e.g. {{lead.x}}) are left untouched so validation can
 * surface a helpful error instead of guessing.
 */
function normalizeRefToken(inner: string): string {
  const t = inner.trim()
  if (/^cred\./.test(t)) return `cred:${t.slice('cred.'.length)}`
  if (/^steps\./.test(t)) return t.slice('steps.'.length)
  if (/^step\./.test(t)) return t.slice('step.'.length)
  return t
}

/** Rewrite every {{...}} token in a string to its canonical form. */
function normalizeRefsInString(s: string): string {
  return s.replace(/\{\{([^}]+)\}\}/g, (_m, inner) => `{{${normalizeRefToken(inner)}}}`)
}

/** Deep-copy a value with all {{...}} refs in its string leaves normalized. */
function normalizeRefsDeep<T>(value: T): T {
  if (typeof value === 'string') return normalizeRefsInString(value) as unknown as T
  if (Array.isArray(value)) return value.map((v) => normalizeRefsDeep(v)) as unknown as T
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) out[k] = normalizeRefsDeep(v)
    return out as unknown as T
  }
  return value
}

/** Extract {{...}} refs from any JSON-serializable value. */
function extractRefs(value: unknown): string[] {
  const out: string[] = []
  const visit = (v: unknown) => {
    if (typeof v === 'string') {
      for (const m of v.matchAll(/\{\{([^}]+)\}\}/g)) out.push(m[1].trim())
    } else if (Array.isArray(v)) {
      v.forEach(visit)
    } else if (v && typeof v === 'object') {
      Object.values(v).forEach(visit)
    }
  }
  visit(value)
  return out
}

/**
 * Full contract validation: Zod schema + referential rules.
 *   - step ids unique
 *   - kind-specific requirements (tool steps need an executable spec,
 *     reason needs prompt, spawn needs spawnPrompt)
 *   - {{stepId.field}} refs target an EARLIER step (cred:/trigger refs allowed)
 */
export function validateWorkflowJSON(data: unknown): WorkflowValidationResult {
  const warnings: WorkflowValidationIssue[] = []
  const parsed = WorkflowJSONSchema.safeParse(data)
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((i) => ({
        path: i.path.join('.') || '(root)',
        message: i.message,
      })),
      warnings,
    }
  }

  const issues: WorkflowValidationIssue[] = []
  const wf = parsed.data
  const seen = new Set<string>()

  // Recursively validate a list of steps in a scope. `visiblePrior` is the set
  // of step ids that resolve here (accumulated left-to-right, including ids from
  // enclosing scopes that came before this block). `scopeVars` are the special
  // namespaces the current block introduces ({{item}}, {{$index}}, {{$iteration}}).
  type WStep = z.output<typeof WorkflowStepSchema>
  const validateSteps = (steps: WStep[], path: string, visiblePrior: Set<string>, scopeVars: Set<string>, inBody = false) => {
    const priorHere = new Set(visiblePrior)
    steps.forEach((step, idx) => {
      const at = `${path}.${idx}`
      if (seen.has(step.id)) {
        issues.push({ path: `${at}.id`, message: `Duplicate step id "${step.id}".` })
      }
      seen.add(step.id)

      // Kind-specific requirements.
      if (step.kind === 'tool' && !step.tool && !step.http && !step.mcp && !step.code && !step.skill) {
        issues.push({ path: at, message: `Tool step "${step.id}" needs one of: tool, http, mcp, code, or skill.` })
      }
      if (step.kind === 'reason' && !step.prompt) {
        issues.push({ path: `${at}.prompt`, message: `Reason step "${step.id}" requires a prompt.` })
      }
      if (step.kind === 'spawn' && !step.spawnPrompt) {
        issues.push({ path: `${at}.spawnPrompt`, message: `Spawn step "${step.id}" requires spawnPrompt.` })
      }
      if (step.kind === 'gate' && !step.gateMessage) {
        warnings.push({ path: `${at}.gateMessage`, message: `Gate step "${step.id}" has no gateMessage; a generic approval prompt will be shown.` })
      }
      // Gates inside a control body aren't supported yet (resuming a paused run
      // can't re-enter nested/parallel scopes). Keep gates at the top level.
      if (step.kind === 'gate' && inBody) {
        issues.push({ path: at, message: `Gate step "${step.id}" cannot be inside a branch/loop/map body (not supported yet). Move it to the top level.` })
      }
      if (step.kind === 'branch') {
        if (!step.when) issues.push({ path: `${at}.when`, message: `Branch step "${step.id}" requires a "when" condition.` })
        if (!step.thenSteps || step.thenSteps.length === 0) issues.push({ path: `${at}.thenSteps`, message: `Branch step "${step.id}" requires thenSteps.` })
      }
      if (step.kind === 'loop') {
        if (!step.loopOver && !step.until) issues.push({ path: at, message: `Loop step "${step.id}" requires loopOver (an array ref) or until (a condition).` })
        if (!step.bodySteps || step.bodySteps.length === 0) issues.push({ path: `${at}.bodySteps`, message: `Loop step "${step.id}" requires bodySteps.` })
      }
      if (step.kind === 'map') {
        if (!step.itemsRef) issues.push({ path: `${at}.itemsRef`, message: `Map step "${step.id}" requires itemsRef (an array ref).` })
        if (!step.bodySteps || step.bodySteps.length === 0) issues.push({ path: `${at}.bodySteps`, message: `Map step "${step.id}" requires bodySteps.` })
      }

      // Normalize near-miss ref syntaxes in place.
      if (step.inputs) step.inputs = normalizeRefsDeep(step.inputs)
      if (step.http) step.http = normalizeRefsDeep(step.http)
      if (step.mcp) step.mcp = normalizeRefsDeep(step.mcp)
      if (step.code) step.code = normalizeRefsDeep(step.code)
      if (step.prompt) step.prompt = normalizeRefsInString(step.prompt)
      if (step.spawnPrompt) step.spawnPrompt = normalizeRefsInString(step.spawnPrompt)

      // Referential integrity: refs may target a visible prior step, an
      // enclosing-scope var, or a global namespace. `until` is special — it is
      // evaluated in the loop BODY scope, so it may use this loop's body vars.
      const bodyScopeVars = new Set(scopeVars)
      if (step.kind === 'loop') {
        bodyScopeVars.add('$index').add('$iteration')
        if (step.loopOver) bodyScopeVars.add('item')
      }
      const checkRefs = (values: unknown, allowed: Set<string>) => {
        for (const ref of extractRefs(values)) {
          if (ref.startsWith('cred:') || ref.startsWith('trigger') || ref.startsWith('env:')) continue
          const target = ref.split('.')[0]
          if (allowed.has(target)) continue
          if (target === step.id) {
            issues.push({ path: at, message: `Step "${step.id}" references its own output ({{${ref}}}).` })
          } else if (!priorHere.has(target)) {
            issues.push({
              path: at,
              message:
                `Step "${step.id}" references {{${ref}}} but "${target}" is not an earlier step in scope. ` +
                `Valid references are {{stepId.field}} (an earlier step's output), {{trigger.field}}, {{cred:service.field}}, {{env:VAR}}` +
                (allowed.size ? `, and in this block ${[...allowed].map((v) => `{{${v}}}`).join(', ')}` : '') + '.',
            })
          }
        }
      }
      checkRefs(
        { inputs: step.inputs, http: step.http, mcp: step.mcp, code: step.code, skill: step.skill, prompt: step.prompt, spawnPrompt: step.spawnPrompt, loopOver: step.loopOver, itemsRef: step.itemsRef, when: step.when },
        scopeVars,
      )
      checkRefs({ until: step.until }, bodyScopeVars)

      // Descend into nested blocks. Body steps see everything visible here plus
      // the earlier siblings, and gain the block's scope vars.
      if (step.kind === 'branch') {
        const inner = new Set(priorHere)
        if (step.thenSteps) validateSteps(step.thenSteps as WStep[], `${at}.thenSteps`, inner, scopeVars, true)
        if (step.elseSteps) validateSteps(step.elseSteps as WStep[], `${at}.elseSteps`, inner, scopeVars, true)
      } else if (step.kind === 'loop' || step.kind === 'map') {
        const inner = new Set(priorHere)
        const bodyVars = new Set(scopeVars)
        bodyVars.add('$index')
        if (step.kind === 'loop') bodyVars.add('$iteration')
        if (step.loopOver || step.itemsRef) bodyVars.add('item')
        if (step.bodySteps) validateSteps(step.bodySteps as WStep[], `${at}.bodySteps`, inner, bodyVars, true)
      }

      priorHere.add(step.id)
    })
  }

  validateSteps(wf.steps as WStep[], 'steps', new Set(), new Set())

  if (issues.length > 0) return { ok: false, issues, warnings }
  return { ok: true, workflow: wf, warnings }
}

// ---------------- Published JSON Schema documents ----------------

const SCHEMA_BASE = 'https://apical.dev/schemas'

/** JSON Schema for WorkflowJSON v2, generated from the Zod source of truth. */
export function workflowJsonSchemaDoc(): Record<string, unknown> {
  const doc = z.toJSONSchema(WorkflowJSONSchema, { target: 'draft-2020-12' }) as Record<string, unknown>
  return {
    $id: `${SCHEMA_BASE}/workflow/v2.json`,
    title: 'Apical WorkflowJSON v2',
    ...doc,
  }
}

/** JSON Schema for AutomationFile, generated from the Zod source of truth. */
export function automationFileSchemaDoc(): Record<string, unknown> {
  const doc = z.toJSONSchema(AutomationFileSchema, { target: 'draft-2020-12' }) as Record<string, unknown>
  return {
    $id: `${SCHEMA_BASE}/automation-file/v1.json`,
    title: 'Apical AutomationFile',
    ...doc,
  }
}

// ---------------- Runtime inference ----------------

const DESKTOP_TOOL_PREFIXES = ['fs.', 'fs_', 'desktop.fs.', 'desktop.cli.', 'script_run', 'cli_run']

function stepUsesDesktopTools(step: WorkflowStep): boolean {
  if (step.kind !== 'tool') return false
  const tool = (step.tool ?? '').toLowerCase()
  if (DESKTOP_TOOL_PREFIXES.some((p) => tool.startsWith(p) || tool.includes(p))) return true
  if (step.code?.language === 'shell') return true
  return false
}

/** Infer workflow runtime from step contents when not explicitly set. */
export function inferRuntimeFromSteps(steps: WorkflowStep[]): 'local' | 'hosted' {
  return steps.some(stepUsesDesktopTools) ? 'local' : 'hosted'
}

/** Desktop capabilities a workflow needs when run remotely (via bridge). */
export function requiredDesktopCapabilitiesFromSteps(
  steps: WorkflowStep[],
): DesktopCapability[] {
  const caps = new Set<DesktopCapability>()
  for (const step of steps) {
    if (step.kind !== 'tool') continue
    const tool = step.tool ?? ''
    if (tool.startsWith('desktop.')) {
      const cap = toolCapability(tool)
      if (cap) caps.add(cap)
    } else if (stepUsesDesktopTools(step)) {
      if (step.code?.language === 'shell' || tool.includes('cli')) caps.add('cli')
      else caps.add('fs_read')
    }
  }
  return Array.from(caps)
}
