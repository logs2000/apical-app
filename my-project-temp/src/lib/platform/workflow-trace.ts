// Pure helpers for turning agent execution traces into executable workflow steps.
// No DB imports — safe for client + server.

import type { WorkflowStep, CodeCallSpec } from '@/lib/types'

export const WORKFLOW_META_TOOLS = new Set([
  'workflow_freeze',
  'workflow_update',
  'workflow_monitor',
  'workflow_improve',
  'agent_list',
  'agent_create',
  'schedule_agent',
  'credential_list',
  'integration_list',
  'mcp_list_servers',
  'credential_request',
  'update_plan',
  'ask_clarification',
  'request_review',
])

export const MIN_SUBSTANTIVE_FREEZE_STEPS = 2

/** Agent tools used only while exploring — never saved in production workflows. */
export const EXPLORATION_ONLY_TOOLS = new Set([
  'web_search',
  'web_read',
  'agent_list',
  'agent_create',
  'credential_list',
  'integration_list',
  'mcp_list_servers',
  'credential_request',
  'tool_configure',
  'workflow_freeze',
  'workflow_update',
  'workflow_monitor',
  'workflow_improve',
  'schedule_agent',
  'update_plan',
  'ask_clarification',
  'request_review',
])

export interface EngineTraceStep {
  stepId: string
  kind: 'tool' | 'reason' | 'gate'
  label: string
  tool?: string
  input?: Record<string, unknown>
  status: 'running' | 'done' | 'flagged' | 'gate' | 'error'
  durationMs?: number
  result?: string
  error?: string
}

const SECRET_KEYS = /^(authorization|api[_-]?key|token|secret|password|credential)$/i

/** Strip auth-shaped keys and truncate large strings before persisting in workflows. */
export function sanitizeTraceInput(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(input)) {
    if (SECRET_KEYS.test(k)) continue
    if (typeof v === 'string') {
      out[k] = v.length > 4000 ? `${v.slice(0, 4000)}…` : v
    } else if (v != null && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = sanitizeTraceInput(v as Record<string, unknown>)
    } else {
      out[k] = v
    }
  }
  return out
}

export function normalizeTraceTool(tool: string): string {
  if (tool === 'http_request') return 'http'
  if (tool === 'mcp_call_tool') return 'mcp'
  return tool
}

export function agentToolName(tool: string): string {
  if (tool === 'http') return 'http_request'
  if (tool === 'mcp') return 'mcp_call_tool'
  return tool
}

function str(v: unknown, max = 500): string {
  if (typeof v !== 'string') return ''
  return v.slice(0, max)
}

/** Human-readable label including real argument values (not just key names). */
/** Plain-English label for workflow tab (n8n-style node title). */
export function humanWorkflowLabel(tool: string, input: Record<string, unknown>): string {
  const t = agentToolName(tool)
  switch (t) {
    case 'fs_list':
      return `List files in ${shortPath(str(input.path)) || 'watch folder'}`
    case 'fs_read':
      return `Read file ${shortPath(str(input.path)) || ''}`.trim()
    case 'fs_write':
      return `Write file ${shortPath(str(input.path)) || ''}`.trim()
    case 'fs_move':
      return `Move ${shortPath(str(input.from))} → ${shortPath(str(input.to))}`
    case 'cli_run': {
      const cmd = str(input.command, 80)
      return cmd ? `Run shell: ${cmd}` : 'Run shell command'
    }
    case 'script_run':
      return 'Run automation script on matched files'
    case 'http_request':
      return `Call API: ${str(input.method, 10) || 'GET'} ${str(input.url, 80)}`
    case 'mcp_call_tool':
      return `Call ${str(input.tool) || 'MCP tool'} via connected integration`
    case 'code_eval':
      return 'Transform data with script logic'
    default:
      return traceStepLabel(tool, input)
  }
}

function shortPath(p: string): string {
  if (!p) return ''
  return p.replace(/^\/Users\/[^/]+/, '~')
}

