// Apical agent engine — a ReAct (Reason+Act) loop with chain-of-thought.
//
// This is the "vibe coding" brain. Given a goal, the agent:
//   1. THINKS — reasons about what to do next (chain-of-thought, streamed).
//   2. ACTS — picks a tool + inputs.
//   3. OBSERVES — runs the tool, gets a structured result.
//   4. Repeats until it has a final answer OR hits the iteration/budget cap.
//
// The engine streams events so the UI can show the thinking in real time:
//   { type: 'status', status: 'thinking'|'acting'|'observing'|'done' }
//   { type: 'thought', text: '...' }         // chain-of-thought reasoning
//   { type: 'tool_call', tool, input }       // the agent picked a tool
//   { type: 'observation', tool, ok, output, display? }  // the tool result
//   { type: 'final', answer, proposedWorkflow?, findings? }
//   { type: 'error', message }
//
// The agent uses the LLM gateway (chat + chatStream) so it respects the
// user's model choice + BYOK + token metering.

import { chat, chatStream, recordUsage, checkAllowance, resolveModelPreference, NO_LLM_PROVIDER_ERROR } from '@/lib/platform/llm-gateway'
import { AGENT_TOOLS, getAgentTool, toolCatalogForLLM, type ToolCall, type ToolContext, type ToolResult, type CredentialRequest } from './agent-tools'
import {
  clientPlatformFromRequest,
  runtimeContextForLLM,
  type ClientPlatform,
} from './runtime-context'
import { db } from '@/lib/db'
import { parseWorkflowJSON } from '@/lib/apical-server'
import type { WorkflowJSON } from '@/lib/types'

// ---------------- Types ----------------

export type AgentEvent =
  | { type: 'status'; status: 'thinking' | 'acting' | 'observing' | 'done' }
  | { type: 'thought'; text: string }
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
      credentialRequest?: CredentialRequest
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
  /** Max reasoning iterations (default 12). */
  maxIterations?: number
  /** Whether CLI access is allowed (routes through the desktop bridge). */
  allowCli?: boolean
  /** Client platform — desktop (Tauri) or web browser. */
  isDesktop?: boolean
  /** The usage-log source bucket for token metering. */
  source?: 'chat' | 'agent' | 'workflow' | 'reason' | 'research'
}

export interface AgentRunResult {
  answer: string
  proposedWorkflow?: WorkflowJSON
  findings?: ToolContext['findings']
  attachments?: ToolContext['producedAssets']
  workflowSavedToAgentId?: string
  credentialRequest?: CredentialRequest
  iterations: number
  toolCalls: number
  tokensUsed: number
}

// ---------------- The loop ----------------

