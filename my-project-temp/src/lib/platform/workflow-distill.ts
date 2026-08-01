// Distill exploratory agent traces into short, hardcoded production workflows.
//
// Grounding guarantee: distilled steps must be traceable to the PROVEN trace.
// The LLM may reorganize and label, but every executable payload (script
// source, HTTP URL, CLI command, MCP tool) must have appeared in the trace —
// LLM-invented steps are rejected and we fall back to the trace-derived
// steps. Nothing job-specific is hardcoded here; labels derive from the
// actual tools and inputs used.

import { normalizeSteps } from '@/lib/deploy'
import { chat, resolveModelPreferenceForUser } from '@/lib/platform/llm-gateway'
import { validateWorkflowJSON } from '@/lib/workflow-schema'
import {
  agentToolName,
  humanWorkflowLabel,
  isSubstantiveTraceStep,
  traceStepHasExecutableParams,
  type EngineTraceStep,
} from '@/lib/platform/workflow-trace'
import type { WorkflowStep } from '@/lib/types'

export const MAX_DISTILLED_STEPS = 8

function str(v: unknown, max = 500): string {
  if (typeof v !== 'string') return ''
  return v.slice(0, max)
}

function shortPath(p: string): string {
  const home = p.replace(/^\/Users\/[^/]+/, '~')
  return home.length > 60 ? `…${home.slice(-57)}` : home
}

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url.slice(0, 40)
  }
}

function summarizeTraceForPrompt(trace: EngineTraceStep[]): string {
  return trace
    .filter(isSubstantiveTraceStep)
    .slice(0, 50)
    .map((s, i) => {
      const tool = agentToolName(s.tool ?? '')
      const input = JSON.stringify(s.input ?? {}).slice(0, 800)
      const result = (s.result ?? '').slice(0, 200)
      return `${i + 1}. ${tool} | input: ${input}${result ? ` | result: ${result}` : ''}`
    })
    .join('\n')
}

/** A step that embeds a large inline content literal — a one-run snapshot
 *  (e.g. asset_save with a full HTML/JSON document) that should be distilled so
 *  the LLM can regenerate/parameterize it instead of freezing a copy. */
function hasLargeInlineLiteral(trace: EngineTraceStep[]): boolean {
  const CONTENT_KEYS = ['content', 'body', 'text', 'html', 'data', 'markdown']
  return trace.filter(isSubstantiveTraceStep).some((s) => {
    const input = s.input ?? {}
    return CONTENT_KEYS.some((k) => {
      const v = (input as Record<string, unknown>)[k]
      return typeof v === 'string' && v.length > 1500
    })
  })
}

/** True when the trace looks like exploratory work that should be distilled. */
export function shouldDistillTrace(trace: EngineTraceStep[]): boolean {
  const substantive = trace.filter(isSubstantiveTraceStep)
  if (substantive.length === 0) return false
  // Always distill when a step froze a big one-run content blob, even for short
  // traces — otherwise the workflow is just a snapshot of a single run.
  if (hasLargeInlineLiteral(trace)) return true
  if (substantive.length <= 3) return false
  const counts = new Map<string, number>()
  for (const s of substantive) {
    const t = s.tool ?? 'tool'
    counts.set(t, (counts.get(t) ?? 0) + 1)
  }
  if (substantive.length > 4) return true
  return [...counts.values()].some((c) => c >= 3)
}

function parseStepsJson(raw: string): WorkflowStep[] | null {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
  try {
    const parsed = JSON.parse(cleaned) as { steps?: unknown[] } | unknown[]
    const arr = Array.isArray(parsed) ? parsed : parsed.steps
    if (!Array.isArray(arr) || arr.length === 0) return null
    return normalizeSteps(arr).slice(0, MAX_DISTILLED_STEPS)
  } catch {
    return null
  }
}

