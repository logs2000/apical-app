// Apical agent engine — a ReAct (Reason+Act) loop built on native provider
// tool calling.
//
// Given a goal, the agent reasons (extended thinking, streamed), calls tools
// (natively, possibly several in parallel), observes structured results, and
// repeats until it answers or hits the iteration/budget cap. Models without
// native tool support (llama.cpp) fall back to a legacy JSON-protocol loop.
//
// The engine streams events so the UI can show progress live:
//   { type: 'status', status: 'thinking'|'acting'|'observing'|'done' }
//   { type: 'thought_delta' | 'thought', text }   // chain-of-thought
//   { type: 'answer_delta', text }                 // final answer, streamed
//   { type: 'tool_call', tool, input }             // a tool the agent invoked
//   { type: 'observation', tool, ok, output, ... } // the tool result
//   { type: 'plan', items } / { type: 'clarification', question }
//   { type: 'final', answer, ... } / { type: 'error', message }
//
// The engine uses the LLM gateway (chatStream) so it respects the user's model
// choice + BYOK + token metering.

import {
  chatStream,
  checkAllowance,
  resolveModelPreferenceForUser,
  resolveModel,
  modelSupportsTools,
  NO_LLM_PROVIDER_ERROR,
  type GatewayMessage,
  type AssistantToolCall,
  type StopReason,
} from '@/lib/platform/llm-gateway'
import {
  AGENT_TOOLS,
  getAgentTool,
  loadPriorEngineTrace,
  toolCatalogForLLM,
  toolSpecsForLLM,
  validateWorkflowFreezeTrace,
  WORKFLOW_META_TOOLS,
  type ToolCall,
  type ToolContext,
  type ToolResult,
  type ToolDef,
  type CredentialRequest,
  type PlanItem,
  type ClarificationRequest,
} from './agent-tools'
import { sanitizeTraceInput, traceStepLabel, savedWorkflowHasExecutableSteps } from './workflow-trace'
import {
  clientPlatformFromRequest,
  runtimeContextForLLM,
  type ClientPlatform,
} from './runtime-context'
import { loadUserContextBlock } from './user-context'
import { db } from '@/lib/db'
import { parseWorkflowJSON } from '@/lib/apical-server'
import type { WorkflowJSON } from '@/lib/types'

// ---------------- Types ----------------

export type AgentEvent =
  | { type: 'status'; status: 'started' | 'preparing' | 'thinking' | 'acting' | 'observing' | 'done' }
  | { type: 'thought'; text: string }
  /** Incremental chain-of-thought tokens (streamed live as the model writes). */
  | { type: 'thought_delta'; text: string }
  /** Incremental final-answer tokens (streamed live as the model writes). */
  | { type: 'answer_delta'; text: string }
  /** The agent's live checklist (from update_plan). */
  | { type: 'plan'; items: PlanItem[] }
  /** A multiple-choice question the user must answer (from ask_clarification). */
  | { type: 'clarification'; question: ClarificationRequest }
  | { type: 'tool_call'; tool: string; input: Record<string, unknown> }
  | { type: 'observation'; tool: string; ok: boolean; output: unknown; error?: string; display?: ToolResult['display'] }
  | {
      type: 'final'
      answer: string
      proposedWorkflow?: WorkflowJSON
      findings?: ToolContext['findings']
      attachments?: ToolContext['producedAssets']
      /** Set when the agent updated its OWN workflow (vs. proposing a new one). */
      workflowSavedToAgentId?: string
      /** Set when the agent needs an API key — renders an inline vault box. */
      credentialRequests?: CredentialRequest[]
      /** Set when agent_create materialized a new agent (orchestrator). */
      createdAgentId?: string
      createdAgentName?: string
      /** Non-empty when tool steps failed this run — UI should not treat as clean success. */
      runFailures?: string[]
      /** The final checklist state (from update_plan). */
      plan?: PlanItem[]
      /** Set when the turn ended to ask the user a multiple-choice question. */
      clarification?: ClarificationRequest
    }
  | { type: 'error'; message: string }

export interface AgentRunOptions {
  userId: string
  goal: string
  agentId?: string | null
  /** Extra context (agent profile, workspace info, etc.). */
  context?: string
  /** Prior chat turns (user + assistant) for multi-turn context. */
  history?: Array<{ role: 'user' | 'agent'; content: string }>
  /**
   * An in-progress checklist from an earlier turn that isn't finished yet. When
   * present, the agent CONTINUES this plan (marking items done as it goes)
   * instead of starting a brand-new checklist from scratch.
   */
  priorPlan?: PlanItem[]
  /** User-attached files/folders for this turn. */
  attachments?: Array<{
    id: string
    name: string
    mimeType: string
    kind: string
    url: string
    localPath?: string | null
  }>
  /** Optional script to run as part of this turn. */
  script?: { language: 'javascript' | 'python' | 'shell'; code: string }
  /** The model id to use. Defaults to the first configured hosted model. */
  modelId?: string
  /** Max reasoning iterations (default 64). */
  maxIterations?: number
  /** Whether CLI access is allowed (routes through the desktop bridge). */
  allowCli?: boolean
  /** Client platform — desktop (Tauri) or web browser. */
  isDesktop?: boolean
  /** The usage-log source bucket for token metering. */
  source?: 'chat' | 'agent' | 'workflow' | 'reason' | 'research'
  /**
   * Abort signal from the HTTP request. When the client disconnects, the loop
   * stops at the next iteration boundary instead of burning LLM tokens on a
   * response nobody will see.
   */
  signal?: AbortSignal
}

export interface AgentRunResult {
  answer: string
  proposedWorkflow?: WorkflowJSON
  findings?: ToolContext['findings']
  attachments?: ToolContext['producedAssets']
  workflowSavedToAgentId?: string
  credentialRequests?: CredentialRequest[]
  createdAgentId?: string
  createdAgentName?: string
  plan?: PlanItem[]
  clarification?: ClarificationRequest
  iterations: number
  toolCalls: number
  tokensUsed: number
}

// ---------------- Failure helpers ----------------

function collectRunFailures(ctx: ToolContext): string[] {
  const lines: string[] = []
  for (const step of ctx.executionTrace ?? []) {
    if (step.status === 'error') {
      lines.push(`${step.label || step.tool || 'step'}: ${step.error || 'failed'}`)
    }
  }
  for (const f of ctx.metaToolFailures ?? []) {
    lines.push(`${f.tool}: ${f.error}`)
  }
  return lines
}