export function traceStepLabel(tool: string, input: Record<string, unknown>): string {
  const t = agentToolName(tool)
  switch (t) {
    case 'fs_list':
      return `List ${str(input.path) || '(path missing)'}`
    case 'fs_read':
      return `Read ${str(input.path) || '(path missing)'}`
    case 'fs_write':
      return `Write ${str(input.path) || '(path missing)'}`
    case 'fs_move':
      return `Move ${str(input.from) || '?'} → ${str(input.to) || '?'}`
    case 'cli_run': {
      const cmd = str(input.command, 200)
      const args = Array.isArray(input.args) ? input.args.map(String).join(' ') : ''
      return cmd ? `Run: ${cmd}${args ? ` ${args}` : ''}` : 'Run shell command'
    }
    case 'script_run': {
      const lang = str(input.language) || 'script'
      const code = str(input.code, 80)
      const preview = code.includes('\n') ? code.split('\n')[0] : code
      return code ? `Run ${lang}: ${preview}${code.length > 80 ? '…' : ''}` : `Run ${lang} script`
    }
    case 'http_request':
      return `${str(input.method, 10) || 'GET'} ${str(input.url, 120) || '(url missing)'}`
    case 'web_search':
      return `Search: ${str(input.query, 120) || '(query missing)'}`
    case 'web_read':
      return `Read page: ${str(input.url, 120) || '(url missing)'}`
    case 'mcp_call_tool':
      return `MCP ${str(input.serverId) || str(input.server)}.${str(input.toolName) || str(input.name) || 'tool'}`
    case 'code_eval': {
      const code = str(input.code, 80)
      return code ? `Eval: ${code}${str(input.code).length > 80 ? '…' : ''}` : 'Evaluate code'
    }
    default: {
      const keys = Object.keys(input).filter((k) => input[k] != null && input[k] !== '')
      if (keys.length === 0) return t
      const parts = keys.slice(0, 3).map((k) => {
        const v = input[k]
        if (typeof v === 'string') return `${k}=${v.slice(0, 60)}`
        if (Array.isArray(v)) return `${k}=[${v.length}]`
        return k
      })
      return `${t}(${parts.join(', ')})`
    }
  }
}

export function isSubstantiveTraceStep(step: {
  kind?: string
  tool?: string
  status?: string
}): boolean {
  if (step.status !== 'done') return false
  const tool = step.tool ?? ''
  if (!tool || tool === 'reason') return false
  if (WORKFLOW_META_TOOLS.has(tool) || WORKFLOW_META_TOOLS.has(agentToolName(tool))) return false
  if (EXPLORATION_ONLY_TOOLS.has(tool) || EXPLORATION_ONLY_TOOLS.has(agentToolName(tool))) return false
  return true
}

export function countSubstantiveTraceSteps(trace: EngineTraceStep[] | undefined): number {
  return (trace ?? []).filter(isSubstantiveTraceStep).length
}

