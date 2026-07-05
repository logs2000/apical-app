'use client'

import type { AgentEvent, WorkflowJSON } from '@/lib/types'
import type { ChatMessage, ExecutionStep, CredentialRequestInfo, CredentialRequestState, RunAnalysis, PlanItem, ClarificationRequestInfo } from './index'
import { stepKind } from './index'
import { traceStepLabel, sanitizeTraceInput } from '@/lib/platform/workflow-trace'
import {
  sandboxItemFromObservation,
  shouldPreviewObservation,
  type SandboxDisplayHint,
  type SandboxItem,
} from './sandbox'

/** The browser's IANA timezone + locale, so the agent can resolve "today",
 *  business hours, currency, etc. Safe to call anywhere (guards for SSR). */
export function readClientContext(): { timezone?: string; locale?: string } {
  try {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || undefined
    const locale =
      (typeof navigator !== 'undefined' && navigator.language) || undefined
    return { timezone, locale }
  } catch {
    return {}
  }
}

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

// Interruption markers persisted via runAnalysis.summary so a stopped/errored
// turn survives reloads and can be resumed. Kept as exact strings for
// backward-compat detection.
export const STOPPED_SUMMARY = 'Run was stopped before completion.'
export const INTERRUPTED_SUMMARY = 'Run was interrupted before it finished.'

/** Derive the resume marker from a (possibly reconstructed) run analysis. */
export function interruptionFromAnalysis(
  analysis?: RunAnalysis,
): ChatMessage['interrupted'] {
  if (!analysis || analysis.success !== false) return undefined
  if (analysis.summary === STOPPED_SUMMARY) return { reason: 'stopped' }
  if (analysis.summary === INTERRUPTED_SUMMARY) return { reason: 'error' }
  return undefined
}

export function mapPersistedMessages(
  rows: ReturnType<typeof normalizeMessagesResponse>,
): ChatMessage[] {
  return rows.map((m) => {
    const cards = interactiveCardsFromEvents(m.events)
    const runAnalysis = runAnalysisFromEvents(m.events)
    return {
      id: m.id,
      serverId: m.id,
      role: (m.role === 'user' ? 'user' : 'agent') as ChatMessage['role'],
      content: m.content,
      events: m.events,
      executionTrace: executionTraceFromEvents(m.events),
      runAnalysis,
      interrupted: interruptionFromAnalysis(runAnalysis),
      ...cards,
      createdAt: m.createdAt,
    }
  })
}

/** Restore interactive cards (credential boxes, checklist, clarification) from
 *  persisted events so they survive page reloads until resolved. */