function prefixFailedRunAnswer(answer: string, failures: string[]): string {
  if (failures.length === 0) return answer
  const header =
    `**Run incomplete** — ${failures.length} step${failures.length === 1 ? '' : 's'} failed:\n` +
    failures.map((f) => `- ${f}`).join('\n')
  if (/failed|error|incomplete|could not|couldn't|unable/i.test(answer)) return answer
  return `${header}\n\n${answer}`
}

// ---------------- Prompts ----------------

const SYSTEM_PROMPT = `You are Apical, an autonomous AI agent that does real work for the user with tools — running code, calling real APIs, reading and organizing files, and building and scheduling automations.

{{RUNTIME}}

Respect your runtime capabilities above. Never claim abilities you lack in this session, and never refuse a task you can actually do with your available tools.

CONVERSATION: You are in one ongoing conversation — read the history and continue from where you left off. Don't reintroduce yourself, re-ask answered questions, or redo work already completed. Answer simple questions, explanations, opinions, and chat directly in clean markdown with no tools. When the user asks you to DO something, do it with tools.

WORKING STYLE: When you act on the user's existing resources, orient first with cheap lookups (agent_list, credential_list, integration_list — you may call these in parallel in one turn). You can extend your own capabilities: if a tool or API is missing, discover it (web_search), install it (tool_configure with an OpenAPI spec or MCP server), obtain any needed secret (credential_request), then use it (mcp_call_tool / http_request). Never say "I can't access X" without first trying to discover, install, or work around it. If something fails, reason about why and try another approach.

CHECKLISTS: For any task with 2+ steps, call update_plan first with a short checklist (3–7 short imperative items), and update it as you go (always pass the full list). If a plan is already in progress, continue that same list — mark finished items done and keep going; do NOT start a new one. Skip the checklist for trivial single-step requests and pure questions.

CLARIFICATION & REVIEW: Ask at most one clarifying question up front (ask_clarification) only when the request is genuinely ambiguous and guessing would waste real work — otherwise default sensibly and proceed. Prefer reversible actions (draft not send, new file not overwrite, stage not delete). Only gate a genuinely high-stakes, irreversible action (deleting user data, spending money, mass/external sends, public posts) with request_review. Both tools end your turn.

CREDENTIALS: The only way to obtain a secret is credential_request — one call per key, always with a docsUrl deep link to the page where the user creates that key. Never ask the user to paste a secret into chat and never point them at the Vault. The secure input boxes appear automatically under your message — don't describe them; just say in one line why you need each key, then stop. Afterward, pass the credentialId to http_request/web_read; the secret never enters your context.

SCRIPTS run on Apical (server sandbox or the desktop bridge), NOT on the user's machine — never hand the user a script to download/run or tell them to install packages. Use script_run, passing packages:[...] to auto-install npm/PyPI deps. If a script is part of an automation, bake it into the workflow as a code node.

AUTOMATIONS: Do the user's job NOW with real tools first — never propose an abstract workflow before doing the work. When multi-step work succeeds and would plausibly run again, save it as a reusable workflow with workflow_freeze: short human labels, inputs parameterized from the trigger ({{trigger.field}}) or earlier steps ({{stepId.output}}), and output GENERATED at runtime — never a snapshot of one run's data. Then tell the user you saved it. For recurring jobs add schedule_agent (a cron or fixed_rate cadence); for new-file triggers use watch_folder. If you already own a saved workflow, monitor its runs (workflow_monitor) and fix nodes (workflow_update / workflow_improve) instead of redoing the job by hand — and confirm the specific changes with the user before updating an existing automation.

HONESTY (non-negotiable): Never claim success, "done", or "workflow saved" if any tool returned an error this run. State exactly what succeeded and what failed. Your final answer must match the observed tool results, not your intent.`

// Legacy JSON-protocol appendix — only for models without native tool calling.
const LEGACY_PROTOCOL = `You operate in a ReAct loop: THINK → ACT → OBSERVE → repeat. Each turn respond with a SINGLE JSON object (no prose, no code fences, no markdown) in one of these shapes:
  {"thought":"<your reasoning>","action":{"tool":"<tool_name>","input":{...}}}
  {"thought":"<final reasoning>","final":{"answer":"<a clear, complete answer for the user>"}}
Your "thought" and "answer" are streamed live to the user, so write them as clean prose. Pick ONE tool per turn and wait for the observation before deciding the next step. For a simple question you already know, emit a "final" immediately.

You have these tools available:
<tools>
{{TOOLS}}
</tools>`

// Per-call LLM guard. Aborts the underlying provider fetch when the client
// disconnects OR the call exceeds `ms` — so a stalled/hung provider can never
// leave the SSE stream open forever (the "frozen, stuck thinking" symptom).
function llmCallSignal(
  clientSignal: AbortSignal | undefined,
  ms: number,
): { signal: AbortSignal; done: () => void } {
  const controller = new AbortController()
  const onClientAbort = () => controller.abort()
  if (clientSignal) {
    if (clientSignal.aborted) controller.abort()
    else clientSignal.addEventListener('abort', onClientAbort, { once: true })
  }
  const timer = setTimeout(() => {
    controller.abort(new DOMException(`LLM call exceeded ${ms}ms`, 'TimeoutError'))
  }, ms)
  return {
    signal: controller.signal,
    done: () => {
      clearTimeout(timer)
      clientSignal?.removeEventListener('abort', onClientAbort)
    },
  }
}

// Upper bound on any single model call. Generous enough for slow providers /
// extended thinking, tight enough that a true hang surfaces as an error.
const LLM_CALL_TIMEOUT_MS = 120_000

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ---------------- Shared loop state ----------------

interface LoopState {
  opts: AgentRunOptions
  ctx: ToolContext
  modelId: string
  meterSource: NonNullable<AgentRunOptions['source']>
  runtimeBlock: string
  allowCli: boolean
  /** userContext + ownWorkflow + plan + attachment + script blocks. */
  contextPrefix: string
  /** `Goal: ...` (+ optional additional context). */
  goalLine: string
  history: Array<{ role: 'user' | 'agent'; content: string }>
  unfinishedPriorPlan?: PlanItem[]
  maxIterations: number
}

// ---------------- Observation formatting ----------------

const OBS_LIMIT = 12_000

function buildObservationText(tool: string, result: ToolResult, def: ToolDef): string {
  if (result.ok) {
    const full = JSON.stringify(result.output)
    let text = full.slice(0, OBS_LIMIT)
    if (full.length > OBS_LIMIT) text += `\n[truncated — ${full.length} chars total; full result in the run trace]`
    if (tool === 'workflow_freeze') {
      text +=
        ' IMPORTANT: Your final answer must describe ONLY the savedSteps in this output. Do not invent steps that are not in savedSteps.'
    }
    return text
  }
  return (
    `Error: ${result.error}. Required params for ${tool}: ${JSON.stringify(def.inputSchema)}` +
    ' IMPORTANT: This step FAILED. Do not claim success or say the workflow was saved until this succeeds.'
  )
}

// ---------------- Tool execution (shared by both loops) ----------------

/**
 * Run a single work tool through the full pipeline: unknown-tool + missing-param
 * pre-checks, workflow_freeze trace gate, tool_call/observation events, trace
 * recording, credential tracking, and a hard timeout. Emits events but NOT the
 * batch-level acting/thinking status (the caller manages that). Never throws.
 */
async function executeWorkTool(
  call: { tool: string; input: Record<string, unknown> },
  ctx: ToolContext,
  signal: AbortSignal | undefined,
  onEvent: (event: AgentEvent) => void,
): Promise<{ result: ToolResult; observationText: string }> {
  const { tool, input } = call
  const def = getAgentTool(tool)
  if (!def) {
    onEvent({ type: 'tool_call', tool, input })
    onEvent({ type: 'observation', tool, ok: false, output: null })
    return {
      result: { ok: false, output: null, error: `unknown tool "${tool}"` },
      observationText: `Error — unknown tool "${tool}". Available tools: ${AGENT_TOOLS.map((t) => t.name).join(', ')}`,
    }
  }

  // Truncated / invalid argument JSON (surfaced by the gateway as __raw).
  if ('__raw' in input) {
    onEvent({ type: 'tool_call', tool, input })
    onEvent({
      type: 'observation',
      tool,
      ok: false,
      output: null,
      display: { title: `${tool} (invalid arguments)`, summary: 'arguments were truncated', kind: 'info' },
    })
    return {
      result: { ok: false, output: null, error: 'arguments were truncated or not valid JSON' },
      observationText: `Error — your tool arguments were truncated or invalid JSON. Re-issue ${tool} with complete, valid arguments. Param schema: ${JSON.stringify(def.inputSchema)}`,
    }
  }

  // Pre-call validation: required params present?
  const missing: string[] = []
  for (const [k, schema] of Object.entries(def.inputSchema)) {
    if (schema.required && (input[k] === undefined || input[k] === null || input[k] === '')) {
      missing.push(k)
    }
  }
  if (missing.length > 0) {
    onEvent({ type: 'tool_call', tool, input })
    onEvent({
      type: 'observation',
      tool,
      ok: false,
      output: null,
      display: { title: `${tool} (missing params)`, summary: missing.join(', '), kind: 'info' },
    })
    return {
      result: { ok: false, output: null, error: `missing required params: ${missing.join(', ')}` },
      observationText: `Error — missing required params: ${missing.join(', ')}. The input you sent was ${JSON.stringify(input)}. You MUST include all required params. Param schema: ${JSON.stringify(def.inputSchema)}`,
    }
  }

  // Block workflow_freeze when the trace has no real work to save.
  if (tool === 'workflow_freeze') {
    const freezeCheck = validateWorkflowFreezeTrace(ctx.executionTrace)
    if (!freezeCheck.ok) {
      onEvent({ type: 'tool_call', tool, input })
      onEvent({
        type: 'observation',
        tool,
        ok: false,
        output: null,
        error: freezeCheck.error,
        display: { title: 'Cannot freeze yet', summary: 'Do the actual task with tools first', kind: 'info' },
      })
      return {
        result: { ok: false, output: null, error: freezeCheck.error },
        observationText: `Error — ${freezeCheck.error}`,
      }
    }
  }

  onEvent({ type: 'tool_call', tool, input })

  // Track substantive steps in the execution trace (meta tools are excluded).
  const traceStepId = `t${(ctx.executionTrace?.length ?? 0) + 1}`
  const traceStart = Date.now()
  const isMetaTool = WORKFLOW_META_TOOLS.has(tool)
  if (!isMetaTool) {
    const traceKind: 'tool' | 'reason' | 'gate' = tool === 'code_eval' ? 'reason' : 'tool'
    const safeInput = sanitizeTraceInput(input)
    ctx.executionTrace?.push({
      stepId: traceStepId,
      kind: traceKind,
      label: traceStepLabel(tool, safeInput),
      tool: tool === 'http_request' ? 'http' : tool === 'mcp_call_tool' ? 'mcp' : tool,
      input: safeInput,
      status: 'running',
    })
  }

  // Track credential usage (for the freeze step's credentialIds).
  const credId = (input.credentialId as string) || (input.bearerToken as string)
  if (credId && ctx.usedCredentialIds && !ctx.usedCredentialIds.includes(credId)) {
    ctx.usedCredentialIds.push(credId)
  }

  let result: ToolResult
  // script_run may install packages on first use — give it longer.
  const TOOL_RUN_TIMEOUT_MS = tool === 'script_run' ? 240_000 : 45_000
  try {
    result = await Promise.race([
      def.run(input, ctx),
      new Promise<ToolResult>((resolve) => {
        const timer = setTimeout(
          () =>
            resolve({
              ok: false,
              output: null,
              error: `Tool "${tool}" timed out after ${TOOL_RUN_TIMEOUT_MS / 1000}s`,
            }),
          TOOL_RUN_TIMEOUT_MS,
        )
        // Abort-safe: a client disconnect resolves the race immediately.
        signal?.addEventListener(
          'abort',
          () => {
            clearTimeout(timer)
            resolve({ ok: false, output: null, error: 'Aborted by client' })
          },
          { once: true },
        )
      }),
    ])
  } catch (e) {
    result = { ok: false, output: null, error: (e as Error).message }
  }

  if (!result.ok && isMetaTool) {
    ctx.metaToolFailures = ctx.metaToolFailures ?? []
    ctx.metaToolFailures.push({ tool, error: result.error ?? 'failed' })
  }

  const traceStep = !isMetaTool ? ctx.executionTrace?.find((s) => s.stepId === traceStepId) : undefined
  if (traceStep) {
    traceStep.status = result.ok ? 'done' : 'error'
    traceStep.durationMs = Date.now() - traceStart
    traceStep.result = result.ok
      ? typeof result.output === 'string'
        ? result.output.slice(0, 200)
        : JSON.stringify(result.output).slice(0, 200)
      : undefined
    traceStep.error = result.error
  }

  onEvent({
    type: 'observation',
    tool,
    ok: result.ok,
    output: result.output,
    error: result.error,
    display: result.display,
  })

  return { result, observationText: buildObservationText(tool, result, def) }
}

// ---------------- Context compaction (Phase 5) ----------------

const COMPACT_LIMIT_CHARS = 150_000
const COMPACT_KEEP_RECENT = 8

function msgLen(m: GatewayMessage): number {
  return JSON.stringify(m).length
}

/**
 * Keep the running message array bounded: when it grows past the budget, replace
 * the oldest tool-result contents (except the most recent few, and never
 * update_plan results) with one-line summaries. In-place, no LLM call.
 */
function compactMessages(messages: GatewayMessage[]): void {
  const total = () => messages.reduce((n, m) => n + msgLen(m), 0)
  if (total() <= COMPACT_LIMIT_CHARS) return

  const toolIdxs = messages
    .map((m, i) => ({ m, i }))
    .filter((x) => x.m.role === 'tool')
    .map((x) => x.i)
  const protectedTail = new Set(toolIdxs.slice(-COMPACT_KEEP_RECENT))

  for (const idx of toolIdxs) {
    if (total() <= COMPACT_LIMIT_CHARS) break
    if (protectedTail.has(idx)) continue
    const m = messages[idx] as Extract<GatewayMessage, { role: 'tool' }>
    if (m.name === 'update_plan') continue
    if (m.content.startsWith('[compacted]')) continue
    m.content = `[compacted] ${m.name} → ${m.content.slice(0, 300)}`
  }
}

// ---------------- Finalization (shared) ----------------

function finalizeRun(
  onEvent: (event: AgentEvent) => void,
  ctx: ToolContext,
  answer: string,
  failures: string[],
  iterations: number,
  toolCalls: number,
  tokensUsed: number,
): AgentRunResult {
  onEvent({ type: 'status', status: 'done' })
  onEvent({
    type: 'final',
    answer,
    proposedWorkflow: ctx.proposedWorkflow,
    findings: ctx.findings,
    attachments: ctx.producedAssets,
    workflowSavedToAgentId: failures.length > 0 ? undefined : ctx.workflowSavedToAgentId,
    credentialRequests: ctx.credentialRequests,
    createdAgentId: ctx.createdAgentId,
    createdAgentName: ctx.createdAgentName,
    runFailures: failures.length > 0 ? failures : undefined,
    plan: ctx.plan,
  })
  return {
    answer,
    proposedWorkflow: ctx.proposedWorkflow,
    findings: ctx.findings,
    attachments: ctx.producedAssets,
    workflowSavedToAgentId: failures.length > 0 ? undefined : ctx.workflowSavedToAgentId,
    credentialRequests: ctx.credentialRequests,
    createdAgentId: ctx.createdAgentId,
    createdAgentName: ctx.createdAgentName,
    plan: ctx.plan,
    iterations,
    toolCalls,
    tokensUsed,
  }
}

function budgetExhausted(
  onEvent: (event: AgentEvent) => void,
  ctx: ToolContext,
  iterations: number,
  toolCalls: number,
  tokensUsed: number,
  lastError: string | null,
): AgentRunResult {
  const failures = collectRunFailures(ctx)
  let finalAnswer =
    `I worked on this for ${iterations} iterations${toolCalls ? ` and made ${toolCalls} tool calls` : ''}, but hit the iteration budget before producing a final answer. ` +
    (ctx.proposedWorkflow
      ? 'I did draft a workflow proposal — review it below.'
      : lastError
        ? `Last error: ${lastError}`
        : 'Try rephrasing the goal or increasing the iteration budget.')
  if (failures.length > 0) finalAnswer = prefixFailedRunAnswer(finalAnswer, failures)
  onEvent({
    type: 'final',
    answer: finalAnswer,
    proposedWorkflow: ctx.proposedWorkflow,
    findings: ctx.findings,
    workflowSavedToAgentId: failures.length > 0 ? undefined : ctx.workflowSavedToAgentId,
    credentialRequests: ctx.credentialRequests,
    createdAgentId: ctx.createdAgentId,
    createdAgentName: ctx.createdAgentName,
    runFailures: failures.length > 0 ? failures : undefined,
    plan: ctx.plan,
  })
  return {
    answer: finalAnswer,
    proposedWorkflow: ctx.proposedWorkflow,
    findings: ctx.findings,
    workflowSavedToAgentId: ctx.workflowSavedToAgentId,
    credentialRequests: ctx.credentialRequests,
    createdAgentId: ctx.createdAgentId,
    createdAgentName: ctx.createdAgentName,
    plan: ctx.plan,
    iterations,
    toolCalls,
    tokensUsed,
  }
}

const CONTROL_TOOLS = new Set(['update_plan', 'ask_clarification', 'request_review'])

// ---------------- The native tool-calling loop ----------------

async function runNativeLoop(
  state: LoopState,
  onEvent: (event: AgentEvent) => void,
): Promise<AgentRunResult> {
  const { opts, ctx, modelId, meterSource, runtimeBlock, allowCli } = state
  const toolSpecs = toolSpecsForLLM(allowCli)
  const systemPrompt = SYSTEM_PROMPT.replace('{{RUNTIME}}', runtimeBlock)

  const messages: GatewayMessage[] = [{ role: 'system', content: systemPrompt }]
  for (const h of state.history) {
    messages.push({ role: h.role === 'user' ? 'user' : 'assistant', content: h.content })
  }
  messages.push({ role: 'user', content: `${state.contextPrefix}${state.goalLine}` })

  let iterations = 0
  let toolCalls = 0
  let tokensUsed = 0
  let finalAnswer = ''
  let answerText = ''
  let lastError: string | null = null
  let failureHonestyNudges = 0

  onEvent({ type: 'status', status: 'thinking' })

  while (iterations < state.maxIterations) {
    if (opts.signal?.aborted) {
      console.log(`[agent-engine] aborted by client after ${iterations} iteration(s)`)
      return { answer: finalAnswer, iterations, toolCalls, tokensUsed }
    }
    iterations += 1

    const remaining = state.maxIterations - iterations
    if (remaining === 8) {
      messages.push({
        role: 'user',
        content:
          'NOTE: You have 8 iterations left. Wrap up: finish the essential remaining work and give your final answer.',
      })
    }

    compactMessages(messages)

    // --- Stream one model turn (with one transient-error retry). ---
    let turnText = ''
    let turnThinking = ''
    let turnToolCalls: AssistantToolCall[] = []
    let thinkingBlocks: unknown[] | undefined
    let streamOk = false

    for (let attempt = 0; attempt < 2 && !streamOk; attempt++) {
      turnText = ''
      turnThinking = ''
      turnToolCalls = []
      thinkingBlocks = undefined
      const loopGuard = llmCallSignal(opts.signal, LLM_CALL_TIMEOUT_MS)
      try {
        for await (const ev of chatStream({
          modelId,
          userId: opts.userId,
          source: meterSource,
          messages,
          tools: toolSpecs,
          maxTokens: 8192,
          thinking: true,
          signal: loopGuard.signal,
        })) {
          if (ev.type === 'thinking_delta' && ev.content) {
            turnThinking += ev.content
            onEvent({ type: 'thought_delta', text: ev.content })
          } else if (ev.type === 'delta' && ev.content) {
            turnText += ev.content
            onEvent({ type: 'answer_delta', text: ev.content })
          } else if (ev.type === 'tool_call' && ev.toolCall) {
            turnToolCalls.push(ev.toolCall)
          } else if (ev.type === 'done') {
            if (ev.usage) tokensUsed += ev.usage.totalTokens
            thinkingBlocks = ev.thinkingBlocks
          }
        }
        streamOk = true
      } catch (e) {
        if (opts.signal?.aborted) {
          return { answer: finalAnswer, iterations, toolCalls, tokensUsed }
        }
        lastError = (e as Error).message
        if (attempt < 1) {
          await sleep(1500)
          continue
        }
        onEvent({ type: 'error', message: `LLM call failed: ${lastError}` })
      } finally {
        loopGuard.done()
      }
    }
    if (!streamOk) break

    // Finalize this turn's thinking into a completed reason step.
    if (turnThinking.trim()) {
      onEvent({ type: 'thought', text: turnThinking.trim() })
    }

    // Accumulate assistant narration into the visible answer (Cursor-style).
    if (turnText.trim()) {
      answerText = answerText ? `${answerText}\n\n${turnText.trim()}` : turnText.trim()
    }

    // Record the assistant turn (with tool calls + thinking blocks for replay).
    messages.push({
      role: 'assistant',
      content: turnText,
      toolCalls: turnToolCalls.length > 0 ? turnToolCalls : undefined,
      thinkingBlocks,
    })

    // --- No tool calls → final answer. ---
    if (turnToolCalls.length === 0) {
      const failures = collectRunFailures(ctx)
      if (failures.length > 0 && failureHonestyNudges < 1) {
        failureHonestyNudges += 1
        messages.push({
          role: 'user',
          content:
            `BLOCKED — ${failures.length} tool step(s) FAILED this run:\n${failures.map((f) => `- ${f}`).join('\n')}\n\n` +
            'Do NOT claim success or say the workflow/automation was saved if a step failed. ' +
            'Either retry until the failed steps succeed, OR give a final answer that honestly states what failed, what worked, and what needs user review.',
        })
        onEvent({ type: 'status', status: 'thinking' })
        continue
      }

      const fallback = answerText.trim() || 'I finished, but did not return a written summary.'
      finalAnswer = prefixFailedRunAnswer(fallback, failures)
      // If nothing streamed as answer text, surface the fallback so the UI shows it.
      if (!answerText.trim()) onEvent({ type: 'answer_delta', text: finalAnswer })
      return finalizeRun(onEvent, ctx, finalAnswer, failures, iterations, toolCalls, tokensUsed)
    }

    // --- Execute tool calls: work tools in parallel, control tools after. ---
    const workCalls = turnToolCalls.filter((c) => !CONTROL_TOOLS.has(c.name))
    const controlCalls = turnToolCalls.filter((c) => CONTROL_TOOLS.has(c.name))

    if (workCalls.length > 0) {
      onEvent({ type: 'status', status: 'acting' })
      const heartbeat = setInterval(() => onEvent({ type: 'status', status: 'observing' }), 10_000)
      const outcomes = await Promise.allSettled(
        workCalls.map((c) =>
          executeWorkTool({ tool: c.name, input: c.arguments }, ctx, opts.signal, onEvent),
        ),
      )
      clearInterval(heartbeat)
      toolCalls += workCalls.length
      // Append one tool result per call, in the same order (required by OpenAI).
      workCalls.forEach((c, i) => {
        const o = outcomes[i]
        const observationText =
          o.status === 'fulfilled'
            ? o.value.observationText
            : `Error: ${(o.reason as Error)?.message ?? 'tool crashed'}`
        messages.push({ role: 'tool', toolCallId: c.id, name: c.name, content: observationText })
      })
      onEvent({ type: 'status', status: 'thinking' })
    }

    // Control tools run sequentially after work tools.
    for (const c of controlCalls) {
      if (c.name === 'update_plan') {
        const planDef = getAgentTool('update_plan')
        const planResult = planDef
          ? await planDef.run(c.arguments, ctx)
          : { ok: false, output: null, error: 'update_plan unavailable' }
        toolCalls += 1
        if (planResult.ok && ctx.plan) {
          onEvent({ type: 'plan', items: ctx.plan })
          messages.push({
            role: 'tool',
            toolCallId: c.id,
            name: c.name,
            content: `${JSON.stringify(planResult.output)}. Checklist saved + shown to the user. Continue working through the steps; call update_plan again to mark items in_progress/done.`,
          })
        } else {
          messages.push({
            role: 'tool',
            toolCallId: c.id,
            name: c.name,
            content: `Error — ${planResult.error}. Provide a non-empty items array of { id, label, status }.`,
          })
        }
        continue
      }

      // ask_clarification / request_review — both END the turn with a card.
      const clarifyDef = getAgentTool(c.name)
      const clarifyResult = clarifyDef
        ? await clarifyDef.run(c.arguments, ctx)
        : { ok: false, output: null, error: `${c.name} unavailable` }
      if (!clarifyResult.ok || !ctx.clarification) {
        messages.push({
          role: 'tool',
          toolCallId: c.id,
          name: c.name,
          content: `Error — ${clarifyResult.error}. Provide a ${c.name === 'request_review' ? 'summary and at least 2 options (e.g. approve / cancel)' : 'question and at least 2 options'}.`,
        })
        continue
      }
      toolCalls += 1
      const question = ctx.clarification
      const isReview = question.kind === 'review'
      const narration = turnText.trim()
      const clarifyAnswer =
        narration.length > 0 && narration.length < 320
          ? narration
          : isReview
            ? `I need your approval before continuing: ${question.question}`
            : `Before I continue, I need a bit more detail: ${question.question}`
      finalAnswer = clarifyAnswer
      onEvent({ type: 'clarification', question })
      onEvent({ type: 'status', status: 'done' })
      onEvent({
        type: 'final',
        answer: clarifyAnswer,
        findings: ctx.findings,
        attachments: ctx.producedAssets,
        plan: ctx.plan,
        clarification: question,
        credentialRequests: ctx.credentialRequests,
      })
      return {
        answer: clarifyAnswer,
        findings: ctx.findings,
        attachments: ctx.producedAssets,
        plan: ctx.plan,
        clarification: question,
        credentialRequests: ctx.credentialRequests,
        iterations,
        toolCalls,
        tokensUsed,
      }
    }

    onEvent({ type: 'status', status: 'thinking' })
  }

  if (!finalAnswer) {
    return budgetExhausted(onEvent, ctx, iterations, toolCalls, tokensUsed, lastError)
  }
  return {
    answer: finalAnswer,
    proposedWorkflow: ctx.proposedWorkflow,
    findings: ctx.findings,
    workflowSavedToAgentId: ctx.workflowSavedToAgentId,
    credentialRequests: ctx.credentialRequests,
    createdAgentId: ctx.createdAgentId,
    createdAgentName: ctx.createdAgentName,
    plan: ctx.plan,
    iterations,
    toolCalls,
    tokensUsed,
  }
}

// ---------------- Legacy JSON-protocol loop (models without native tools) ----------------

async function runLegacyLoop(
  state: LoopState,
  onEvent: (event: AgentEvent) => void,
): Promise<AgentRunResult> {
  const { opts, ctx, modelId, meterSource, runtimeBlock, allowCli } = state
  const toolCatalog = toolCatalogForLLM(allowCli)
  const systemPrompt =
    SYSTEM_PROMPT.replace('{{RUNTIME}}', runtimeBlock) +
    '\n\n' +
    LEGACY_PROTOCOL.replace('{{TOOLS}}', toolCatalog)

  // Legacy path uses a flattened transcript (no native message roles/tools).
  const historyBlock =
    state.history.length > 0
      ? `Conversation so far (CONTINUE from here — do not restart, re-introduce yourself, re-ask answered questions, or redo work already completed above):\n${state.history
          .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
          .join('\n\n')}\n\n`
      : ''

  const messages: GatewayMessage[] = [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: `${state.contextPrefix}${historyBlock}${state.goalLine}\n\nBegin. Respond with JSON only.`,
    },
  ]

  let iterations = 0
  let toolCalls = 0
  let tokensUsed = 0
  let finalAnswer = ''
  let lastError: string | null = null
  let failureHonestyNudges = 0

  onEvent({ type: 'status', status: 'thinking' })

  while (iterations < state.maxIterations) {
    if (opts.signal?.aborted) {
      console.log(`[agent-engine] (legacy) aborted by client after ${iterations} iteration(s)`)
      return { answer: '', iterations, toolCalls, tokensUsed }
    }
    iterations += 1

    const remaining = state.maxIterations - iterations
    if (remaining === 8) {
      messages.push({
        role: 'user',
        content:
          'NOTE: You have 8 iterations left. Wrap up: finish the essential remaining work and give your final answer.',
      })
    }

    compactMessages(messages)

    let raw = ''
    let usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
    let emittedThought = 0
    let emittedAnswer = 0
    const loopGuard = llmCallSignal(opts.signal, LLM_CALL_TIMEOUT_MS)
    try {
      for await (const ev of chatStream({
        modelId,
        userId: opts.userId,
        source: meterSource,
        messages,
        temperature: 0.4,
        maxTokens: 4096,
        thinking: false,
        signal: loopGuard.signal,
      })) {
        if (ev.type === 'delta' && ev.content) {
          raw += ev.content
          const thoughtSoFar = extractJsonStringValue(raw, 'thought')
          if (thoughtSoFar.length > emittedThought) {
            onEvent({ type: 'thought_delta', text: thoughtSoFar.slice(emittedThought) })
            emittedThought = thoughtSoFar.length
          }
          const answerSoFar = extractJsonStringValue(raw, 'answer')
          if (answerSoFar.length > emittedAnswer) {
            onEvent({ type: 'answer_delta', text: answerSoFar.slice(emittedAnswer) })
            emittedAnswer = answerSoFar.length
          }
        } else if (ev.type === 'done' && ev.usage) {
          usage = ev.usage
        }
      }
      tokensUsed += usage.totalTokens
    } catch (e) {
      if (opts.signal?.aborted) {
        return { answer: finalAnswer, iterations, toolCalls, tokensUsed }
      }
      lastError = (e as Error).message
      onEvent({ type: 'error', message: `LLM call failed: ${lastError}` })
      break
    } finally {
      loopGuard.done()
    }

    const parsed = parseAgentResponse(raw)
    if (!parsed) {
      messages.push({ role: 'assistant', content: raw })
      messages.push({
        role: 'user',
        content:
          'Your response was not valid JSON. Respond with ONLY a JSON object in the shape {"thought":"...","action":{"tool":"...","input":{...}}} or {"thought":"...","final":{"answer":"..."}}. No prose, no code fences.',
      })
      continue
    }

    if (parsed.thought) {
      onEvent({ type: 'thought', text: parsed.thought })
      messages.push({ role: 'assistant', content: raw })
    }

    if (parsed.final) {
      const failures = collectRunFailures(ctx)
      if (failures.length > 0 && failureHonestyNudges < 1) {
        failureHonestyNudges += 1
        messages.push({ role: 'assistant', content: raw })
        messages.push({
          role: 'user',
          content:
            `BLOCKED — ${failures.length} tool step(s) FAILED this run:\n${failures.map((f) => `- ${f}`).join('\n')}\n\n` +
            'Do NOT claim success or say the workflow/automation was saved if a step failed. ' +
            'Either retry until the failed steps succeed, OR emit a final answer that honestly states what failed, what worked, and what needs user review.',
        })
        onEvent({ type: 'status', status: 'thinking' })
        continue
      }

      finalAnswer = prefixFailedRunAnswer(
        parsed.final.answer?.trim() || parsed.thought?.trim() || 'I finished, but did not return a written summary.',
        failures,
      )
      return finalizeRun(onEvent, ctx, finalAnswer, failures, iterations, toolCalls, tokensUsed)
    }

    if (parsed.action) {
      const { tool, input } = parsed.action as ToolCall

      // Control tools handled inline (single-tool-per-turn protocol).
      if (tool === 'update_plan') {
        const planDef = getAgentTool('update_plan')
        const planResult = planDef
          ? await planDef.run(input, ctx)
          : { ok: false, output: null, error: 'update_plan unavailable' }
        toolCalls += 1
        if (!parsed.thought) messages.push({ role: 'assistant', content: raw })
        if (planResult.ok && ctx.plan) {
          onEvent({ type: 'plan', items: ctx.plan })
          messages.push({
            role: 'user',
            content: `Observation (update_plan): ${JSON.stringify(planResult.output)}. Checklist saved + shown to the user. Continue working through the steps; call update_plan again to mark items in_progress/done.`,
          })
        } else {
          messages.push({
            role: 'user',
            content: `Observation (update_plan): Error — ${planResult.error}. Provide a non-empty items array of { id, label, status }.`,
          })
        }
        onEvent({ type: 'status', status: 'thinking' })
        continue
      }

      if (tool === 'ask_clarification' || tool === 'request_review') {
        const clarifyDef = getAgentTool(tool)
        const clarifyResult = clarifyDef
          ? await clarifyDef.run(input, ctx)
          : { ok: false, output: null, error: `${tool} unavailable` }
        if (!clarifyResult.ok || !ctx.clarification) {
          if (!parsed.thought) messages.push({ role: 'assistant', content: raw })
          messages.push({
            role: 'user',
            content: `Observation (${tool}): Error — ${clarifyResult.error}. Provide a ${tool === 'request_review' ? 'summary and at least 2 options (e.g. approve / cancel)' : 'question and at least 2 options'}.`,
          })
          onEvent({ type: 'status', status: 'thinking' })
          continue
        }
        toolCalls += 1
        const question = ctx.clarification
        const isReview = question.kind === 'review'
        const clarifyAnswer =
          parsed.thought && parsed.thought.trim().length > 0 && parsed.thought.trim().length < 320
            ? parsed.thought.trim()
            : isReview
              ? `I need your approval before continuing: ${question.question}`
              : `Before I continue, I need a bit more detail: ${question.question}`
        finalAnswer = clarifyAnswer
        onEvent({ type: 'clarification', question })
        onEvent({ type: 'status', status: 'done' })
        onEvent({
          type: 'final',
          answer: clarifyAnswer,
          findings: ctx.findings,
          attachments: ctx.producedAssets,
          plan: ctx.plan,
          clarification: question,
          credentialRequests: ctx.credentialRequests,
        })
        return {
          answer: clarifyAnswer,
          findings: ctx.findings,
          attachments: ctx.producedAssets,
          plan: ctx.plan,
          clarification: question,
          credentialRequests: ctx.credentialRequests,
          iterations,
          toolCalls,
          tokensUsed,
        }
      }

      if (!parsed.thought) messages.push({ role: 'assistant', content: raw })
      onEvent({ type: 'status', status: 'acting' })
      const { observationText } = await executeWorkTool({ tool, input }, ctx, opts.signal, onEvent)
      toolCalls += 1
      messages.push({ role: 'user', content: `Observation (${tool}): ${observationText}` })
      onEvent({ type: 'status', status: 'thinking' })
      continue
    }

    messages.push({
      role: 'user',
      content:
        'Respond with either an action ({"thought":...,"action":{"tool":...,"input":...}}) or a final answer ({"thought":...,"final":{"answer":...}}).',
    })
  }

  if (!finalAnswer) {
    return budgetExhausted(onEvent, ctx, iterations, toolCalls, tokensUsed, lastError)
  }
  return {
    answer: finalAnswer,
    proposedWorkflow: ctx.proposedWorkflow,
    findings: ctx.findings,
    workflowSavedToAgentId: ctx.workflowSavedToAgentId,
    credentialRequests: ctx.credentialRequests,
    createdAgentId: ctx.createdAgentId,
    createdAgentName: ctx.createdAgentName,
    plan: ctx.plan,
    iterations,
    toolCalls,
    tokensUsed,
  }
}

