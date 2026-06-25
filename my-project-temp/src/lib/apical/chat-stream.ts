'use client'

import type { AgentEvent, WorkflowJSON } from '@/lib/types'
import type { ChatMessage, ExecutionStep, CredentialRequestInfo } from './index'
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
    createdAt: m.createdAt,
  }))
}

/** Rebuild reason steps from persisted reasoning events (for UI + history context). */
export function executionTraceFromEvents(events?: AgentEvent[]): ExecutionStep[] | undefined {
  if (!events?.length) return undefined
  const thoughts = events.filter(
    (e): e is Extract<AgentEvent, { type: 'reasoning' }> => e.type === 'reasoning',
  )
  if (thoughts.length === 0) return undefined
  return thoughts.map((e, i) => ({
    id: `t${i + 1}`,
    action: e.content.slice(0, 120),
    tool: 'reason',
    status: 'done' as const,
    timestamp: new Date().toISOString(),
    result: e.content,
  }))
}

/** Reasoning events to persist alongside an agent reply. */
export function thoughtEventsFromTrace(trace?: ExecutionStep[]): AgentEvent[] {
  return (trace ?? [])
    .filter((s) => s.tool === 'reason')
    .map((s) => ({ type: 'reasoning' as const, content: s.result || s.action }))
    .filter((e) => e.content.trim().length > 0)
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

// ─── Orchestrator thread (the persistent general chat) ───────────────────────

/** Load the orchestrator's running history. Rich fields (trace, proposals,
 *  suggestions) are preserved since they're stored verbatim. */
export async function loadOrchestratorMessages(): Promise<ChatMessage[]> {
  const res = await fetch('/api/orchestrator/messages')
  if (!res.ok) return []
  const data = await res.json()
  if (!Array.isArray(data)) return []
  return (data as ChatMessage[]).map((m) => ({
    ...m,
    role: m.role === 'user' ? 'user' : 'agent',
    executionTrace: m.executionTrace ?? executionTraceFromEvents(m.events),
  }))
}

/** Append a message to the orchestrator's persistent thread. Non-fatal on error. */
export async function persistOrchestratorMessage(msg: ChatMessage): Promise<void> {
  try {
    await fetch('/api/orchestrator/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(msg),
    })
  } catch {
    // non-fatal — the message is already in local state
  }
}

// ─── Apical assistant (plan / orchestrator) ─────────────────────────────────

export interface AgentChatResponse {
  reply: string
  trace?: { label: string; detail?: string }[]
  intent?: string
  workflowProposal?: ChatMessage['workflowProposal']
  clarification?: ChatMessage['clarification']
  researchPlan?: ChatMessage['researchPlan']
  apiDiscovery?: ChatMessage['apiDiscovery']
  research?: ChatMessage['research']
  suggestions?: ChatMessage['suggestions']
  /** Routing: the assistant decided the user means a different existing agent. */
  switchToAgentId?: string
  /** Routing: the assistant is editing this specific agent. */
  editingAgentId?: string
}

export async function fetchAgentChat(input: {
  message: string
  history?: Array<{ role: 'user' | 'agent'; content: string }>
  activeAgentId?: string | null
  mentionedAgentIds?: string[]
  model?: string
}): Promise<AgentChatResponse> {
  const res = await fetch('/api/agent/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as { error?: string }).error || `HTTP ${res.status}`)
  }
  return res.json() as Promise<AgentChatResponse>
}

export function agentChatResponseToMessage(data: AgentChatResponse): ChatMessage {
  return {
    id: Math.random().toString(36).slice(2),
    role: 'agent',
    content: data.reply,
    trace: data.trace,
    workflowProposal: data.workflowProposal,
    clarification: data.clarification,
    researchPlan: data.researchPlan,
    apiDiscovery: data.apiDiscovery,
    research: data.research,
    suggestions: data.suggestions,
    createdAt: new Date().toISOString(),
  }
}

export interface PlanChatStreamResult {
  content: string
  thinking: string
}