function validateDistilledSteps(steps: WorkflowStep[]): WorkflowStep[] {
  const executable = steps.filter((s) => {
    if (s.kind !== 'tool') return true
    const fake: EngineTraceStep = {
      stepId: s.id,
      kind: 'tool',
      label: s.label,
      tool: s.tool,
      input: (s.inputs ?? {}) as Record<string, unknown>,
      status: 'done',
    }
    if (s.http?.url) return true
    if (s.code?.source) return true
    if (s.mcp?.tool) return true
    return traceStepHasExecutableParams(fake)
  })
  // Must also pass the same schema the /v1 save path enforces.
  const check = validateWorkflowJSON({ version: 1, steps: executable })
  return check.ok ? executable : []
}

// ---------------- Trace grounding ----------------

/** The distinctive executable payloads observed in the real trace. */
function traceEvidence(trace: EngineTraceStep[]): {
  codes: string[]
  urls: string[]
  commands: string[]
  mcpTools: string[]
  paths: string[]
} {
  const codes: string[] = []
  const urls: string[] = []
  const commands: string[] = []
  const mcpTools: string[] = []
  const paths: string[] = []
  for (const s of trace.filter(isSubstantiveTraceStep)) {
    const input = s.input ?? {}
    const code = str(input.code, 20_000)
    if (code) codes.push(code)
    const url = str(input.url, 2000)
    if (url) urls.push(url)
    const command = str(input.command, 2000)
    if (command) commands.push(command)
    const mcpTool = str(input.tool, 200)
    if (mcpTool) mcpTools.push(mcpTool)
    for (const key of ['path', 'from', 'to', 'outputPath'] as const) {
      const p = str(input[key], 2000)
      if (p) paths.push(p)
    }
  }
  return { codes, urls, commands, mcpTools, paths }
}

/** Normalized containment check (whitespace-insensitive for code). */
function evidenceContains(haystack: string[], needle: string): boolean {
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim()
  const n = norm(needle)
  if (!n) return false
  // Template-aware grounding: a parameterized payload ({{trigger.x}},
  // {{stepId.field}}, {{cred:...}}) is grounded when its literal (non-template)
  // fragments all appear in a real trace payload. This lets the distiller hoist
  // per-run values into refs without being rejected as "not in the trace".
  if (/\{\{[^}]+\}\}/.test(n)) {
    const fragments = n
      .split(/\{\{[^}]+\}\}/)
      .map((f) => f.trim())
      .filter((f) => f.length >= 4)
    if (fragments.length === 0) return true
    return haystack.some((h) => {
      const hn = norm(h)
      return fragments.every((f) => hn.includes(f))
    })
  }
  return haystack.some((h) => {
    const hn = norm(h)
    return hn === n || hn.includes(n) || n.includes(hn)
  })
}

/**
 * True when every executable payload in `steps` is grounded in the trace.
 * Grounded = the script source / URL / command / MCP tool appeared in a real
 * (proven) tool call. Labels and step order may differ; payloads may not.
 */
export function stepsGroundedInTrace(
  steps: WorkflowStep[],
  trace: EngineTraceStep[],
): { ok: boolean; ungrounded: string[] } {
  const evidence = traceEvidence(trace)
  const ungrounded: string[] = []
  for (const s of steps) {
    if (s.kind !== 'tool') continue // reason/gate steps carry no external payload
    if (s.code?.source && !evidenceContains(evidence.codes, s.code.source)) {
      ungrounded.push(`${s.id}: script source not in trace`)
      continue
    }
    if (s.http?.url && !evidenceContains(evidence.urls, s.http.url)) {
      ungrounded.push(`${s.id}: URL ${s.http.url} not in trace`)
      continue
    }
    if (s.mcp?.tool && !evidenceContains(evidence.mcpTools, s.mcp.tool)) {
      ungrounded.push(`${s.id}: MCP tool ${s.mcp.tool} not in trace`)
      continue
    }
    const cmd = str((s.inputs ?? {}).command, 2000)
    if (cmd && !evidenceContains(evidence.commands, cmd)) {
      ungrounded.push(`${s.id}: command not in trace`)
    }
  }
  return { ok: ungrounded.length === 0, ungrounded }
}