// ---------------- Entry point ----------------

/**
 * Run the autonomous agent loop. Streams events to the callback as it goes.
 * Returns the final result when done (or when the budget is exhausted).
 */
export async function runAgent(
  opts: AgentRunOptions,
  onEvent: (event: AgentEvent) => void,
): Promise<AgentRunResult> {
  const {
    userId,
    goal,
    agentId,
    context,
    history,
    priorPlan,
    attachments,
    script,
    maxIterations = 64,
    allowCli = false,
    isDesktop = false,
    source = 'agent',
  } = opts

  const meterSource = source

  onEvent({ type: 'status', status: 'preparing' })

  // Preflight reads run concurrently (needs connection_limit > 1 to overlap).
  // Each is defensive so one slow/failed read can't stall the whole turn.
  const userContextBlockPromise = loadUserContextBlock(userId).catch(() => '')
  const allowancePromise = checkAllowance(userId).catch(
    () => ({ allowed: true, overrunEnabled: false }) as Awaited<ReturnType<typeof checkAllowance>>,
  )
  const ownedAgentRowPromise: Promise<{
    name: string
    description: string
    stepsJson: string
    schedule: string | null
    trigger: string
  } | null> = agentId
    ? db.workflow
        .findFirst({
          where: { id: agentId, OR: [{ userId }, { userId: null }] },
          select: {
            name: true,
            description: true,
            stepsJson: true,
            schedule: true,
            trigger: true,
          },
        })
        .catch(() => null)
    : Promise.resolve(null)

  // Resolve the model (a 2-hop chain) concurrently with the preflight reads.
  const modelResolutionPromise = (async () => {
    const mid = await resolveModelPreferenceForUser(userId, opts.modelId)
    if (!mid) return { modelId: null as string | null, resolved: null }
    const resolved = await resolveModel(userId, mid)
    return { modelId: mid, resolved }
  })()

  const { modelId, resolved: resolvedModel } = await modelResolutionPromise
  if (!modelId) {
    onEvent({ type: 'error', message: NO_LLM_PROVIDER_ERROR })
    return { answer: '', iterations: 0, toolCalls: 0, tokensUsed: 0 }
  }

  const useCloudRelay = resolvedModel?.adapter === 'cloud-relay'

  // Local allowance applies only when we call providers directly — cloud relay
  // bills the linked Apical account on api.apic.al.
  if (!useCloudRelay) {
    const allowance = await allowancePromise
    if (!allowance.allowed) {
      onEvent({
        type: 'error',
        message: allowance.overrunEnabled
          ? 'You have exceeded your token allowance. Add credits or enable overrun billing to continue.'
          : 'You have exceeded your token allowance for this period.',
      })
      return { answer: '', iterations: 0, toolCalls: 0, tokensUsed: 0 }
    }
  }

  // SECURITY: verify the caller actually owns the agent workflow they claim to
  // act as. If the id doesn't resolve under this user, null it out — otherwise
  // ctx.agentId becomes an IDOR handle for workflow_update/monitor/improve.
  let ownedAgentRow: {
    name: string
    description: string
    stepsJson: string
    schedule: string | null
    trigger: string
  } | null = null
  let effectiveAgentId = agentId ?? null
  if (effectiveAgentId) {
    ownedAgentRow = await ownedAgentRowPromise
    if (!ownedAgentRow) {
      console.warn(
        `[agent-engine] agentId ${effectiveAgentId} is not owned by user ${userId}; ignoring.`,
      )
      effectiveAgentId = null
    }
  }

  // Both only apply to an owned agent — fire them together so the trace merge
  // and recent-runs block don't cost two serial round-trips.
  const priorTracePromise = effectiveAgentId
    ? loadPriorEngineTrace(effectiveAgentId).catch(
        () => [] as Awaited<ReturnType<typeof loadPriorEngineTrace>>,
      )
    : Promise.resolve([] as Awaited<ReturnType<typeof loadPriorEngineTrace>>)
  const recentRunsPromise = effectiveAgentId
    ? db.run
        .findMany({
          where: { workflowId: effectiveAgentId },
          orderBy: { startedAt: 'desc' },
          take: 5,
          select: {
            id: true,
            status: true,
            startedAt: true,
            itemsProcessed: true,
            flaggedCount: true,
          },
        })
        .catch(() => [] as { id: string; status: string; startedAt: Date; itemsProcessed: number; flaggedCount: number }[])
    : Promise.resolve(
        [] as { id: string; status: string; startedAt: Date; itemsProcessed: number; flaggedCount: number }[],
      )

  const ctx: ToolContext = {
    userId,
    agentId: effectiveAgentId,
    allowCli,
    maxFetchBytes: 50_000,
    findings: [],
    executionTrace: [],
    usedCredentialIds: [],
    producedAssets: [],
    userGoal: goal,
    signal: opts.signal,
  }

  // Carry an unfinished checklist forward so the agent resumes it.
  const unfinishedPriorPlan =
    priorPlan && priorPlan.some((p) => p.status !== 'done') ? priorPlan : undefined
  if (unfinishedPriorPlan) {
    ctx.plan = unfinishedPriorPlan
  }

  // Merge substantive steps from recent chat turns so a freeze in a follow-up
  // turn can still capture work done in the previous turn.
  if (effectiveAgentId) {
    const prior = await priorTracePromise
    if (prior.length > 0) {
      ctx.executionTrace = prior
    }
  }

  // If we're acting AS a specific agent, load its identity + the workflow it
  // owns, so it can follow + evolve its own process.
  let ownWorkflowBlock = ''
  let agentHasSavedWorkflow = false
  if (effectiveAgentId) {
    try {
      const row = ownedAgentRow
      if (row) {
        ctx.agentName = row.name
        let wf: WorkflowJSON = { version: 1, steps: [] }
        try {
          wf = parseWorkflowJSON(row.stepsJson)
        } catch {
          wf = { version: 1, steps: [] }
        }
        ctx.currentWorkflow = wf
        agentHasSavedWorkflow =
          wf.steps.length > 0 && savedWorkflowHasExecutableSteps(JSON.stringify(wf))
        const stepsJson = JSON.stringify(wf, null, 2)

        let recentRunsBlock = ''
        try {
          const recentRuns = await recentRunsPromise
          if (recentRuns.length > 0) {
            recentRunsBlock =
              `Recent automated runs:\n` +
              recentRuns
                .map(
                  (r) =>
                    `  - ${r.startedAt.toISOString().slice(0, 16)} · ${r.status} · ${r.itemsProcessed} items${r.flaggedCount ? ` · ${r.flaggedCount} flagged` : ''}`,
                )
                .join('\n') +
              `\nCall workflow_monitor(workflowId="${effectiveAgentId}") to inspect run results and failures, then workflow_update to fix broken automation nodes.\n\n`
          }
        } catch {
          // non-fatal
        }

        if (agentHasSavedWorkflow) {
          ownWorkflowBlock =
            `YOU ARE THIS AGENT: "${row.name}".\n` +
            `What you do: ${row.description}\n` +
            (row.schedule ? `Schedule: ${row.schedule} (${row.trigger})\n` : '') +
            `YOUR SAVED AUTOMATION (you own this):\n` +
            `${stepsJson}\n\n` +
            `The runtime executes this automation without you. Monitor its runs (workflow_monitor) and update nodes when they fail or requirements change (workflow_update / workflow_improve). Do NOT re-explore on every repeat unless a run failed or the user asked for changes.\n` +
            recentRunsBlock
        } else if (wf.steps.length > 0) {
          ownWorkflowBlock =
            `YOU ARE THIS AGENT: "${row.name}".\n` +
            `What you do: ${row.description}\n` +
            `YOUR AUTOMATION: INVALID — saved steps lack executable parameters. Treat as empty.\n\n` +
            `Accomplish the job with real tool calls (full arguments), learn what worked, then workflow_freeze a proper automation.\n` +
            recentRunsBlock
        } else {
          ownWorkflowBlock =
            `YOU ARE THIS AGENT: "${row.name}".\n` +
            `What you do: ${row.description}\n` +
            `YOUR AUTOMATION: not designed yet.\n\n` +
            `You are a general intelligent assistant with full user context — answer any question naturally. ` +
            `For automatable jobs: accomplish with tools → learn → workflow_freeze → monitor.\n` +
            recentRunsBlock
        }
        if ((ctx.executionTrace?.length ?? 0) > 0) {
          ownWorkflowBlock +=
            `Prior substantive tool steps from recent turns are loaded into your trace (${ctx.executionTrace!.length} steps) — you can freeze them if this turn is only saving the workflow.\n\n`
        }
      }
    } catch {
      // non-fatal — proceed without the workflow block
    }
  }

  const attachmentBlock =
    attachments && attachments.length > 0
      ? `Attached files/folders:\n${attachments
          .map((a) => {
            const loc = a.localPath ? ` path=${a.localPath}` : ` url=${a.url}`
            return `- ${a.name} (${a.kind}, ${a.mimeType})${loc}`
          })
          .join('\n')}\n\n`
      : ''

  const scriptBlock = script?.code
    ? `User provided script (${script.language}) to run if relevant:\n\`\`\`${script.language}\n${script.code}\n\`\`\`\n\n`
    : ''

  const platform: ClientPlatform = clientPlatformFromRequest(isDesktop)
  const runtimeBlock = runtimeContextForLLM({ platform, allowCli })

  // An in-progress checklist from an earlier turn.
  const planBlock = unfinishedPriorPlan
    ? `Plan already in progress from an earlier turn — CONTINUE this exact checklist (call update_plan to mark items in_progress/done as you go; do NOT start a new one):\n${unfinishedPriorPlan
        .map((p) => `- [${p.status === 'done' ? 'x' : p.status === 'in_progress' ? '~' : ' '}] ${p.label}`)
        .join('\n')}\n\n`
    : ''

  const userContextBlock = await userContextBlockPromise

  const contextPrefix = `${userContextBlock}${ownWorkflowBlock}${planBlock}${attachmentBlock}${scriptBlock}`
  const goalLine = `Goal: ${goal}${context ? `\n\nAdditional context:\n${context}` : ''}`

  const state: LoopState = {
    opts,
    ctx,
    modelId,
    meterSource,
    runtimeBlock,
    allowCli,
    contextPrefix,
    goalLine,
    history: history ?? [],
    unfinishedPriorPlan,
    maxIterations,
  }

  // Branch: native tool calling when the model supports it, else legacy JSON.
  const useNative = resolvedModel ? modelSupportsTools(resolvedModel) : true
  return useNative ? runNativeLoop(state, onEvent) : runLegacyLoop(state, onEvent)
}