/** Whether a trace step has the minimum params needed to replay it. */
export function traceStepHasExecutableParams(step: EngineTraceStep): boolean {
  const tool = agentToolName(step.tool ?? '')
  const input = step.input ?? {}
  switch (tool) {
    case 'fs_list':
    case 'fs_read':
    case 'fs_write':
      return Boolean(str(input.path))
    case 'fs_move':
      return Boolean(str(input.from) && str(input.to))
    case 'cli_run':
      return Boolean(str(input.command))
    case 'script_run':
      return Boolean(str(input.code) && str(input.language))
    case 'http_request':
      return Boolean(str(input.url) && /^https?:\/\//.test(str(input.url)))
    case 'web_search':
      return Boolean(str(input.query))
    case 'web_read':
      return Boolean(str(input.url))
    case 'mcp_call_tool':
      return Boolean((str(input.serverId) || str(input.server)) && (str(input.toolName) || str(input.name)))
    case 'code_eval':
      return Boolean(str(input.code))
    default:
      return Object.keys(input).some((k) => {
        const v = input[k]
        return v != null && v !== '' && (typeof v !== 'object' || Array.isArray(v))
      })
  }
}

function buildWorkflowInputs(tool: string, input: Record<string, unknown>): Record<string, unknown> {
  const t = agentToolName(tool)
  const clean = sanitizeTraceInput(input)
  switch (t) {
    case 'http_request':
      return {
        url: clean.url,
        method: clean.method ?? 'GET',
        ...(clean.body ? { body: clean.body } : {}),
        ...(clean.credentialId ? { credentialId: clean.credentialId } : {}),
      }
    case 'cli_run':
      return {
        command: clean.command,
        ...(clean.args ? { args: clean.args } : {}),
        ...(clean.cwd ? { cwd: clean.cwd } : {}),
      }
    case 'script_run':
      return { language: clean.language, code: clean.code, ...(clean.data ? { data: clean.data } : {}) }
    default:
      return clean
  }
}

export function buildWorkflowStepFromTrace(step: EngineTraceStep, index: number): WorkflowStep {
  const tool = step.tool ?? 'tool'
  const agentTool = agentToolName(tool)
  const input = step.input ?? {}
  const label = humanWorkflowLabel(agentTool, input)

  if (agentTool === 'mcp_call_tool') {
    return {
      id: `s${index + 1}`,
      kind: 'tool',
      label,
      tool: 'mcp',
      mcp: {
        integrationId: str(input.serverId) || str(input.integrationId),
        tool: str(input.tool) || str(input.toolName),
        args: (input.args as Record<string, unknown>) ?? {},
      },
      inputs: sanitizeTraceInput(input),
      hardened: true,
    }
  }

  if (agentTool === 'script_run' && str(input.code)) {
    return {
      id: `s${index + 1}`,
      kind: 'tool',
      label,
      tool: 'script_run',
      code: {
        language: (str(input.language) || 'shell') as CodeCallSpec['language'],
        source: str(input.code, 20_000),
      },
      inputs: buildWorkflowInputs(agentTool, input),
      hardened: true,
    }
  }

  if (agentTool === 'code_eval' || step.kind === 'reason') {
    return {
      id: `s${index + 1}`,
      kind: 'tool',
      label,
      tool: 'code',
      code: {
        language: 'javascript',
        source: str(input.code) || label,
      },
      hardened: true,
    }
  }

  if (agentTool === 'http_request') {
    const method = (str(input.method, 10) || 'GET').toUpperCase()
    const httpMethod =
      method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE'
        ? method
        : 'GET'
    return {
      id: `s${index + 1}`,
      kind: 'tool',
      label,
      tool: 'http',
      inputs: buildWorkflowInputs(agentTool, input),
      http: {
        method: httpMethod,
        url: str(input.url),
        ...(input.headers && typeof input.headers === 'object'
          ? { headers: sanitizeTraceInput(input.headers as Record<string, unknown>) as Record<string, string> }
          : {}),
        ...(input.body != null ? { body: input.body } : {}),
        ...(str(input.credentialId)
          ? { auth: { type: 'bearer' as const, ref: str(input.credentialId) } }
          : {}),
      },
    }
  }

  return {
    id: `s${index + 1}`,
    kind: 'tool',
    label,
    tool: normalizeTraceTool(agentTool),
    inputs: buildWorkflowInputs(agentTool, input),
    hardened: true,
    note: step.status === 'flagged' ? 'Flagged during live run — review' : undefined,
  }
}

/** Drop consecutive duplicate tool calls (same tool + same inputs). */
export function collapseRedundantTraceSteps(steps: EngineTraceStep[]): EngineTraceStep[] {
  const out: EngineTraceStep[] = []
  let prevKey = ''
  for (const s of steps) {
    const key = `${s.tool ?? ''}:${JSON.stringify(s.input ?? {})}`
    if (key === prevKey) continue
    prevKey = key
    out.push(s)
  }
  return out
}

export function workflowStepsFromExecutionTrace(trace: EngineTraceStep[]): WorkflowStep[] {
  const substantive = collapseRedundantTraceSteps(trace.filter(isSubstantiveTraceStep))
  return substantive.map((s, i) => buildWorkflowStepFromTrace(s, i))
}

export function validateWorkflowFreezeTrace(
  trace: EngineTraceStep[] | undefined,
): { ok: true; stepCount: number } | { ok: false; error: string } {
  const substantive = collapseRedundantTraceSteps((trace ?? []).filter(isSubstantiveTraceStep))
  if (substantive.length < MIN_SUBSTANTIVE_FREEZE_STEPS) {
    return {
      ok: false,
      error:
        `Cannot freeze — only ${substantive.length} substantive tool step${substantive.length === 1 ? '' : 's'} (need at least ${MIN_SUBSTANTIVE_FREEZE_STEPS}). ` +
        'Do the ACTUAL task with real tools first, THEN call workflow_freeze.',
    }
  }

  const hollow = substantive.filter((s) => !traceStepHasExecutableParams(s))
  if (hollow.length > 0) {
    const examples = hollow.slice(0, 3).map((s) => s.label || s.tool || 'step').join('; ')
    return {
      ok: false,
      error:
        `Cannot freeze — ${hollow.length} step${hollow.length === 1 ? '' : 's'} missing executable parameters (paths, commands, URLs, or script code). ` +
        `Examples: ${examples}. Re-run those tool calls with full arguments, then freeze again.`,
    }
  }

  return { ok: true, stepCount: substantive.length }
}

/** True when saved workflow JSON contains at least one production-executable node. */
export function savedWorkflowHasExecutableSteps(stepsJson?: string): boolean {
  if (!stepsJson) return false
  try {
    const parsed = JSON.parse(stepsJson) as { steps?: WorkflowStep[] }
    const steps = parsed.steps ?? []
    return steps.some((s) => {
      if (s.kind === 'gate') return true
      if (s.kind === 'reason' && s.hardened) return true
      if (s.http?.url) return true
      if (s.mcp?.integrationId && s.mcp.tool) return true
      if (s.code?.source) return true
      if (s.integrationId && s.tool) return true
      const t = s.tool ?? ''
      if (t && WORKFLOW_META_TOOLS.has(t)) return false
      if (EXPLORATION_ONLY_TOOLS.has(t)) return false
      const inputs = s.inputs ?? {}
      return Object.keys(inputs).some((k) => {
        const v = inputs[k]
        return v != null && v !== '' && (typeof v !== 'object' || Array.isArray(v))
      })
    })
  } catch {
    return false
  }
}