// ---------------- Document primitives ----------------

/**
 * Tools that cannot be rewritten as a script and must survive distillation
 * intact. Reading a scan needs a vision model; filling an AcroForm needs the
 * PDF object graph; appending to .xlsx needs the workbook. A distiller that
 * "simplifies" these into a code node deletes the capability, so they are
 * carried through as tool nodes with their inputs.
 */
const DOCUMENT_TOOLS = new Set([
  'doc_extract',
  'pdf_form_fields',
  'pdf_fill',
  'sheet_read',
  'sheet_append',
  'notify',
])

/** The inputs a document step needs to replay, dropping per-run noise. */
function documentStepInputs(tool: string, input: Record<string, unknown>): Record<string, unknown> {
  const source: Record<string, unknown> = {}
  for (const key of ['path', 'assetId', 'url'] as const) {
    const v = str(input[key], 2000)
    if (v) source[key] = v
  }
  switch (tool) {
    case 'doc_extract':
      return {
        ...source,
        ...(Array.isArray(input.fields) ? { fields: input.fields } : {}),
        ...(str(input.instructions, 4000) ? { instructions: str(input.instructions, 4000) } : {}),
      }
    case 'pdf_fill':
      return {
        ...source,
        values: input.values ?? {},
        ...(str(input.outputPath, 2000) ? { outputPath: str(input.outputPath, 2000) } : {}),
        ...(input.flatten != null ? { flatten: input.flatten } : {}),
      }
    case 'sheet_append':
      return {
        ...source,
        rows: input.rows ?? [],
        ...(str(input.sheetName, 200) ? { sheetName: str(input.sheetName, 200) } : {}),
        ...(str(input.outputPath, 2000) ? { outputPath: str(input.outputPath, 2000) } : {}),
      }
    case 'sheet_read':
      return {
        ...source,
        ...(str(input.sheetName, 200) ? { sheetName: str(input.sheetName, 200) } : {}),
      }
    case 'notify':
      return {
        title: str(input.title, 200),
        body: str(input.body, 4000),
        ...(str(input.channel, 20) ? { channel: str(input.channel, 20) } : {}),
      }
    default:
      return source
  }
}

/**
 * Dedupe key for a document step. Keyed on the OPERATION and its destination
 * rather than the source file, so "read each of 20 scans" becomes one node
 * while genuinely distinct operations (two different output sheets) stay
 * separate.
 */
function docDedupeKey(tool: string, input: Record<string, unknown>): string {
  switch (tool) {
    case 'pdf_fill':
      return str(input.outputPath, 2000) || str(input.path, 2000) || 'fill'
    case 'sheet_append':
    case 'sheet_read':
      return str(input.outputPath, 2000) || str(input.path, 2000) || str(input.assetId, 200) || 'sheet'
    case 'notify':
      return str(input.title, 200) || 'notify'
    default:
      // doc_extract / pdf_form_fields: one node per requested field set, since
      // reading IDs and reading pay stubs are different steps.
      return Array.isArray(input.fields) ? input.fields.map(String).sort().join(',') : 'doc'
  }
}

// ---------------- Heuristic distill (generic, no job assumptions) ----------------

/**
 * Heuristic distill — no LLM, no job-specific assumptions. Keeps each UNIQUE
 * executable operation from the trace (scripts, CLI commands, HTTP calls,
 * MCP calls, file moves) in order, dropping repeated exploration (multiple
 * fs_list of the same tree, web_search, credential_list). Labels derive from
 * the actual tool + inputs.
 */
