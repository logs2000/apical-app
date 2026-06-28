'use client'

import type { AgentEvent, WorkflowJSON } from '@/lib/types'
import type { ChatMessage, ExecutionStep, CredentialRequestInfo, RunAnalysis, ChatRun, ChatRunStatus, PlanItem, ClarificationRequestInfo } from './index'
import { traceStepLabel, sanitizeTraceInput } from '@/lib/platform/workflow-trace'
import {
  sandboxItemFromObservation,
  shouldPreviewObservation,
  type SandboxDisplayHint,
  type SandboxItem,
} from './sandbox'

// ─── SSE parsing ─────────────────────────────────────────────────────────────

export async function readSseStream(
  response: Response,
  onEvent: (event: Record<string, unknown>) => void,
  signal?: AbortSignal,
): Promise<void> {
  if (!response.ok || !response.body) {
    const err = await response.json().catch(() => ({}))
    throw new Error((err as { error?: string }).error || `HTTP ${response.status}`)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const jsonStr = line.slice(6).trim()
        if (!jsonStr || jsonStr === '[DONE]') continue
        let event: Record<string, unknown>
        try {
          event = JSON.parse(jsonStr) as Record<string, unknown>
        } catch {
          continue
        }
        try {
          await onEvent(event)
        } catch (e) {
          throw e instanceof Error ? e : new Error(String(e))
        }
      }
    }
  } finally {
    try {
      await reader.cancel()
    } catch {
      // ignore
    }
  }
}

function normalizeMessagesResponse(data: unknown): Array<{
  id: string
  role: string
  content: string
  createdAt: string
  events?: AgentEvent[]
}> {
  if (Array.isArray(data)) return data
  if (data && typeof data === 'object' && Array.isArray((data as { messages?: unknown }).messages)) {
    return (data as { messages: Array<{ id: string; role: string; content: string; createdAt: string; events?: AgentEvent[] }> }).messages
  }
  return []
}

export function mapPersistedMessages(
  rows: ReturnType<typeof normalizeMessagesResponse>,
): ChatMessage[] {
  return rows.map((m) => ({
    id: m.id,
    role: m.role === 'user' ? 'user' : 'agent',
    content: m.content,
    events: m.events,
    executionTrace: executionTraceFromEvents(m.events),
    runAnalysis: runAnalysisFromEvents(m.events),
    createdAt: m.createdAt,
  }))
}

/** Rebuild full execution trace from persisted events (reasoning + tool calls). */
export function executionTraceFromEvents(events?: AgentEvent[]): ExecutionStep[] | undefined {
  if (!events?.length) return undefined
  const steps: ExecutionStep[] = []
  for (const e of events) {
    if (e.type === 'reasoning') {
      steps.push({
        id: `e${steps.length + 1}`,
        action: e.content.slice(0, 120),
        tool: 'reason',
        status: 'done',
        timestamp: new Date().toISOString(),
        result: e.content,
      })
    } else if (e.type === 'tool_call') {
      const inputParams =
        'inputParams' in e && e.inputParams && typeof e.inputParams === 'object'
          ? (e.inputParams as Record<string, unknown>)
          : undefined
      steps.push({
        id: `e${steps.length + 1}`,
        action: typeof e.input === 'string' ? e.input : e.tool,
        tool: e.tool,
        toolInput: inputParams,
        status: e.status === 'calling' ? 'running' : e.status === 'error' ? 'error' : 'done',
        timestamp: new Date().toISOString(),
        result: e.result,
      })
    }
  }
  return steps.length > 0 ? steps : undefined
}

/** Extract persisted run analysis from events. */
export function runAnalysisFromEvents(events?: AgentEvent[]): RunAnalysis | undefined {
  const hit = events?.find((e): e is Extract<AgentEvent, { type: 'run_analysis' }> => e.type === 'run_analysis')
  if (!hit) return undefined
  return {
    success: hit.success,
    outcomeAchieved: hit.outcomeAchieved,
    summary: hit.summary,
    efficiencyNotes: hit.efficiencyNotes,
    workflowSuggestions: hit.workflowSuggestions,
  }
}