export function interactiveCardsFromEvents(events?: AgentEvent[]): Partial<ChatMessage> {
  if (!events?.length) return {}
  const out: Partial<ChatMessage> = {}
  const creds: CredentialRequestState[] = []
  for (const e of events) {
    if (e.type === 'credential_request' && e.request) {
      creds.push({
        ...(e.request as CredentialRequestInfo),
        status: e.status ?? 'pending',
      })
    } else if (e.type === 'plan' && Array.isArray(e.items) && e.items.length > 0) {
      out.checklist = e.items as PlanItem[]
    } else if (e.type === 'clarification' && e.request) {
      out.clarificationRequest = e.request as ClarificationRequestInfo
      out.clarificationAnswered = !!e.answered
    }
  }
  if (creds.length > 0) out.credentialRequests = creds
  return out
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
        kind: 'thought',
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
        kind: 'tool',
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
  return trace.filter((s) => !s.id.startsWith('__')).map((s) => {
    if (stepKind(s) === 'thought') {
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
  credentialRequests?: CredentialRequestInfo[]
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
  // status events are surfaced as a transient live label via onStatusUpdate in
  // streamAgentThink — they never enter the trace.

  // Live, token-by-token chain-of-thought. Accumulate into a single running
  // reason step so the user watches the thought form in real time.
  if (event.type === 'thought_delta') {
    const chunk = String(event.text ?? '')
    if (!chunk) return
    const live = trace.find((s) => s.id === LIVE_THOUGHT_ID)
    if (live) {
      live.result = (live.result ?? '') + chunk
      live.action = live.result.slice(0, 120)
    } else {
      trace.push({
        id: LIVE_THOUGHT_ID,
        action: chunk.slice(0, 120),
        kind: 'thought',
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
    // Finalize the live thought step if we were streaming it; else push fresh.
    const live = trace.find((s) => s.id === LIVE_THOUGHT_ID)
    if (live) {
      live.id = `e${trace.length}`
      live.result = thought || live.result
      live.action = (thought || live.result || '').slice(0, 120)
      live.status = 'done'
      live.durationMs = Math.max(0, Date.now() - new Date(live.timestamp).getTime())
      return
    }
    trace.push({
      id: `e${trace.length + 1}`,
      action: thought.slice(0, 120),
      kind: 'thought',
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
      live.durationMs = Math.max(0, Date.now() - new Date(live.timestamp).getTime())
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
      kind: 'tool',
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

    const lastStep = [...trace].reverse().find((s) => s.tool === tool && s.status === 'running')
    if (lastStep) {
      lastStep.status = ok ? 'done' : 'error'
      lastStep.durationMs = Math.max(0, Date.now() - new Date(lastStep.timestamp).getTime())
      if (ok) {
        const outStr = typeof output === 'string' ? output : JSON.stringify(output)
        lastStep.result = outStr.slice(0, 4000)
      } else {
        lastStep.result = errMsg ?? 'failed'
      }
    }

    if (shouldPreviewObservation(tool, ok, display, output)) {
      const item = sandboxItemFromObservation(tool, ok, output, display, errMsg)
      if (lastStep) item.stepId = lastStep.id
      onSandboxItem?.(item)
    }
  }
}

export async function streamAgentThink(
  goal: string,
  opts: {
    context?: string
    history?: Array<{ role: 'user' | 'agent'; content: string }>
    /** An unfinished checklist from an earlier turn to resume instead of restart. */
    priorPlan?: PlanItem[]
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
    maxIterations?: number
    signal?: AbortSignal
    onTraceUpdate: (trace: ExecutionStep[]) => void
    onSandboxItem?: (item: SandboxItem) => void
    /** Fired with a friendly transient status label (from server status events). */
    onStatusUpdate?: (label: string) => void
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
  let credentialRequests: CredentialRequestInfo[] | undefined
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
      priorPlan: opts.priorPlan,
      agentId: opts.agentId,
      attachments: opts.attachments,
      script: opts.script,
      maxIterations: opts.maxIterations ?? 64,
      clientContext: readClientContext(),
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

    // Transient status → a single live label, never a trace step.
    if (event.type === 'status') {
      opts.onStatusUpdate?.(statusStepLabel(String(event.status ?? 'thinking')))
      return
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
      const creds = (event as { credentialRequests?: CredentialRequestInfo[] }).credentialRequests
      if (creds && creds.length > 0) credentialRequests = creds
      attachments = (event as { attachments?: ThinkStreamResult['attachments'] }).attachments
      const finalPlan = (event as { plan?: PlanItem[] }).plan
      if (finalPlan) checklist = finalPlan
      const finalClarify = (event as { clarification?: ClarificationRequestInfo }).clarification
      if (finalClarify) clarificationRequest = finalClarify
    }
  }, opts.signal)

  // Finalize any leftover live-thought sentinel so implementation ids never
  // persist or render.
  trace.forEach((s, i) => {
    if (s.id.startsWith('__')) {
      s.id = `e${i + 1}`
      if (s.status === 'running') s.status = 'done'
    }
  })

  return {
    finalAnswer,
    proposedWorkflow,
    workflowSavedToAgentId,
    createdAgentId,
    createdAgentName,
    credentialRequests,
    checklist,
    clarificationRequest,
    trace,
    attachments,
  }
}

// ─── Run helpers ─────────────────────────────────────────────────────────────

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
  // Interactive cards — persisted so they survive reloads until resolved.
  const cardEvents: AgentEvent[] = []
  for (const cr of msg.credentialRequests ?? []) {
    const { status, ...request } = cr
    cardEvents.push({ type: 'credential_request', request, status: status ?? 'pending' })
  }
  if (msg.checklist && msg.checklist.length > 0) {
    cardEvents.push({ type: 'plan', items: msg.checklist })
  }
  if (msg.clarificationRequest) {
    cardEvents.push({
      type: 'clarification',
      request: msg.clarificationRequest,
      answered: !!msg.clarificationAnswered,
    })
  }
  return [...traceEvents, ...analysisEvents, ...cardEvents]
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