export function heuristicDistillTrace(
  trace: EngineTraceStep[],
  _jobDescription: string,
): WorkflowStep[] {
  const substantive = trace.filter(isSubstantiveTraceStep)
  const steps: WorkflowStep[] = []
  let idx = 1
  const seen = new Set<string>()

  const push = (step: WorkflowStep, dedupeKey: string) => {
    if (seen.has(dedupeKey) || steps.length >= MAX_DISTILLED_STEPS) return
    seen.add(dedupeKey)
    steps.push(step)
  }

  let listedOnce = false
  for (const s of substantive) {
    const t = agentToolName(s.tool ?? '')
    const input = s.input ?? {}

    if (t === 'script_run' && str(input.code)) {
      const code = str(input.code, 20_000)
      const language = (
        input.language === 'python' || input.language === 'javascript'
          ? input.language
          : 'shell'
      ) as 'python' | 'javascript' | 'shell'
      const packages = Array.isArray(input.packages)
        ? input.packages.map(String).filter(Boolean)
        : undefined
      push(
        {
          id: `s${idx++}`,
          kind: 'tool',
          label: `Run proven ${language} script`,
          tool: 'script_run',
          code: { language, source: code, ...(packages?.length ? { packages } : {}) },
          inputs: { language, code, ...(packages?.length ? { packages } : {}) },
          hardened: true,
        },
        `script:${code.slice(0, 200)}`,
      )
    } else if (t === 'cli_run' && str(input.command)) {
      const command = str(input.command, 2000)
      push(
        {
          id: `s${idx++}`,
          kind: 'tool',
          label: `Run command: ${command.slice(0, 60)}`,
          tool: 'cli_run',
          inputs: { command, args: input.args, cwd: input.cwd },
          hardened: true,
        },
        `cli:${command}`,
      )
    } else if (t === 'http_request' && str(input.url)) {
      const url = str(input.url, 2000)
      const method = (str(input.method, 10) || 'GET').toUpperCase()
      push(
        {
          id: `s${idx++}`,
          kind: 'tool',
          label: `${method} ${hostOf(url)}`,
          tool: 'http',
          http: {
            method: (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)
              ? method
              : 'GET') as 'GET',
            url,
            ...(str(input.credentialId)
              ? { auth: { type: 'bearer' as const, ref: str(input.credentialId) } }
              : {}),
          },
          inputs: { url, method },
          hardened: true,
        },
        `http:${method}:${url}`,
      )
    } else if (t === 'mcp_call_tool' && str(input.tool)) {
      const tool = str(input.tool, 200)
      push(
        {
          id: `s${idx++}`,
          kind: 'tool',
          label: `Call ${tool}`,
          tool: 'mcp_call_tool',
          inputs: { ...input },
          hardened: true,
        },
        `mcp:${tool}:${JSON.stringify(input.args ?? {}).slice(0, 200)}`,
      )
    } else if (t === 'fs_move' && str(input.from) && str(input.to)) {
      push(
        {
          id: `s${idx++}`,
          kind: 'tool',
          label: `Move ${shortPath(str(input.from))} → ${shortPath(str(input.to))}`,
          tool: 'fs_move',
          inputs: { from: str(input.from), to: str(input.to) },
          hardened: true,
        },
        `move:${str(input.from)}:${str(input.to)}`,
      )
    } else if (t === 'fs_write' && str(input.path)) {
      push(
        {
          id: `s${idx++}`,
          kind: 'tool',
          label: `Write ${shortPath(str(input.path))}`,
          tool: 'fs_write',
          inputs: { path: str(input.path), content: input.content },
          hardened: true,
        },
        `write:${str(input.path)}`,
      )
    } else if (DOCUMENT_TOOLS.has(t) && traceStepHasExecutableParams(s)) {
      // Document primitives are irreducible: no script can OCR a scan or fill
      // an AcroForm, so they survive distillation as tool nodes with their
      // inputs intact. Dedupe on the source document, so a batch loop over
      // twenty files collapses to one node per operation rather than twenty.
      push(
        {
          id: `s${idx++}`,
          kind: 'tool',
          label: humanWorkflowLabel(t, input),
          tool: t,
          inputs: documentStepInputs(t, input),
          hardened: true,
        },
        `${t}:${docDedupeKey(t, input)}`,
      )
    } else if (t === 'fs_list' && str(input.path) && !listedOnce) {
      // Keep at most ONE listing step (the first) — repeated listings are
      // exploration, not automation.
      listedOnce = true
      push(
        {
          id: `s${idx++}`,
          kind: 'tool',
          label: `List ${shortPath(str(input.path))}`,
          tool: 'fs_list',
          inputs: { path: str(input.path) },
        },
        `list:${str(input.path)}`,
      )
    }
  }

  const valid = validateDistilledSteps(steps)
  return valid.length >= 2 ? valid.slice(0, MAX_DISTILLED_STEPS) : []
}

