// Distill exploratory agent traces into short, hardcoded production workflows.

import { normalizeSteps } from '@/lib/deploy'
import { chat, resolveModelPreferenceForUser } from '@/lib/platform/llm-gateway'
import {
  agentToolName,
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

/** True when the trace looks like exploratory work that should be distilled. */
export function shouldDistillTrace(trace: EngineTraceStep[]): boolean {
  const substantive = trace.filter(isSubstantiveTraceStep)
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
  return steps.filter((s) => {
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
    return traceStepHasExecutableParams(fake)
  })
}

/** Heuristic distill — no LLM. Prefer scripts + unique paths over repeated listings. */
export function heuristicDistillTrace(
  trace: EngineTraceStep[],
  jobDescription: string,
): WorkflowStep[] {
  const substantive = trace.filter(isSubstantiveTraceStep)
  const steps: WorkflowStep[] = []
  let idx = 1

  const scripts = substantive.filter(
    (s) => agentToolName(s.tool ?? '') === 'script_run' && str(s.input?.code),
  )
  const seenCode = new Set<string>()
  const uniqueScripts = scripts.filter((s) => {
    const code = str(s.input?.code)
    if (!code || seenCode.has(code)) return false
    seenCode.add(code)
    return true
  })

  const listPaths: string[] = []
  const moveDests: string[] = []
  const cliCommands: EngineTraceStep[] = []

  for (const s of substantive) {
    const t = agentToolName(s.tool ?? '')
    const path = str(s.input?.path)
    if (t === 'fs_list' && path && !listPaths.includes(path)) listPaths.push(path)
    if (t === 'fs_move' && str(s.input?.to) && !moveDests.includes(str(s.input?.to))) {
      moveDests.push(str(s.input?.to))
    }
    if (t === 'cli_run' && str(s.input?.command)) cliCommands.push(s)
  }

  const scanPath = listPaths[0]
  const clientRoot = moveDests[0] || listPaths.find((p) => /client|document|sorted|output/i.test(p)) || listPaths[1]

  if (scanPath) {
    steps.push({
      id: `s${idx++}`,
      kind: 'tool',
      label: `Scan inbox folder for new PDFs (${shortPath(scanPath)})`,
      tool: 'fs_list',
      inputs: { path: scanPath },
      hardened: true,
    })
  }

  if (uniqueScripts.length > 0) {
    const best = uniqueScripts.reduce((a, b) =>
      str(a.input?.code).length >= str(b.input?.code).length ? a : b,
    )
    steps.push({
      id: `s${idx++}`,
      kind: 'tool',
      label:
        jobDescription.toLowerCase().includes('sort') || jobDescription.toLowerCase().includes('client')
          ? 'Sort scans into client folders (automation script)'
          : 'Run proven automation script',
      tool: 'script_run',
      code: {
        language: (best.input?.language === 'python' ? 'python' : best.input?.language === 'javascript' ? 'javascript' : 'shell') as 'shell',
        source: str(best.input?.code, 20_000),
      },
      inputs: {
        language: best.input?.language ?? 'shell',
        code: best.input?.code,
      },
      hardened: true,
    })
  } else if (cliCommands.length > 0) {
    const mkdir = cliCommands.find((s) => /mkdir/.test(str(s.input?.command)))
    const main = cliCommands[cliCommands.length - 1]
    if (mkdir) {
      steps.push({
        id: `s${idx++}`,
        kind: 'tool',
        label: 'Ensure client output folders exist',
        tool: 'cli_run',
        inputs: {
          command: mkdir.input?.command,
          args: mkdir.input?.args,
          cwd: mkdir.input?.cwd,
        },
        hardened: true,
      })
    }
    steps.push({
      id: `s${idx++}`,
      kind: 'tool',
      label: 'Move or organize files by client name',
      tool: 'cli_run',
      inputs: {
        command: main.input?.command,
        args: main.input?.args,
        cwd: main.input?.cwd,
      },
      hardened: true,
    })
  } else {
    const reads = substantive.filter((s) => agentToolName(s.tool ?? '') === 'fs_read')
    const moves = substantive.filter((s) => agentToolName(s.tool ?? '') === 'fs_move')
    if (reads.length > 0) {
      steps.push({
        id: `s${idx++}`,
        kind: 'tool',
        label: 'Read each scan and determine the client name',
        tool: 'fs_read',
        inputs: { path: str(reads[0].input?.path) || scanPath || '' },
        note: 'Parameterize with {{s1.files}} or a glob when the runtime supports it',
      })
    }
    if (moves.length > 0) {
      steps.push({
        id: `s${idx++}`,
        kind: 'tool',
        label: `File each scan into the correct client folder under ${clientRoot ? shortPath(clientRoot) : 'the output directory'}`,
        tool: 'fs_move',
        inputs: {
          from: str(moves[0].input?.from),
          to: str(moves[0].input?.to),
        },
        hardened: true,
      })
    }
  }

  const verifyPath = clientRoot || listPaths[listPaths.length - 1]
  if (verifyPath && steps.length > 0 && steps.length < MAX_DISTILLED_STEPS) {
    steps.push({
      id: `s${idx++}`,
      kind: 'tool',
      label: `Verify sorted files in ${shortPath(verifyPath)}`,
      tool: 'fs_list',
      inputs: { path: verifyPath },
    })
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

Exploratory trace (learning only — DO NOT copy verbatim):
${summarizeTraceForPrompt(opts.trace)}

This workflow runs deterministically on schedule — NO agent, NO web_search, NO discovery loops.

Output 2-${MAX_DISTILLED_STEPS} automation nodes using ONLY:
- "code": { "language": "javascript"|"shell"|"python", "source": "..." } for scripts (PREFERRED when a working script exists)
- "http": { "method", "url", "headers", "body", "auth" } for API calls
- "mcp": { "integrationId", "tool", "args" } for MCP integrations
- "integrationId" + "tool" + "inputs" for frozen OpenAPI integrations
- "tool" + "inputs" for fs_list/fs_move/cli_run ONLY when script is not possible (max 1 list + 1 verify)
- "kind": "gate" for human approval before destructive actions (optional)

Rules:
1. Human "label" on every step — plain English for the Workflow tab (e.g. "Sort scans into client folders").
2. Hardcode paths, URLs, commands, script source from the trace — no placeholders.
3. NEVER include web_search, web_read, credential_list, or repeated fs_list exploration.
4. Prefer ONE code/script node over many file operations.
5. Set "hardened": true on deterministic nodes.

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
            'You build n8n-style automations: deterministic nodes (code, HTTP, MCP, integrations) that run without an agent. Distill exploration into minimal hardened steps with human-readable labels.',
        },
        { role: 'user', content: prompt },
      ],
    })
    const steps = parseStepsJson(res.content)
    if (!steps || steps.length < 2) return null
    const valid = validateDistilledSteps(steps)
    return valid.length >= 2 ? valid : null
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