/** Full trace events to persist alongside an agent reply. */
export function traceEventsFromTrace(trace?: ExecutionStep[]): AgentEvent[] {
  if (!trace?.length) return []
  return trace.map((s) => {
    if (s.tool === 'reason') {
      return { type: 'reasoning' as const, content: (s.result || s.action).trim() }
    }
    return {
      type: 'tool_call' as const,
      tool: s.tool || 'tool',
      input: s.action,
      ...(s.toolInput && Object.keys(s.toolInput).length > 0
        ? { inputParams: s.toolInput }
        : {}),
      status:
        s.status === 'running'
          ? ('calling' as const)
          : s.status === 'error'
            ? ('error' as const)
            : ('success' as const),
      result: s.result,
    }
  }).filter((e) => (e.type === 'reasoning' ? e.content.length > 0 : true))
}

/** @deprecated Use traceEventsFromTrace — kept for imports that only need reasoning. */
export function thoughtEventsFromTrace(trace?: ExecutionStep[]): AgentEvent[] {
  return traceEventsFromTrace(trace?.filter((s) => s.tool === 'reason'))
}

/** Format a message for the LLM history — agent turns include prior reasoning. */
export function formatHistoryContent(msg: ChatMessage): string {
  const content = msg.content.trim()
  if (msg.role !== 'agent') return content

  const thoughts = (msg.executionTrace ?? executionTraceFromEvents(msg.events) ?? [])
    .filter((s) => s.tool === 'reason')
    .map((s) => (s.result || s.action).trim())
    .filter(Boolean)

  if (thoughts.length === 0) return content
  return `[Your prior reasoning from this turn:\n${thoughts.join('\n')}\n]\n\n${content}`
}

/** Build API history rows with reasoning included in agent content. */
export function chatHistoryForApi(
  messages: ChatMessage[],
  excludeLastUser = false,
): Array<{ role: 'user' | 'agent'; content: string }> {
  let rows = messages
    .filter((m) => m.role === 'user' || m.role === 'agent')
    .filter((m) => m.content.trim().length > 0)
  if (excludeLastUser && rows.length > 0 && rows[rows.length - 1].role === 'user') {
    rows = rows.slice(0, -1)
  }
  return rows.slice(-12).map((m) => ({
    role: m.role,
    content: formatHistoryContent(m),
  }))
}

export async function loadAgentMessages(agentId: string): Promise<ChatMessage[]> {
  const res = await fetch(`/api/agents/${agentId}/messages`)
  if (!res.ok) return []
  const data = await res.json()
  return mapPersistedMessages(normalizeMessagesResponse(data))
}

// ─── Autonomous ReAct loop ────────────────────────────────────────────────────

export interface ThinkStreamResult {
  finalAnswer: string
  proposedWorkflow?: WorkflowJSON
  workflowSavedToAgentId?: string
  createdAgentId?: string
  createdAgentName?: string
  credentialRequest?: CredentialRequestInfo
  checklist?: PlanItem[]
  clarificationRequest?: ClarificationRequestInfo
  trace: ExecutionStep[]
  attachments?: Array<{
    id: string
    name: string
    mimeType: string
    kind: string
    url: string
    sizeBytes?: number
  }>
}

const STATUS_STEP_ID = '__live_status__'
const LIVE_THOUGHT_ID = '__live_thought__'

function statusStepLabel(status: string): string {
  switch (status) {
    case 'started':
      return 'Connected — starting…'
    case 'preparing':
      return 'Getting ready…'
    case 'acting':
      return 'Running tool…'
    case 'observing':
      return 'Reading result…'
    default:
      return 'Thinking…'
  }
}