/** LLM distill — short human-readable workflow with hardcoded params from trace. */
export async function llmDistillTrace(opts: {
  userId: string
  jobDescription: string
  goal?: string
  trace: EngineTraceStep[]
  modelPreference?: string | null
}): Promise<WorkflowStep[] | null> {
  const modelId = await resolveModelPreferenceForUser(opts.userId, opts.modelPreference ?? undefined)
  if (!modelId) return null

  const prompt = `Convert an agent's exploratory trace into an n8n-style PRODUCTION automation (agent-free at runtime).

Job: ${opts.jobDescription}
${opts.goal ? `User goal: ${opts.goal}` : ''}

Exploratory trace (the ONLY source of truth — every payload you output must come from it):
${summarizeTraceForPrompt(opts.trace)}

This workflow runs deterministically on schedule — NO agent, NO web_search, NO discovery loops.

Output 2-${MAX_DISTILLED_STEPS} automation nodes using ONLY:
- "code": { "language": "javascript"|"shell"|"python", "source": "...", "packages": ["axios"] } for scripts (PREFERRED when a working script exists; include the same packages the working script used — they auto-install at runtime)
- "http": { "method", "url", "headers", "body", "auth" } for API calls
- "mcp": { "integrationId", "tool", "args" } for MCP integrations
- "integrationId" + "tool" + "inputs" for frozen OpenAPI integrations
- "tool" + "inputs" for fs_list/fs_move/cli_run ONLY when script is not possible (max 1 list + 1 verify)
- "tool" + "inputs" for the DOCUMENT tools — keep these as tool nodes, never rewrite them as scripts:
  - doc_extract: { path|assetId|url, fields, instructions } — reads a scan/PDF into structured fields via a vision model. No script can do this.
  - pdf_form_fields: { path|assetId|url } — lists a PDF form's real field names.
  - pdf_fill: { path|assetId|url, values, outputPath, flatten } — fills an AcroForm.
  - sheet_read / sheet_append: { path|assetId|url, rows, sheetName, outputPath } — reads/appends .xlsx or .csv.
  - notify: { title, body, channel } — desktop toast with email fallback.
- "kind": "gate" for human approval before destructive actions (optional)

Rules:
1. Human "label" on every step — plain English for the Workflow tab.
2. Keep the working LOGIC from the trace (script structure, real endpoint URLs, real fixed paths, commands, MCP tools) — do NOT invent APIs or rewrite proven logic. The distinctive parts of every payload must trace back to a real observed tool call, or the step is REJECTED.
3. PARAMETERIZE what varies per run instead of hardcoding one run's values. Replace values that came from the user's request or that change each run (names, IDs, search terms, dates, recipients) with references: "{{trigger.field}}" for webhook/watch-triggered jobs, or "{{sN.field}}" to use an earlier step's output. Bake in ONLY truly-fixed values (your own file paths, endpoint URLs, credential refs). A workflow that hardcodes a single run's input is NOT reusable.
4. GENERATE output at runtime — never freeze a large one-run literal. If a run produced a document (asset_save/fs_write with a big inline content blob), do NOT paste that content; instead keep the code/script node that BUILDS it and have the save step reference the builder's result ("{{sN.output}}"). Drop steps that only store a finished snapshot of one run.
5. NEVER include web_search, web_read, credential_list, or repeated fs_list exploration. This rule is about DISCOVERY tools only — the document tools above are production steps and must be kept.
6. Prefer ONE code/script node over many file operations — but NOT for the document tools. Reading a scan, filling a PDF form, and appending to a spreadsheet are single tool nodes; collapsing them into a script silently drops the capability. Set "hardened": true on deterministic nodes.
7. A trace that repeats doc_extract / pdf_fill / sheet_append once per file is a BATCH: emit ONE node whose per-run value is a "{{trigger.*}}" or "{{sN.*}}" ref, not one node per observed file.
8. Values read off a document are NEVER literals in a frozen step. A pdf_fill "values" entry or a sheet_append "rows" cell that came from doc_extract must reference that step — {"applicant.dob": "{{s2.fields.date_of_birth}}"} — using the field names the doc_extract step requested. Those values appear as "${'{{redacted}}'}" in the trace because one run's personal data is not stored in a workflow; a step left holding them will refuse to run.

Respond JSON only:
{"steps":[{"id":"s1","kind":"tool","label":"...","code":{"language":"shell","source":"..."},"hardened":true},...]}`

  try {
    const res = await chat({
      userId: opts.userId,
      modelId,
      source: 'workflow',
      temperature: 0.2,
      maxTokens: 2500,
      messages: [
        {
          role: 'system',
          content:
            'You build n8n-style automations: deterministic nodes (code, HTTP, MCP, integrations) that run without an agent. Distill exploration into minimal hardened steps with human-readable labels. Keep the proven logic (script structure, real URLs/paths/commands) grounded in the trace, but parameterize per-run values with {{trigger.*}} / {{stepId.*}} refs and regenerate output at runtime rather than embedding a single run\'s finished document. The goal is a reusable workflow, not a snapshot of one run.',
        },
        { role: 'user', content: prompt },
      ],
    })
    const steps = parseStepsJson(res.content)
    if (!steps || steps.length < 2) return null
    const valid = validateDistilledSteps(steps)
    if (valid.length < 2) return null

    // NEVER silently replace a proven trace with LLM-invented steps: every
    // executable payload must be grounded in the real trace.
    const grounding = stepsGroundedInTrace(valid, opts.trace)
    if (!grounding.ok) {
      console.warn(
        `[workflow-distill] rejected LLM distill — ungrounded steps: ${grounding.ungrounded.join('; ')}`,
      )
      return null
    }
    return valid
  } catch {
    return null
  }
}