const SYSTEM_PROMPT = `You are Apical, an autonomous AI agent that accomplishes real work for the user. You operate in a LEARN-FIRST CONTINUOUS-IMPROVEMENT loop.

{{RUNTIME}}

Always respect your runtime capabilities and limitations above. Never claim abilities you do not have in this session, and never refuse tasks you can do with your available tools.

YOUR OPERATING MODEL (the user's exact specification):

  1. USER NEEDS SOMETHING. You receive a goal.
  2. ORIENT. Before doing anything, see what already exists: call agent_list (is there an agent that already owns this job? — if so, say so and route to it instead of duplicating), credential_list, integration_list, and mcp_list_servers. This is cheap and prevents wasted work.
  3. TRY TO DO IT. Attempt the task directly using your tools. You don't propose an abstract workflow upfront — you DO the work, step by step, observing what happens. Use web_search/web_read for research; http_request for APIs; fs_list/fs_read/fs_write/fs_move for local files; cli_run for shell; mcp_call_tool for connected MCP capabilities; data_table_* to store structured results.
  4. REALIZE YOU NEED A TOOL. When you hit a gap (no API connected, no MCP server for this service, missing credential), you CONFIGURE the tool mid-flight:
     - Discover the service: web_search for "<service> API" or "<service> MCP server" or "<service> OpenAPI spec".
     - Install it: call tool_configure with kind="openapi" + specUrl, OR kind="mcp" + transport/url.
     - Get credentials: if the service needs auth, FIRST call credential_list to see what's already saved (you see names/services, NEVER the secret value). If the key you need isn't there, call credential_request — this pops a SECURE key-entry box right in the chat where the user saves the key straight to the vault. After they save it, call credential_list again to get the new credentialId, then reference it via http_request's credentialId parameter. NEVER ask the user to paste a key into the chat text, and NEVER tell them to go open the Vault tab themselves — use credential_request.
     - REPEAT. Keep configuring + trying until you can actually accomplish the task.
  5. SAVE THE PROCESS AS A WORKFLOW (JSON). Your job is defined by a JSON workflow — an ordered list of tool/reason/gate steps. Once the task works end-to-end, your execution trace IS that workflow. Call workflow_freeze to save the proven steps. IF YOU ARE A SPECIFIC AGENT, freeze saves to YOUR OWN workflow (you own it). As you learn a better process over time, call workflow_update with the complete new steps to evolve your workflow. The workflow references credentials by id only — secrets stay in the vault.
  6. NEW AGENT — ONLY WHEN WARRANTED. Do NOT spin up a new agent for work that belongs to you (the agent you already are) or for a one-off. Only call agent_create when (a) you are the general Apical orchestrator materializing a brand-new recurring job that has no owner yet, OR (b) the user explicitly asks for a separate, dedicated agent, OR (c) the job is clearly distinct from any existing agent's purpose. When in doubt, keep the work on the current agent's own workflow (workflow_freeze / workflow_update) rather than creating a duplicate.
  7. AUTOMATE IT. For a recurring job, call schedule_agent with the agentId + a cron ("0 9 * * *") or fixed_rate ("fixed_rate:3600") schedule so it runs on its own. Recommend a sensible cadence based on the task (e.g. lead scans weekly, inbox triage every 15 min, compliance checks daily).
  8. MONITOR + IMPROVE. Once scheduled, it runs on its own. Call workflow_monitor periodically to see recent runs + failures. When you spot failures, call workflow_update (your own workflow) or workflow_improve (any workflow by id) with the fix. The workflow gets better over time. This is an ONGOING process — not a one-and-done.

THE KEY INSIGHT: do the work first, learn the real process (folder structures, API shapes, edge cases, failure modes), THEN save what you learned into your JSON workflow and keep evolving it. A workflow proposed from assumptions is fragile; one frozen from observed reality is robust. Agents OWN and continuously refine their own workflow — they don't spawn duplicates. The freeze isn't the end — you keep monitoring + improving forever.

ONE-OFF vs. RECURRING: if the user just wants a single answer right now (a question, a quick lookup, a one-time computation), skip steps 6-7 — just do it and give the final answer. Only create + schedule an agent when the job is genuinely recurring or the user asks to "set up", "automate", "monitor", "track", or "every <interval>".

HOW YOU TALK: there is no separate "plan mode" vs "do mode" — it's one natural conversation. Plan internally (your "thought" is private reasoning, not shown as a deliverable). If the user is just chatting or asking a question, answer them naturally and conversationally — don't over-formalize, don't lecture about workflows, and don't force tool use. If the user asks you to DO something, do it. Be a helpful, capable collaborator, not a wizard with steps.

YOU CAN FIND AND ADD TOOLS YOURSELF — THIS IS CORE. Never tell the user "I can't access X", "I'm unable to integrate Y", or "you'll need to connect Z" as if it's out of your hands. You have real capabilities:
  - web_search works right now (no API key needed) — use it to find APIs, MCP servers, OpenAPI specs, docs, and data sources.
  - web_read / http_request let you actually call those APIs and read those pages.
  - tool_configure lets you INSTALL a new integration yourself, mid-conversation: kind="mcp" (transport + command/url) to connect an MCP server, or kind="openapi" (specUrl) to ingest an API spec and auto-generate tools. After it succeeds, the new tools are yours to use via mcp_call_tool / integration_list.
  - The ONLY thing you can't do yourself is provide a secret credential — for that, call credential_request to pop an inline, secure key box in the chat (saves straight to the vault), then reference it by credentialId. That's the single exception; everything else (finding, evaluating, connecting tools) you do on your own.
  So when a task needs a capability you don't have yet: search for it → read the docs → tool_configure to install it → use it. Report what you found and connected, not what you "can't" do.

You operate in a ReAct loop: THINK → ACT → OBSERVE → repeat.

Each turn you MUST respond with a single JSON object (no prose, no code fences, no markdown) in one of these shapes:

To think + call a tool:
  {"thought":"<your chain-of-thought reasoning — what you know, what you need, why this step>","action":{"tool":"<tool_name>","input":{...}}}

When you have the final answer (no more tools needed):
  {"thought":"<final reasoning>","final":{"answer":"<a clear, complete answer for the user>"}}

You have these tools available:
<tools>
{{TOOLS}}
</tools>

RULES:
- HARD RULE — WORK BEFORE AUTOMATION: You MUST actually perform the core task with real tool calls and observe real results BEFORE you ever call workflow_freeze, agent_create, or schedule_agent. Doing the work means: fetching the real data, calling the real API/MCP tool, reading the real files, producing the real output — not describing what you would do. If you have not yet completed at least one full pass of the actual job with tools, you are FORBIDDEN from freezing, creating, or scheduling anything. Automating a job you have not done yourself is a failure, not a success.
- THE ORDER IS ALWAYS: (1) do the work with tools and show real results → (2) confirm it actually worked → (3) ONLY THEN freeze the trace → agent_create → schedule_agent. Never invert this. Never jump to building/proposing an agent as your first or second move.
- Always include a "thought" with your reasoning before every action.
- Pick ONE tool per turn. Wait for the observation before deciding the next step.
- For SIMPLE questions you already know the answer to (e.g. "what is 2+2?"), skip tools and emit a "final" immediately.
- For COMPLEX tasks, START BY TRYING. Call agent_list (avoid duplicates) + credential_list + integration_list + mcp_list_servers to see what you have. Then ACTUALLY DO THE TASK — gather the real data, make the real calls, produce the real result. If you hit a gap, configure the missing tool (tool_configure) and try again. Repeat until the job is genuinely done.
- NEVER propose or build a workflow from assumptions. Always do the task by hand first (real tools, real observations), then call workflow_freeze to convert your real execution trace into the workflow. For a recurring job, follow freeze with agent_create (to persist a dedicated agent) and schedule_agent (to automate it).
- If the user explicitly asks you to "set up an agent" / "automate X", treat that as: do X once right now to prove the approach, narrate what you actually did + found, and THEN create + schedule the agent from that proven trace. Don't skip the proof.
- NEVER ask the user to paste API keys into the chat text, and NEVER tell them to go to the Vault tab. If auth is needed, call credential_request (renders a secure inline box that saves to the vault), then reference the credential by credentialId.
- WORKFLOW OWNERSHIP: if you are a specific agent, the workflow you build belongs to YOU — use workflow_freeze / workflow_update to save + evolve your own steps. Do NOT call agent_create for your own job; only create a new agent when it's a genuinely separate, dedicated job (or the user asks).
- When you call http_request or web_read with auth, pass credentialId (NOT raw keys in headers — auth headers are stripped server-side).
- Be creative and resourceful. If a website doesn't have an API, scrape it. If a search doesn't help, try a different query. If a tool fails, reason about why and try another approach.
- After freezing a workflow, mention that you'll monitor it + improve it over time. If the user reports a failure later, call workflow_monitor + workflow_improve to fix it.
- When the task is fully done, emit a "final" with a clear answer + summary of what you did + what you found + (if relevant) what workflow you froze.
- Keep thoughts concise (1-3 sentences). Be efficient with iterations.
- If you can't accomplish the goal (missing access the user won't grant, blocked, etc.), say so in a "final" with what you tried + what the user needs to do.`

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
    attachments,
    script,
    maxIterations = 16,
    allowCli = false,
    isDesktop = false,
    source = 'agent',
  } = opts

  // Resolve the model: an explicit id, else the first hosted model whose
  // provider key is configured in our environment.
  const modelId = resolveModelPreference(opts.modelId)
  if (!modelId) {
    onEvent({ type: 'error', message: NO_LLM_PROVIDER_ERROR })
    return { answer: '', iterations: 0, toolCalls: 0, tokensUsed: 0 }
  }

  // Check the token allowance up front.
  const allowance = await checkAllowance(userId)
  if (!allowance.allowed) {
    onEvent({
      type: 'error',
      message: allowance.overrunEnabled
        ? 'You have exceeded your token allowance. Add credits or enable overrun billing to continue.'
        : 'You have exceeded your token allowance for this period.',
    })
    return { answer: '', iterations: 0, toolCalls: 0, tokensUsed: 0 }
  }

  const ctx: ToolContext = {
    userId,
    agentId: agentId ?? null,
    allowCli,
    maxFetchBytes: 50_000,
    findings: [],
    executionTrace: [],
    usedCredentialIds: [],
    producedAssets: [],
  }

  // If we're acting AS a specific agent, load its identity + the workflow it
  // owns, so it can follow + evolve its own process.
  let ownWorkflowBlock = ''
  if (agentId) {
    try {
      const row = await db.workflow.findFirst({
        where: { id: agentId, OR: [{ userId }, { userId: null }] },
        select: { name: true, title: true, description: true, stepsJson: true },
      })
      if (row) {
        ctx.agentName = row.name
        ctx.agentTitle = row.title
        let wf: WorkflowJSON = { version: 1, steps: [] }
        try {
          wf = parseWorkflowJSON(row.stepsJson)
        } catch {
          wf = { version: 1, steps: [] }
        }
        ctx.currentWorkflow = wf
        const stepsJson = JSON.stringify(wf, null, 2)
        ownWorkflowBlock =
          `YOU ARE THIS AGENT: "${row.name}"${row.title ? ` (${row.title})` : ''}.\n` +
          `What you do: ${row.description}\n` +
          `YOUR CURRENT WORKFLOW (the JSON process you own and follow):\n` +
          `${stepsJson}\n\n` +
          `This workflow is YOURS. Follow it when it fits the request. When you learn a better process (new step, fixed step, reordered, added gate), call workflow_update with the complete new steps to evolve it. When you successfully complete the job by hand, call workflow_freeze to save the proven steps as your workflow. Do NOT create a separate new agent for work that is your own job.\n\n`
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
  const toolCatalog = toolCatalogForLLM(allowCli)
  const runtimeBlock = runtimeContextForLLM({ platform, allowCli })
  const systemPrompt = SYSTEM_PROMPT.replace('{{TOOLS}}', toolCatalog).replace(
    '{{RUNTIME}}',
    runtimeBlock,
  )

  const historyBlock =
    history && history.length > 0
      ? `Conversation so far:\n${history
          .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
          .join('\n\n')}\n\n`
      : ''

  // The conversation history (system + user goal + each thought/action/observation).
  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: `${ownWorkflowBlock}${historyBlock}${attachmentBlock}${scriptBlock}Goal: ${goal}${context ? `\n\nAdditional context:\n${context}` : ''}\n\nBegin. Respond with JSON only.`,
    },
  ]

  let iterations = 0
  let toolCalls = 0
  let tokensUsed = 0
  let finalAnswer = ''
  let lastError: string | null = null

  onEvent({ type: 'status', status: 'thinking' })

  while (iterations < maxIterations) {
    iterations += 1

    // Budget nudge: when we're running low on iterations, tell the LLM to
    // wrap up with a final answer or call workflow_propose.
    const remaining = maxIterations - iterations
    if (remaining === 3) {
      messages.push({
        role: 'user',
        content: 'NOTE: You have 3 iterations left. If this is a recurring job, wrap up: workflow_freeze → agent_create → schedule_agent, then emit your final answer. If a single workflow proposal is enough, call workflow_propose. If the task was a pure question (no agent needed), just emit your final answer.',
      })
    }

    // --- Call the LLM (non-streaming for the JSON decision; we stream the
    // thought separately if the model supports it). ---
    let raw = ''
    let usage: { promptTokens: number; completionTokens: number; totalTokens: number } = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
    try {
      // We use the non-streaming chat() for the decision so we can parse the
      // full JSON at once. The thought is still surfaced to the UI.
      const res = await chat({
        modelId,
        userId,
        source,
        messages,
        temperature: 0.4,
        maxTokens: 1200,
      })
      raw = res.content
      usage = res.usage
      tokensUsed += usage.totalTokens
      await recordUsage({
        userId,
        modelId,
        provider: res.provider,
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        costCents: res.costCents,
        source,
        refId: undefined,
      })
    } catch (e) {
      lastError = (e as Error).message
      onEvent({ type: 'error', message: `LLM call failed: ${lastError}` })
      break
    }

    // --- Parse the LLM's JSON response. ---
    const parsed = parseAgentResponse(raw)
    if (!parsed) {
      // The LLM didn't return valid JSON. Nudge it.
      messages.push({ role: 'assistant', content: raw })
      messages.push({
        role: 'user',
        content: 'Your response was not valid JSON. Respond with ONLY a JSON object in the shape {"thought":"...","action":{"tool":"...","input":{...}}} or {"thought":"...","final":{"answer":"..."}}. No prose, no code fences.',
      })
      continue
    }

    // Surface the thought (chain-of-thought).
    if (parsed.thought) {
      onEvent({ type: 'thought', text: parsed.thought })
      messages.push({ role: 'assistant', content: raw })
    }

    // --- Final answer? ---
    if (parsed.final) {
      finalAnswer =
        parsed.final.answer?.trim() ||
        parsed.thought?.trim() ||
        'I finished, but did not return a written summary.'
      onEvent({ type: 'status', status: 'done' })
      onEvent({
        type: 'final',
        answer: finalAnswer,
        proposedWorkflow: ctx.proposedWorkflow,
        findings: ctx.findings,
        attachments: ctx.producedAssets,
        workflowSavedToAgentId: ctx.workflowSavedToAgentId,
        credentialRequest: ctx.credentialRequest,
      })
      return {
        answer: finalAnswer,
        proposedWorkflow: ctx.proposedWorkflow,
        findings: ctx.findings,
        attachments: ctx.producedAssets,
        workflowSavedToAgentId: ctx.workflowSavedToAgentId,
        credentialRequest: ctx.credentialRequest,
        iterations,
        toolCalls,
        tokensUsed,
      }
    }

    // --- Tool call? ---
    if (parsed.action) {
      const { tool, input } = parsed.action as ToolCall
      const def = getAgentTool(tool)
      if (!def) {
        onEvent({ type: 'observation', tool, ok: false, output: null })
        messages.push({
          role: 'user',
          content: `Observation: Error — unknown tool "${tool}". Available tools: ${AGENT_TOOLS.map((t) => t.name).join(', ')}`,
        })
        continue
      }

      // Pre-call validation: check required params are present. This catches
      // the common failure where the LLM sends an empty input object.
      const missing: string[] = []
      for (const [k, schema] of Object.entries(def.inputSchema)) {
        if (schema.required && (input[k] === undefined || input[k] === null || input[k] === '')) {
          missing.push(k)
        }
      }
      if (missing.length > 0) {
        onEvent({ type: 'status', status: 'acting' })
        onEvent({ type: 'tool_call', tool, input })
        onEvent({
          type: 'observation',
          tool,
          ok: false,
          output: null,
          display: { title: `${tool} (missing params)`, summary: missing.join(', '), kind: 'info' },
        })
        messages.push({
          role: 'user',
          content: `Observation (${tool}): Error — missing required params: ${missing.join(', ')}. The input you sent was ${JSON.stringify(input)}. You MUST include all required params. Param schema: ${JSON.stringify(def.inputSchema)}`,
        })
        continue
      }

      onEvent({ type: 'status', status: 'acting' })
      onEvent({ type: 'tool_call', tool, input })
      toolCalls += 1

      // Track in the execution trace (for workflow_freeze).
      const traceStepId = `t${(ctx.executionTrace?.length ?? 0) + 1}`
      const traceStart = Date.now()
      // Determine the step kind from the tool name (for the freeze step).
      const traceKind: 'tool' | 'reason' | 'gate' =
        tool === 'workflow_freeze' || tool === 'workflow_propose' ? 'gate' :
        tool === 'code_eval' ? 'reason' : 'tool'
      const traceLabel = `${tool}(${Object.keys(input).join(',')})`
      ctx.executionTrace?.push({
        stepId: traceStepId,
        kind: traceKind,
        label: traceLabel,
        tool: tool === 'http_request' ? 'http' : tool === 'mcp_call_tool' ? 'mcp' : tool,
        status: 'running',
      })

      // Track credential usage (for the freeze step's credentialIds).
      const credId = (input.credentialId as string) || (input.bearerToken as string)
      if (credId && ctx.usedCredentialIds && !ctx.usedCredentialIds.includes(credId)) {
        ctx.usedCredentialIds.push(credId)
      }

      onEvent({ type: 'status', status: 'observing' })
      let result: ToolResult
      try {
        result = await def.run(input, ctx)
      } catch (e) {
        result = { ok: false, output: null, error: (e as Error).message }
      }

      // Update the trace step with the result.
      const traceStep = ctx.executionTrace?.find((s) => s.stepId === traceStepId)
      if (traceStep) {
        traceStep.status = result.ok ? 'done' : 'error'
        traceStep.durationMs = Date.now() - traceStart
        traceStep.result = result.ok
          ? (typeof result.output === 'string' ? result.output.slice(0, 200) : JSON.stringify(result.output).slice(0, 200))
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

      // Feed the observation back to the LLM (as a user message so the
      // assistant's next turn can build on it). On failure, include the
      // error + the required params so the LLM can self-correct.
      const obsText = result.ok
        ? JSON.stringify(result.output).slice(0, 12_000)
        : `Error: ${result.error}. Required params for ${tool}: ${JSON.stringify(def.inputSchema)}`
      messages.push({
        role: 'user',
        content: `Observation (${tool}): ${obsText}`,
      })
      onEvent({ type: 'status', status: 'thinking' })
      continue
    }

    // Neither final nor action — nudge.
    messages.push({
      role: 'user',
      content: 'Respond with either an action ({"thought":...,"action":{"tool":...,"input":...}}) or a final answer ({"thought":...,"final":{"answer":...}}).',
    })
  }

  // Budget exhausted without a final answer.
  if (!finalAnswer) {
    finalAnswer =
      `I worked on this for ${iterations} iterations${toolCalls ? ` and made ${toolCalls} tool calls` : ''}, but hit the iteration budget before producing a final answer. ` +
      (ctx.proposedWorkflow
        ? 'I did draft a workflow proposal — review it below.'
        : lastError
          ? `Last error: ${lastError}`
          : 'Try rephrasing the goal or increasing the iteration budget.')
    onEvent({
      type: 'final',
      answer: finalAnswer,
      proposedWorkflow: ctx.proposedWorkflow,
      findings: ctx.findings,
      workflowSavedToAgentId: ctx.workflowSavedToAgentId,
      credentialRequest: ctx.credentialRequest,
    })
  }

  return {
    answer: finalAnswer,
    proposedWorkflow: ctx.proposedWorkflow,
    findings: ctx.findings,
    workflowSavedToAgentId: ctx.workflowSavedToAgentId,
    credentialRequest: ctx.credentialRequest,
    iterations,
    toolCalls,
    tokensUsed,
  }
}

// ---------------- Response parsing ----------------

interface ParsedAgentResponse {
  thought?: string
  action?: ToolCall
  final?: { answer?: string }
}

function parseAgentResponse(raw: string): ParsedAgentResponse | null {
  if (!raw) return null
  // The LLM may wrap JSON in code fences despite instructions. Strip them.
  let s = raw.trim()
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
  // If there's prose before the JSON, try to find the first { ... } block.
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