function applyThinkEvent(
  trace: ExecutionStep[],
  event: Record<string, unknown>,
  onSandboxItem?: (item: SandboxItem) => void,
): void {
  if (event.type === 'status') {
    const status = String(event.status ?? 'thinking')
    const step: ExecutionStep = {
      id: STATUS_STEP_ID,
      action: statusStepLabel(status),
      tool: 'reason',
      status: 'running',
      timestamp: new Date().toISOString(),
    }
    const idx = trace.findIndex((s) => s.id === STATUS_STEP_ID)
    if (idx >= 0) trace[idx] = step
    else trace.push(step)
    return
  }

  // Live, token-by-token chain-of-thought. Accumulate into a single running
  // reason step so the user watches the thought form in real time.
  if (event.type === 'thought_delta') {
    const chunk = String(event.text ?? '')
    if (!chunk) return
    const statusIdx = trace.findIndex((s) => s.id === STATUS_STEP_ID)
    if (statusIdx >= 0) trace.splice(statusIdx, 1)
    const live = trace.find((s) => s.id === LIVE_THOUGHT_ID)
    if (live) {
      live.result = (live.result ?? '') + chunk
      live.action = live.result.slice(0, 120)
    } else {
      trace.push({
        id: LIVE_THOUGHT_ID,
        action: chunk.slice(0, 120),
        tool: 'reason',
        status: 'running',
        timestamp: new Date().toISOString(),
        result: chunk,
      })
    }
    return
  }

  if (event.type === 'thought') {
    const thought = String(event.text ?? '')
    const statusIdx = trace.findIndex((s) => s.id === STATUS_STEP_ID)
    if (statusIdx >= 0) trace.splice(statusIdx, 1)
    // Finalize the live thought step if we were streaming it; else push fresh.
    const live = trace.find((s) => s.id === LIVE_THOUGHT_ID)
    if (live) {
      live.id = `e${trace.length}`
      live.result = thought || live.result
      live.action = (thought || live.result || '').slice(0, 120)
      live.status = 'done'
      return
    }
    trace.push({
      id: `e${trace.length + 1}`,
      action: thought.slice(0, 120),
      tool: 'reason',
      status: 'done',
      timestamp: new Date().toISOString(),
      result: thought,
    })
    return
  }

  // A live tool_call finalizes any in-progress live thought first.
  if (event.type === 'tool_call' || event.type === 'plan' || event.type === 'clarification') {
    const live = trace.find((s) => s.id === LIVE_THOUGHT_ID)
    if (live && live.status === 'running') {
      live.id = `e${trace.length}`
      live.status = 'done'
    }
    // plan + clarification are rendered as dedicated cards, not trace steps.
    if (event.type === 'plan' || event.type === 'clarification') return
  }

  if (event.type === 'tool_call') {
    const tool = String(event.tool ?? 'tool')
    const input = sanitizeTraceInput((event.input ?? {}) as Record<string, unknown>)
    trace.push({
      id: `e${trace.length + 1}`,
      action: traceStepLabel(tool, input),
      tool,
      toolInput: input,
      status: 'running',
      timestamp: new Date().toISOString(),
    })
    return
  }

  if (event.type === 'observation') {
    const tool = String(event.tool ?? '')
    const ok = Boolean(event.ok)
    const display = event.display as SandboxDisplayHint | undefined
    const output = event.output
    const errMsg = event.error != null ? String(event.error) : undefined

    if (shouldPreviewObservation(tool, ok, display, output)) {
      onSandboxItem?.(
        sandboxItemFromObservation(tool, ok, output, display, errMsg),
      )
    }

    const lastStep = [...trace].reverse().find((s) => s.tool === tool && s.status === 'running')
    if (!lastStep) return
    lastStep.status = ok ? 'done' : 'error'
    lastStep.durationMs = 200
    if (ok) {
      const outStr = typeof output === 'string' ? output : JSON.stringify(output)
      lastStep.result = outStr.slice(0, 4000)
    } else {
      lastStep.result = errMsg ?? 'failed'
    }
  }
}