/** Build final workflow steps for freeze — distill when trace is exploratory. */
export async function buildStepsForFreeze(opts: {
  userId: string
  trace: EngineTraceStep[]
  jobDescription: string
  goal?: string
  agentProvidedSteps?: unknown[]
  modelPreference?: string | null
  rawSteps: WorkflowStep[]
}): Promise<{ steps: WorkflowStep[]; distilled: boolean }> {
  if (opts.agentProvidedSteps?.length) {
    const normalized = normalizeSteps(opts.agentProvidedSteps).slice(0, MAX_DISTILLED_STEPS)
    const valid = validateDistilledSteps(normalized)
    if (valid.length >= 2) return { steps: valid, distilled: true }
  }

  if (!shouldDistillTrace(opts.trace)) {
    return { steps: opts.rawSteps.slice(0, MAX_DISTILLED_STEPS), distilled: false }
  }

  const llm = await llmDistillTrace({
    userId: opts.userId,
    jobDescription: opts.jobDescription,
    goal: opts.goal,
    trace: opts.trace,
    modelPreference: opts.modelPreference,
  })
  if (llm && llm.length >= 2) return { steps: llm, distilled: true }

  const heuristic = heuristicDistillTrace(opts.trace, opts.jobDescription)
  if (heuristic.length >= 2) return { steps: heuristic, distilled: true }

  return { steps: opts.rawSteps.slice(0, MAX_DISTILLED_STEPS), distilled: false }
}