// ---------------- Legacy response parsing (JSON-protocol fallback) ----------------

interface ParsedAgentResponse {
  thought?: string
  action?: ToolCall
  final?: { answer?: string }
}

/**
 * Pull the (possibly in-progress) string value for a JSON key out of a partial
 * JSON string being streamed from the LLM. Returns the decoded string so far;
 * '' if the key/value hasn't started yet. Used only by the legacy loop to
 * surface the live "thought" + final "answer" while the JSON streams.
 */
function extractJsonStringValue(raw: string, key: string): string {
  const marker = `"${key}"`
  let i = raw.indexOf(marker)
  if (i < 0) return ''
  i += marker.length
  while (i < raw.length && /\s/.test(raw[i])) i++
  if (raw[i] !== ':') return ''
  i++
  while (i < raw.length && /\s/.test(raw[i])) i++
  if (raw[i] !== '"') return ''
  i++
  let out = ''
  while (i < raw.length) {
    const c = raw[i]
    if (c === '\\') {
      const n = raw[i + 1]
      if (n === undefined) break // incomplete escape at the stream boundary
      switch (n) {
        case 'n': out += '\n'; break
        case 't': out += '\t'; break
        case 'r': out += '\r'; break
        case '"': out += '"'; break
        case '\\': out += '\\'; break
        case '/': out += '/'; break
        case 'b': out += '\b'; break
        case 'f': out += '\f'; break
        case 'u': {
          const hex = raw.slice(i + 2, i + 6)
          if (hex.length < 4) return out // incomplete unicode escape
          out += String.fromCharCode(parseInt(hex, 16) || 0)
          i += 4
          break
        }
        default: out += n
      }
      i += 2
      continue
    }
    if (c === '"') break // closing quote — value complete
    out += c
    i++
  }
  return out
}

function parseAgentResponse(raw: string): ParsedAgentResponse | null {
  if (!raw) return null
  let s = raw.trim()
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
  if (!s.startsWith('{')) {
    const start = s.indexOf('{')
    const end = s.lastIndexOf('}')
    if (start >= 0 && end > start) s = s.slice(start, end + 1)
  }
  try {
    const obj = JSON.parse(s) as ParsedAgentResponse
    if (typeof obj !== 'object' || obj === null) return null
    return obj
  } catch {
    return null
  }
}

// Re-export for callers that want to stream the thought.
export { chatStream }
