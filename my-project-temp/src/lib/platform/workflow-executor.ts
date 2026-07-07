// Production workflow executor — n8n-like deterministic step dispatch.
// Scheduled/manual runs execute these steps WITHOUT an agent in the loop.
// Agents design, freeze, monitor, and improve workflows — they do not re-run them.

import { resolveRefs } from '@/lib/apical-server'
import { parseConfig } from '@/lib/apical-server'
import { db } from '@/lib/db'
import { buildSecureHeaders } from '@/lib/platform/agent-credentials'
import { getAgentTool, type ToolContext } from '@/lib/platform/agent-tools'
import { isLocalDesktopRuntime } from '@/lib/platform/desktop-local-runtime'
import { agentToolName, EXPLORATION_ONLY_TOOLS } from '@/lib/platform/workflow-trace'
import type { AgentRuntime, WorkflowStep } from '@/lib/types'
import type { FrozenArtifact } from '@/lib/auth/freeze-artifact'

export interface WorkflowExecContext {
  userId: string
  workflowId: string
  runId: string
  runtime: AgentRuntime
  outputs: Record<string, unknown>
}

export interface WorkflowStepExecResult {
  ok: boolean
  output: unknown
  error?: string
  aiTokens: number
  aiCostCents: number
  /**
   * Set when a Pipedream-managed connection failed with an auth-shaped error
   * (revoked/expired upstream). The runtime pauses the run at a reconnect
   * gate instead of failing it — the user reconnects and the step re-runs.
   */
  needsReconnect?: { app: string; credentialId: string }
}

/** Map a saved workflow step to an agent-tool invocation (reuse proven executors). */
export function workflowStepToToolCall(
  step: WorkflowStep,
  outputs: Record<string, unknown>,
): { tool: string; input: Record<string, unknown> } | null {
  if (step.http?.url) {
    const spec = step.http
    return {
      tool: 'http_request',
      input: {
        url: resolveRefs(spec.url, outputs),
        method: spec.method ?? 'GET',
        headers: resolveRefs(spec.headers ?? {}, outputs),
        body: resolveRefs(spec.body, outputs),
        credentialId: spec.auth?.ref,
      },
    }
  }

  if (step.mcp?.integrationId && step.mcp.tool) {
    return {
      tool: 'mcp_call_tool',
      input: {
        serverId: step.mcp.integrationId,
        tool: step.mcp.tool,
        args: resolveRefs(step.mcp.args ?? {}, outputs),
      },
    }
  }

  if (step.code?.source) {
    const lang = step.code.language
    const packages = step.code.packages?.length ? step.code.packages : undefined
    // Resolve {{stepId.field}} / {{item}} / {{$index}} refs in the data payload
    // (and the source, so loop/map bodies can interpolate the current item).
    const resolvedData = step.code.data != null ? JSON.stringify(resolveRefs(step.code.data, outputs)) : undefined
    const resolvedSource = resolveRefs(step.code.source, outputs) as string
    if (lang === 'javascript' && !packages) {
      return { tool: 'code_eval', input: { code: resolvedSource, data: resolvedData } }
    }
    return { tool: 'script_run', input: { language: lang, code: resolvedSource, packages, data: resolvedData } }
  }

  const tool = step.tool ? agentToolName(step.tool) : ''
  if (!tool || !step.inputs) return null

  if (step.tool === 'mcp' && step.inputs) {
    const inp = step.inputs as Record<string, unknown>
    return {
      tool: 'mcp_call_tool',
      input: {
        serverId: inp.serverId ?? inp.integrationId,
        tool: inp.tool ?? inp.toolName,
        args: resolveRefs((inp.args as Record<string, unknown>) ?? {}, outputs),
      },
    }
  }

  if (EXPLORATION_ONLY_TOOLS.has(tool)) return null

  const productionTools = new Set([
    'fs_list',
    'fs_read',
    'fs_write',
    'fs_move',
    'cli_run',
    'script_run',
    'code_eval',
    'http_request',
    'mcp_call_tool',
    'job.run',
  ])
  if (!productionTools.has(tool)) return null

  return {
    tool,
    input: resolveRefs(step.inputs, outputs) as Record<string, unknown>,
  }
}

async function executeFrozenIntegrationTool(
  integrationId: string,
  toolId: string,
  args: Record<string, unknown>,
  userId: string,
): Promise<WorkflowStepExecResult | null> {
  // Scope the lookup to integrations visible to the user's workspace (own
  // instances + global registry rows / legacy unscoped rows).
  const membership = userId
    ? await db.workspaceMember.findFirst({
        where: { userId },
        orderBy: { createdAt: 'asc' },
        select: { workspaceId: true },
      })
    : null
  const row = await db.integration.findFirst({
    where: {
      id: integrationId,
      OR: membership
        ? [{ workspaceId: membership.workspaceId }, { workspaceId: null }]
        : [{ workspaceId: null }],
    },
  })
  if (!row) return null
  const cfg = parseConfig<{ frozenArtifact?: FrozenArtifact; baseUrl?: string }>(row.config, {})
  const artifact = cfg.frozenArtifact
  if (!artifact) return null

  const toolSpec = artifact.tools.find((t) => t.id === toolId)
  if (!toolSpec) return null

  let url = artifact.baseUrl.replace(/\/$/, '') + toolSpec.path
  for (const [k, v] of Object.entries(args)) {
    url = url.replace(`{${k}}`, encodeURIComponent(String(v)))
  }

  const headers: Record<string, string> = { Accept: 'application/json' }
  let credSecret: string | null = null
  if (artifact.auth.credentialId) {
    const { headers: secure } = await buildSecureHeaders({}, artifact.auth.credentialId, userId)
    Object.assign(headers, secure)
  }

  const resp = await fetch(url, {
    method: toolSpec.method,
    headers,
    ...(toolSpec.hasBody && Object.keys(args).length ? { body: JSON.stringify(args) } : {}),
  })
  const text = await resp.text()
  let data: unknown = text
  try {
    data = JSON.parse(text)
  } catch {
    // keep text
  }
  return {
    ok: resp.ok,
    output: { status: resp.status, data },
    error: resp.ok ? undefined : `HTTP ${resp.status}`,
    aiTokens: 0,
    aiCostCents: 0,
  }
}

