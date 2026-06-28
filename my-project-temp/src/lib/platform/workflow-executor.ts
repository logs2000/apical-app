// Production workflow executor — n8n-like deterministic step dispatch.
// Scheduled/manual runs execute these steps WITHOUT an agent in the loop.
// Agents design, freeze, monitor, and improve workflows — they do not re-run them.

import { resolveRefs } from '@/lib/apical-server'
import { parseConfig } from '@/lib/apical-server'
import { db } from '@/lib/db'
import { buildSecureHeaders } from '@/lib/platform/agent-credentials'
import { getAgentTool, type ToolContext } from '@/lib/platform/agent-tools'
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
    if (lang === 'javascript') {
      return {
        tool: 'code_eval',
        input: {
          code: step.code.source,
          data: step.code.data != null ? JSON.stringify(step.code.data) : undefined,
        },
      }
    }
    return {
      tool: 'script_run',
      input: { language: lang, code: step.code.source },
    }
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
  const row = await db.integration.findUnique({ where: { id: integrationId } })
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
    allowCli: ctx.runtime === 'local',
    maxFetchBytes: 50_000,
    executionTrace: [],
    usedCredentialIds: [],
    findings: [],
    producedAssets: [],
  }

  const result = await def.run(call.input, toolCtx)
  return {
    ok: result.ok,
    output: result.output,
    error: result.error,
    aiTokens: 0,
    aiCostCents: 0,
  }
}

/** Whether a saved workflow can run agent-free (has executable production nodes). */
export function isProductionExecutableStep(step: WorkflowStep): boolean {
  if (step.kind === 'gate') return true
  if (step.kind === 'reason' && step.hardened) return true
  if (step.http?.url) return true
  if (step.mcp?.integrationId && step.mcp.tool) return true
  if (step.code?.source) return true
  if (step.integrationId && step.tool) return true
  const call = workflowStepToToolCall(step, {})
  return call != null && !EXPLORATION_ONLY_TOOLS.has(call.tool)
}
