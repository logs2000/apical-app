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

import { chat, chatStream, recordUsage, checkAllowance } from '@/lib/platform/llm-gateway'
import { AGENT_TOOLS, getAgentTool, toolCatalogForLLM, type ToolCall, type ToolContext, type ToolResult } from './agent-tools'
import type { WorkflowJSON } from '@/lib/types'

// ---------------- Types ----------------

export type AgentEvent =
  | { type: 'status'; status: 'thinking' | 'acting' | 'observing' | 'done' }
  | { type: 'thought'; text: string }
  | { type: 'tool_call'; tool: string; input: Record<string, unknown> }
  | { type: 'observation'; tool: string; ok: boolean; output: unknown; display?: ToolResult['display'] }
  | { type: 'final'; answer: string; proposedWorkflow?: WorkflowJSON; findings?: ToolContext['findings'] }
  | { type: 'error'; message: string }

export interface AgentRunOptions {
  userId: string
  goal: string
  /** Extra context (the conversation history, the user's profile, etc.). */
  context?: string
  /** The model id to use (default 'apical:default'). */
  modelId?: string
  /** Max reasoning iterations (default 12). */
  maxIterations?: number
  /** Whether CLI access is allowed (routes through the desktop bridge). */
  allowCli?: boolean
  /** A friendly name for the task (for usage logs). */
  source?: string
}

export interface AgentRunResult {
  answer: string
  proposedWorkflow?: WorkflowJSON
  findings?: ToolContext['findings']
  iterations: number
  toolCalls: number
  tokensUsed: number
}

// ---------------- The loop ----------------

const SYSTEM_PROMPT = `You are Apical, an autonomous AI agent that accomplishes real work for the user. You operate in a LEARN-FIRST CONTINUOUS-IMPROVEMENT loop.

YOUR OPERATING MODEL (the user's exact specification):

  1. USER NEEDS SOMETHING. You receive a goal.
  2. TRY TO DO IT. You attempt the task directly using your tools. You don't propose an abstract workflow upfront — you DO the work, step by step, observing what happens.
  3. REALIZE YOU NEED A TOOL. When you hit a gap (no API connected, no MCP server for this service, missing credential), you CONFIGURE the tool mid-flight:
     - Discover the service: web_search for "<service> API" or "<service> MCP server" or "<service> OpenAPI spec".
     - Install it: call tool_configure with kind="openapi" + specUrl, OR kind="mcp" + transport/url.
     - Get credentials: if the service needs auth, tell the user what credential to add to the vault (call credential_list first to see what's already there). The user adds it; you reference it by id via http_request's credentialId parameter. NEVER ask the user to paste a key into the chat — secrets live in the vault, referenced by id.
     - REPEAT. Keep configuring + trying until you can actually accomplish the task.
  4. LOOK AT HOW YOU ACCOMPLISHED IT. Once the task works end-to-end, your execution trace (every tool call, every reason step, every gate) IS the workflow. Call workflow_freeze to convert that trace into a deterministic, reusable automation. The frozen workflow references credentials by id only — secrets stay in the vault.
  5. MONITOR + IMPROVE. After the workflow is frozen + scheduled, it runs on its own. Call workflow_monitor periodically to see recent runs + failures. When you spot failures, call workflow_improve with a description of the fix (and optionally newSteps). The workflow gets better over time. This is an ONGOING process — not a one-and-done.

THE KEY INSIGHT: do the work first, learn the real process (folder structures, API shapes, edge cases, failure modes), THEN freeze what you learned into a workflow. A workflow proposed from assumptions is fragile; a workflow frozen from observed reality is robust. And the freeze isn't the end — you keep monitoring + improving forever.

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
- Always include a "thought" with your reasoning before every action.
- Pick ONE tool per turn. Wait for the observation before deciding the next step.
- For SIMPLE questions you already know the answer to (e.g. "what is 2+2?"), skip tools and emit a "final" immediately.
- For COMPLEX tasks, START BY TRYING. Call credential_list + integration_list + mcp_list_servers to see what you have. Then attempt the task. If you hit a gap, configure the missing tool (tool_configure) and try again. Repeat until it works.
- NEVER propose a workflow from assumptions. Always do the task by hand first, then call workflow_freeze to convert your real execution trace into the workflow.
- NEVER ask the user to paste API keys into the chat. If auth is needed, tell them to add the credential to the vault (via the Vault tab), then reference it by credentialId.
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
    context,
    modelId = 'apical:default',
    maxIterations = 16,
    allowCli = false,
    source = 'agent',
  } = opts

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
    allowCli,
    maxFetchBytes: 50_000,
    findings: [],
    executionTrace: [],
    usedCredentialIds: [],
  }

  const toolCatalog = toolCatalogForLLM(allowCli)
  const systemPrompt = SYSTEM_PROMPT.replace('{{TOOLS}}', toolCatalog)

  // The conversation history (system + user goal + each thought/action/observation).
  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: `Goal: ${goal}${context ? `\n\nAdditional context:\n${context}` : ''}\n\nBegin. Respond with JSON only.`,
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
        content: 'NOTE: You have 3 iterations left. If you have enough information, call workflow_propose now (if a workflow is appropriate) and then emit your final answer. If the task was a pure question (no workflow needed), just emit your final answer.',
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
      finalAnswer = parsed.final.answer || parsed.thought || 'Done.'
      onEvent({ type: 'status', status: 'done' })
      onEvent({
        type: 'final',
        answer: finalAnswer,
        proposedWorkflow: ctx.proposedWorkflow,
        findings: ctx.findings,
      })
      return {
        answer: finalAnswer,
        proposedWorkflow: ctx.proposedWorkflow,
        findings: ctx.findings,
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
    })
  }

  return {
    answer: finalAnswer,
    proposedWorkflow: ctx.proposedWorkflow,
    findings: ctx.findings,
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