/**
 * Execute a workflow step deterministically (no LLM agent).
 * Returns null if the step should fall back to legacy simulation.
 */
export async function executeProductionStep(
  step: WorkflowStep,
  ctx: WorkflowExecContext,
): Promise<WorkflowStepExecResult | null> {
  if (step.integrationId && step.tool && !step.http && !step.mcp) {
    const frozen = await executeFrozenIntegrationTool(
      step.integrationId,
      step.tool,
      resolveRefs(step.inputs ?? {}, ctx.outputs) as Record<string, unknown>,
      ctx.userId,
    )
    if (frozen) return frozen
  }

  const call = workflowStepToToolCall(step, ctx.outputs)
  if (!call) return null
  if (EXPLORATION_ONLY_TOOLS.has(call.tool)) {
    return {
      ok: false,
      output: null,
      error: `${call.tool} is exploration-only — not valid in production workflows`,
      aiTokens: 0,
      aiCostCents: 0,
    }
  }

  const def = getAgentTool(call.tool)
  if (!def) return null

  const toolCtx: ToolContext = {
    userId: ctx.userId,
    agentId: ctx.workflowId,
    allowCli: ctx.runtime === 'local' || isLocalDesktopRuntime(),
    maxFetchBytes: 50_000,
    executionTrace: [],
    usedCredentialIds: [],
    findings: [],
    producedAssets: [],
  }

  const result = await def.run(call.input, toolCtx)
  const execResult: WorkflowStepExecResult = {
    ok: result.ok,
    output: result.output,
    error: result.error,
    aiTokens: 0,
    aiCostCents: 0,
  }
  if (!result.ok && result.error) {
    const reconnect = await detectPipedreamReconnect(step, call, result.error, ctx.userId)
    if (reconnect) execResult.needsReconnect = reconnect
  }
  return execResult
}

/** Auth-shaped failure text — the signals that a connection needs re-auth. */
const AUTH_ERROR_RE =
  /\b401\b|unauthorized|authentication failed|invalid[_ ](?:token|grant)|token (?:expired|revoked)|expired token|account not found|reconnect/i

/**
 * When a failed step was backed by a Pipedream-managed connection and the
 * error looks like an auth failure, resolve the app + credential so the
 * runtime can pause at a reconnect gate.
 */
async function detectPipedreamReconnect(
  step: WorkflowStep,
  call: { tool: string; input: Record<string, unknown> },
  error: string,
  userId: string,
): Promise<{ app: string; credentialId: string } | null> {
  if (!AUTH_ERROR_RE.test(error)) return null
  try {
    // MCP step → the integration's config carries the pipedream marker.
    if (call.tool === 'mcp_call_tool') {
      const serverId = String(call.input.serverId ?? '')
      if (!serverId) return null
      const row = await db.integration.findUnique({
        where: { id: serverId },
        select: { config: true },
      })
      if (!row) return null
      const cfg = parseConfig<{ pipedream?: { appSlug: string; credentialId: string } }>(
        row.config,
        {},
      )
      if (!cfg.pipedream) return null
      return { app: cfg.pipedream.appSlug, credentialId: cfg.pipedream.credentialId }
    }
    // HTTP step → the referenced credential is kind="pipedream".
    if (call.tool === 'http_request') {
      const credentialId = String(call.input.credentialId ?? step.http?.auth?.ref ?? '')
      if (!credentialId) return null
      const cred = await db.credential.findFirst({
        where: { id: credentialId, userId, kind: 'pipedream' },
        select: { id: true, pipedreamApp: true },
      })
      if (!cred?.pipedreamApp) return null
      return { app: cred.pipedreamApp, credentialId: cred.id }
    }
  } catch {
    // Detection is best-effort — fall through to a normal failure.
  }
  return null
}

/** Whether a saved workflow can run agent-free (has executable production nodes). */
export function isProductionExecutableStep(step: WorkflowStep): boolean {
  if (step.kind === 'gate') return true
  // Control flow + spawn execute directly in the runtime (not via a tool call).
  if (step.kind === 'branch' || step.kind === 'loop' || step.kind === 'map' || step.kind === 'spawn') return true
  if (step.kind === 'reason' && step.hardened) return true
  if (step.http?.url) return true
  if (step.mcp?.integrationId && step.mcp.tool) return true
  if (step.code?.source) return true
  if (step.integrationId && step.tool) return true
  const call = workflowStepToToolCall(step, {})
  return call != null && !EXPLORATION_ONLY_TOOLS.has(call.tool)
}