/** Stream plan-mode chat with Claude extended thinking + token-by-token reply. */
export async function streamPlanChat(
  input: {
    message: string
    history?: Array<{ role: 'user' | 'agent'; content: string }>
    activeAgentId?: string | null
    mentionedAgentIds?: string[]
    model?: string
  },
  onUpdate: (partial: PlanChatStreamResult) => void,
): Promise<PlanChatStreamResult> {
  const res = await fetch('/api/agent/chat/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })

  let content = ''
  let thinking = ''

  const push = () => onUpdate({ content, thinking })

  await readSseStream(res, (event) => {
    if (event.type === 'thinking' && typeof event.content === 'string') {
      thinking += event.content
      push()
      return
    }
    if (event.type === 'token' && typeof event.content === 'string') {
      content += event.content
      push()
      return
    }
    if (event.type === 'error') {
      throw new Error(String(event.message ?? 'Stream failed'))
    }
  })

  return { content, thinking }
}

// ─── Autonomous ReAct loop (do-it-once) ─────────────────────────────────────

export interface ThinkStreamResult {
  finalAnswer: string
  proposedWorkflow?: WorkflowJSON
  workflowSavedToAgentId?: string
  credentialRequest?: CredentialRequestInfo
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

function applyThinkEvent(
  trace: ExecutionStep[],
  event: Record<string, unknown>,
  onSandboxItem?: (item: SandboxItem) => void,
): void {
  if (event.type === 'thought') {
    const thought = String(event.text ?? '')
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

  if (event.type === 'tool_call') {
    const tool = String(event.tool ?? 'tool')
    const input = (event.input ?? {}) as Record<string, unknown>
    const inputSummary = Object.keys(input).slice(0, 3).join(', ')
    trace.push({
      id: `e${trace.length + 1}`,
      action: inputSummary ? `${tool}(${inputSummary})` : tool,
      tool,
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
      lastStep.result = outStr.slice(0, 200)
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
  },
): Promise<ThinkStreamResult> {
  const trace: ExecutionStep[] = []
  let finalAnswer = ''
  let proposedWorkflow: WorkflowJSON | undefined
  let workflowSavedToAgentId: string | undefined
  let credentialRequest: CredentialRequestInfo | undefined
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
      maxIterations: opts.maxIterations ?? 12,
    }),
  })

  await readSseStream(res, (event) => {
    if (event.type === 'error') {
      throw new Error(String(event.message ?? 'Agent loop failed'))
    }
    applyThinkEvent(trace, event, opts.onSandboxItem)
    if (trace.length > 0) opts.onTraceUpdate([...trace])
    if (event.type === 'final') {
      finalAnswer = String((event as { answer?: string }).answer ?? '')
      proposedWorkflow = (event as { proposedWorkflow?: WorkflowJSON }).proposedWorkflow
      workflowSavedToAgentId = (event as { workflowSavedToAgentId?: string }).workflowSavedToAgentId
      credentialRequest = (event as { credentialRequest?: CredentialRequestInfo }).credentialRequest
      attachments = (event as { attachments?: ThinkStreamResult['attachments'] }).attachments
    }
  }, opts.signal)

  return { finalAnswer, proposedWorkflow, workflowSavedToAgentId, credentialRequest, trace, attachments }
}

// ─── Per-agent glass-box chat ────────────────────────────────────────────────

export interface PerAgentChatResult {
  content: string
  events: AgentEvent[]
}

export async function streamPerAgentChat(
  agentId: string,
  message: string,
  history: Array<{ role: 'user' | 'agent' | 'assistant'; content: string }>,
  onUpdate: (partial: PerAgentChatResult) => void,
): Promise<PerAgentChatResult> {
  const res = await fetch(`/api/agents/${agentId}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      history: history.slice(-6).map((m) => ({
        role: m.role === 'user' ? 'user' : 'agent',
        content: m.content,
      })),
    }),
  })

  let content = ''
  const events: AgentEvent[] = []

  const pushUpdate = () => onUpdate({ content, events: [...events] })

  await readSseStream(res, (raw) => {
    const event = raw as AgentEvent & { id?: string }

    if (event.type === 'token') {
      content += event.content
      pushUpdate()
      return
    }

    if (event.type === 'task_list') {
      const idx = events.findIndex((e) => e.type === 'task_list')
      if (idx >= 0) events[idx] = event
      else events.push(event)
      pushUpdate()
      return
    }

    if (event.type === 'reasoning' || event.type === 'status' || event.type === 'action_complete') {
      events.push(event)
      pushUpdate()
      return
    }

    if (event.type === 'error') {
      throw new Error(event.message)
    }
  })

  return { content, events: events.filter((e) => e.type !== 'token') }
}