export async function streamAgentThink(
  goal: string,
  opts: {
    context?: string
    history?: Array<{ role: 'user' | 'agent'; content: string }>
    agentId?: string | null
    attachments?: Array<{
      id: string
      name: string
      mimeType: string
      kind: string
      url: string
      localPath?: string | null
    }>
    script?: { language: 'javascript' | 'python' | 'shell'; code: string }
    allowCli?: boolean
    isDesktop?: boolean
    maxIterations?: number
    signal?: AbortSignal
    onTraceUpdate: (trace: ExecutionStep[]) => void
    onSandboxItem?: (item: SandboxItem) => void
    /** Fired once the server accepts the stream (before the first model event). */
    onStreamOpen?: () => void
    /** Fired with each chunk of the final answer as it streams in. */
    onAnswerDelta?: (fullAnswerSoFar: string) => void
    /** Fired whenever the agent's live checklist changes. */
    onPlanUpdate?: (items: PlanItem[]) => void
  },
): Promise<ThinkStreamResult> {
  const trace: ExecutionStep[] = []
  let finalAnswer = ''
  let streamingAnswer = ''
  // The agent may stream an answer that then gets blocked by a workflow-save
  // nudge + re-streamed on a later turn. `answerActive` lets us reset the
  // streamed answer when a fresh answer block begins (after any other event).
  let answerActive = false
  let proposedWorkflow: WorkflowJSON | undefined
  let workflowSavedToAgentId: string | undefined
  let createdAgentId: string | undefined
  let createdAgentName: string | undefined
  let credentialRequest: CredentialRequestInfo | undefined
  let checklist: PlanItem[] | undefined
  let clarificationRequest: ClarificationRequestInfo | undefined
  let attachments: ThinkStreamResult['attachments']

  const res = await fetch('/api/agent/think', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: opts.signal,
    body: JSON.stringify({
      goal,
      context: opts.context,
      history: opts.history,
      agentId: opts.agentId,
      attachments: opts.attachments,
      script: opts.script,
      allowCli: opts.allowCli,
      isDesktop: opts.isDesktop,
      maxIterations: opts.maxIterations ?? 64,
    }),
  })

  if (!res.ok || !res.body) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as { error?: string }).error || `HTTP ${res.status}`)
  }
  opts.onStreamOpen?.()

  await readSseStream(res, (event) => {
    if (event.type === 'error') {
      throw new Error(String(event.message ?? 'Agent loop failed'))
    }

    // Stream the final answer token-by-token into the message body.
    if (event.type === 'answer_delta') {
      if (!answerActive) {
        // New answer block (e.g. after a blocked-final nudge re-stream).
        streamingAnswer = ''
        answerActive = true
      }
      streamingAnswer += String((event as { text?: string }).text ?? '')
      opts.onAnswerDelta?.(streamingAnswer)
      return
    }
    // Any non-answer event closes the current answer block.
    answerActive = false

    // Live checklist updates.
    if (event.type === 'plan') {
      const items = ((event as { items?: PlanItem[] }).items ?? []) as PlanItem[]
      checklist = items
      opts.onPlanUpdate?.(items)
      applyThinkEvent(trace, event, opts.onSandboxItem)
      opts.onTraceUpdate([...trace])
      return
    }

    if (event.type === 'clarification') {
      clarificationRequest = (event as { question?: ClarificationRequestInfo }).question
      applyThinkEvent(trace, event, opts.onSandboxItem)
      opts.onTraceUpdate([...trace])
      return
    }

    applyThinkEvent(trace, event, opts.onSandboxItem)
    if (
      event.type === 'status' ||
      event.type === 'thought' ||
      event.type === 'thought_delta' ||
      event.type === 'tool_call' ||
      event.type === 'observation' ||
      trace.length > 0
    ) {
      opts.onTraceUpdate([...trace])
    }
    if (event.type === 'final') {
      finalAnswer = String((event as { answer?: string }).answer ?? '')
      proposedWorkflow = (event as { proposedWorkflow?: WorkflowJSON }).proposedWorkflow
      workflowSavedToAgentId = (event as { workflowSavedToAgentId?: string }).workflowSavedToAgentId
      createdAgentId = (event as { createdAgentId?: string }).createdAgentId
      createdAgentName = (event as { createdAgentName?: string }).createdAgentName
      credentialRequest = (event as { credentialRequest?: CredentialRequestInfo }).credentialRequest
      attachments = (event as { attachments?: ThinkStreamResult['attachments'] }).attachments
      const finalPlan = (event as { plan?: PlanItem[] }).plan
      if (finalPlan) checklist = finalPlan
      const finalClarify = (event as { clarification?: ClarificationRequestInfo }).clarification
      if (finalClarify) clarificationRequest = finalClarify
    }
  }, opts.signal)

  return {
    finalAnswer,
    proposedWorkflow,
    workflowSavedToAgentId,
    createdAgentId,
    createdAgentName,
    credentialRequest,
    checklist,
    clarificationRequest,
    trace,
    attachments,
  }
}

// ─── Run timeline helpers ───────────────────────────────────────────────────

export function inferRunStatus(
  steps: ExecutionStep[],
  opts?: { live?: boolean; stopped?: boolean; analyzing?: boolean },
): ChatRunStatus {
  if (opts?.live) return 'running'
  if (opts?.stopped) return 'stopped'
  if (opts?.analyzing) return 'analyzing'
  if (steps.some((s) => s.status === 'error')) return 'failed'
  return 'completed'
}

const META_AUTOMATION_TOOLS = new Set(['workflow_freeze', 'schedule_agent', 'agent_create'])

/** True when workflow save badge should show — not when automation meta-tools failed. */
export function automationSaveSucceeded(
  trace: ExecutionStep[],
  savedId?: string | null,
): boolean {
  if (!savedId) return false
  return !trace.some(
    (s) => s.status === 'error' && META_AUTOMATION_TOOLS.has(s.tool ?? ''),
  )
}

export function buildChatRun(
  id: string,
  steps: ExecutionStep[],
  opts?: {
    startedAt?: string
    finishedAt?: string
    goal?: string
    analysis?: RunAnalysis
    live?: boolean
    stopped?: boolean
    analyzing?: boolean
  },
): ChatRun {
  return {
    id,
    status: inferRunStatus(steps, opts),
    startedAt: opts?.startedAt ?? new Date().toISOString(),
    finishedAt: opts?.live ? undefined : opts?.finishedAt,
    steps,
    goal: opts?.goal,
    analysis: opts?.analysis,
    analyzing: opts?.analyzing,
  }
}

export function eventsForPersistedMessage(msg: ChatMessage): AgentEvent[] {
  const traceEvents = traceEventsFromTrace(msg.executionTrace)
  const analysisEvents: AgentEvent[] = msg.runAnalysis
    ? [{
        type: 'run_analysis',
        success: msg.runAnalysis.success,
        outcomeAchieved: msg.runAnalysis.outcomeAchieved,
        summary: msg.runAnalysis.summary,
        efficiencyNotes: msg.runAnalysis.efficiencyNotes,
        workflowSuggestions: msg.runAnalysis.workflowSuggestions,
      }]
    : []
  return [...traceEvents, ...analysisEvents]
}

export async function analyzeRun(input: {
  goal: string
  trace: ExecutionStep[]
  finalAnswer: string
  agentId?: string | null
}): Promise<RunAnalysis> {
  const res = await fetch('/api/agent/analyze-run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as { error?: string }).error || `HTTP ${res.status}`)
  }
  return res.json() as Promise<RunAnalysis>
}
