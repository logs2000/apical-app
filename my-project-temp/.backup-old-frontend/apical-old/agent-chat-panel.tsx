'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'
import { ApicalMark } from './logo'
import { agentInitials, agentAvatarLightness, relativeTime } from '@/lib/apical'
import { RuntimeBadge } from './runtime-badge'
import type { AgentEvent, Workflow } from '@/lib/types'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Loader2, Brain, Wrench, CheckCircle2, XCircle, Search,
  FileText, Terminal, Globe, Cpu, Check, Clock, AlertTriangle,
  ListChecks, ChevronRight,
} from 'lucide-react'

// ---------------- Event renderers ----------------

function ToolCallEvent({ ev }: { ev: Extract<AgentEvent, { type: 'tool_call' }> }) {
  const isCalling = ev.status === 'calling'
  const isError = ev.status === 'error'
  const Icon = ev.tool.startsWith('files') ? FileText
    : ev.tool.startsWith('cli') ? Terminal
    : ev.tool.startsWith('http') ? Globe
    : ev.tool.startsWith('ocr') || ev.tool.startsWith('scanner') ? Search
    : Wrench
  return (
    <motion.div
      initial={{ opacity: 0, x: -4 }}
      animate={{ opacity: 1, x: 0 }}
      className={cn(
        'flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[11px]',
        isError ? 'border-destructive/30 bg-destructive/5' : isCalling ? 'border-primary/30 bg-primary/5' : 'border-emerald-500/20 bg-emerald-500/5',
      )}
    >
      <Icon className={cn('h-3 w-3 shrink-0', isError ? 'text-destructive' : isCalling ? 'text-primary' : 'text-emerald-500')} />
      {isCalling && <Loader2 className="h-2.5 w-2.5 animate-spin text-primary" />}
      {!isCalling && !isError && <CheckCircle2 className="h-2.5 w-2.5 text-emerald-500" />}
      {isError && <XCircle className="h-2.5 w-2.5 text-destructive" />}
      <code className="font-mono text-[10px] text-muted-foreground">{ev.tool}</code>
      <span className="text-muted-foreground">{ev.input}</span>
      {ev.result && <span className="text-emerald-500">{ev.result}</span>}
    </motion.div>
  )
}

function ReasoningEvent({ ev }: { ev: Extract<AgentEvent, { type: 'reasoning' }> }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex items-start gap-1.5 rounded-lg bg-muted/30 px-2.5 py-1.5"
    >
      <Brain className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground/60" />
      <span className="text-[11px] italic text-muted-foreground/70">{ev.content}</span>
    </motion.div>
  )
}

function TaskListEvent({ ev }: { ev: Extract<AgentEvent, { type: 'task_list' }> }) {
  const doneCount = ev.tasks.filter((t) => t.done).length
  return (
    <motion.div
      initial={{ opacity: 0, y: 2 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-lg border border-border/60 bg-card/60 p-2"
    >
      <div className="mb-1 flex items-center gap-1.5">
        <ListChecks className="h-3 w-3 text-muted-foreground" />
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Plan</span>
        <span className="ml-auto text-[10px] font-mono text-muted-foreground">{doneCount}/{ev.tasks.length}</span>
      </div>
      <div className="space-y-0.5">
        {ev.tasks.map((t) => (
          <div key={t.id} className="flex items-center gap-1.5 text-[11px]">
            <span className={cn(
              'flex h-3 w-3 shrink-0 items-center justify-center rounded border',
              t.done ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-muted-foreground/30',
            )}>
              {t.done && <Check className="h-2 w-2" />}
            </span>
            <span className={cn(t.done && 'text-muted-foreground line-through')}>{t.label}</span>
          </div>
        ))}
      </div>
    </motion.div>
  )
}

function StatusEvent({ ev }: { ev: Extract<AgentEvent, { type: 'status' }> }) {
  const labels: Record<string, { label: string; color: string }> = {
    thinking: { label: 'Thinking', color: 'text-primary' },
    acting: { label: 'Acting', color: 'text-foreground' },
    observing: { label: 'Observing', color: 'text-muted-foreground' },
    waiting_for_input: { label: 'Waiting for you', color: 'text-gate-foreground' },
    done: { label: 'Done', color: 'text-emerald-500' },
  }
  const meta = labels[ev.status] ?? labels.thinking
  return (
    <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
      {ev.status !== 'done' && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
      {ev.status === 'done' && <CheckCircle2 className="h-2.5 w-2.5 text-emerald-500" />}
      <span className={meta.color}>{meta.label}</span>
    </div>
  )
}

function ActionCompleteEvent({ ev }: { ev: Extract<AgentEvent, { type: 'action_complete' }> }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-2.5 py-1.5"
    >
      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
      <span className="text-[11px] text-foreground/80">{ev.summary}</span>
      {ev.itemsProcessed !== undefined && (
        <span className="ml-auto text-[10px] text-muted-foreground">{ev.itemsProcessed} items</span>
      )}
    </motion.div>
  )
}

// ---------------- Agent message bubble ----------------

function AgentMessageBubble({ role, content, events, agentName }: {
  role: 'user' | 'agent'
  content: string
  events?: AgentEvent[]
  agentName: string
}) {
  if (role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-3 py-2 text-sm text-primary-foreground">
          {content}
        </div>
      </div>
    )
  }
  return (
    <div className="flex gap-2.5">
      <div className="mt-0.5 shrink-0">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg border border-primary/30 bg-primary/10 text-[10px] font-semibold text-primary"
          style={{ backgroundColor: `oklch(${agentAvatarLightness(agentName)} 0.06 155)` }}>
          {agentInitials(agentName)}
        </div>
      </div>
      <div className="min-w-0 flex-1 space-y-1.5">
        {/* Glass-box events (rendered above the text response, deduped) */}
        {events && events.length > 0 && (
          <div className="space-y-1">
            {dedupeEvents(events).map(({ ev, key }) => {
              if (ev.type === 'tool_call') return <ToolCallEvent key={key} ev={ev} />
              if (ev.type === 'reasoning') return <ReasoningEvent key={key} ev={ev} />
              if (ev.type === 'task_list') return <TaskListEvent key={key} ev={ev} />
              if (ev.type === 'status') return <StatusEvent key={key} ev={ev} />
              if (ev.type === 'action_complete') return <ActionCompleteEvent key={key} ev={ev} />
              if (ev.type === 'error') return <div key={key} className="text-[11px] text-destructive">{ev.message}</div>
              return null
            })}
          </div>
        )}
        {/* The text response */}
        {content && (
          <div className="text-sm leading-relaxed text-foreground/90 whitespace-pre-wrap">{content}</div>
        )}
      </div>
    </div>
  )
}

// ---------------- Live streaming bubble (while the agent is working) ----------------

/** Reduce the raw event stream into a deduplicated list for display.
 *  - Drops 'token' events (they accumulate into liveText separately).
 *  - Drops consecutive 'status' events that just repeat the latest status.
 *  - Drops 'task_list' events whose tasks are identical to the previous task_list
 *    (prevents the "multiple plan windows" effect when the same plan is re-emitted).
 *  - Returns events with a stable `key` for AnimatePresence. */
function dedupeEvents(raw: AgentEvent[]): Array<{ ev: AgentEvent; key: string }> {
  const out: Array<{ ev: AgentEvent; key: string }> = []
  let lastStatus: string | null = null
  let lastTaskSig: string | null = null
  let kc = 0
  for (const ev of raw) {
    if (ev.type === 'token') continue
    if (ev.type === 'status') {
      if (ev.status === lastStatus) continue
      lastStatus = ev.status
    }
    if (ev.type === 'task_list') {
      const sig = JSON.stringify(ev.tasks)
      if (sig === lastTaskSig) continue
      lastTaskSig = sig
    }
    kc += 1
    const key = `${ev.type}-${kc}`
    out.push({ ev, key })
  }
  return out
}

function StreamingBubble({ agentName, events, liveText }: {
  agentName: string
  events: AgentEvent[]
  liveText: string
}) {
  const visible = dedupeEvents(events)
  return (
    <div className="flex gap-2.5">
      <div className="mt-0.5 shrink-0">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg border border-primary/30 bg-primary/10 text-[10px] font-semibold text-primary animate-pulse-soft"
          style={{ backgroundColor: `oklch(${agentAvatarLightness(agentName)} 0.06 155)` }}>
          {agentInitials(agentName)}
        </div>
      </div>
      <div className="min-w-0 flex-1 space-y-1.5">
        {/* Live events as they stream in (deduped, stable keys) */}
        <AnimatePresence>
          {visible.map(({ ev, key }) => {
            if (ev.type === 'tool_call') return <ToolCallEvent key={key} ev={ev} />
            if (ev.type === 'reasoning') return <ReasoningEvent key={key} ev={ev} />
            if (ev.type === 'task_list') return <TaskListEvent key={key} ev={ev} />
            if (ev.type === 'status') return <StatusEvent key={key} ev={ev} />
            if (ev.type === 'action_complete') return <ActionCompleteEvent key={key} ev={ev} />
            if (ev.type === 'error') return <div key={key} className="text-[11px] text-destructive">{ev.message}</div>
            return null
          })}
        </AnimatePresence>
        {/* Live text (growing as tokens stream) */}
        {liveText && (
          <div className="text-sm leading-relaxed text-foreground/90 whitespace-pre-wrap">
            {liveText}
            <span className="ml-0.5 inline-block h-3.5 w-1 animate-pulse bg-primary align-text-bottom" />
          </div>
        )}
        {/* Thinking indicator if no text yet and no visible events */}
        {!liveText && visible.length === 0 && (
          <div className="flex items-center gap-2">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
            <span className="text-xs text-muted-foreground">Thinking…</span>
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------- The full agent chat panel ----------------

interface ChatMessage {
  id: string
  role: 'user' | 'agent'
  content: string
  events?: AgentEvent[]
}

export interface AgentChatPanelProps {
  agent: Workflow
  /** Persisted messages to hydrate the panel with (from /api/agents/[id]/messages). */
  persistedMessages?: import('@/lib/types').AgentMessage[]
  /** Called when a message should be persisted (after it's added to the panel). */
  onMessagePersist?: (msg: { role: 'user' | 'agent'; content: string; events?: AgentEvent[] }) => void
  /** Hide the agent context bar (when the parent already shows it). */
  hideContextBar?: boolean
}

export function AgentChatPanel({ agent, persistedMessages, onMessagePersist, hideContextBar }: AgentChatPanelProps) {
  const [messages, setMessages] = React.useState<ChatMessage[]>([])
  const [input, setInput] = React.useState('')
  const [streaming, setStreaming] = React.useState(false)
  const [liveEvents, setLiveEvents] = React.useState<AgentEvent[]>([])
  const [liveText, setLiveText] = React.useState('')
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const dept = agent.department || 'General'

  // Hydrate from persisted messages when the agent changes or the persisted list loads.
  const hydratedFor = React.useRef<string | null>(null)
  React.useEffect(() => {
    if (persistedMessages && hydratedFor.current !== agent.id) {
      hydratedFor.current = agent.id
      setMessages(persistedMessages.map((m) => ({
        id: m.id,
        role: m.role === 'user' ? 'user' : 'agent',
        content: m.content,
        events: m.events,
      })))
    }
  }, [persistedMessages, agent.id])

  React.useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages, liveText, liveEvents])

  const send = async () => {
    const trimmed = input.trim()
    if (!trimmed || streaming) return
    const userMsg: ChatMessage = { id: Math.random().toString(36).slice(2), role: 'user', content: trimmed }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setStreaming(true)
    setLiveEvents([])
    setLiveText('')

    // Persist the user message.
    onMessagePersist?.({ role: 'user', content: trimmed })

    try {
      const resp = await fetch(`/api/agents/${agent.id}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: trimmed,
          history: messages.map(m => ({ role: m.role, content: m.content })),
        }),
      })

      if (!resp.ok) throw new Error('Chat failed')
      const reader = resp.body?.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      const events: AgentEvent[] = []
      let accumulatedText = ''

      while (reader) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const data = line.slice(6).trim()
          if (data === '[DONE]') continue
          try {
            const ev = JSON.parse(data) as AgentEvent
            if (ev.type === 'token') {
              accumulatedText += ev.content
              setLiveText(accumulatedText)
            } else {
              events.push(ev)
              setLiveEvents([...events])
            }
          } catch { /* skip malformed */ }
        }
      }

      // Finalize: add the agent message with all events + text.
      const finalContent = accumulatedText
      setMessages(prev => [...prev, {
        id: Math.random().toString(36).slice(2),
        role: 'agent',
        content: finalContent,
        events,
      }])
      // Persist the agent message (without token events).
      onMessagePersist?.({ role: 'agent', content: finalContent, events })
      setLiveText('')
      setLiveEvents([])
    } catch (err) {
      const errContent = `Sorry, I hit a snag: ${(err as Error).message}`
      setMessages(prev => [...prev, {
        id: Math.random().toString(36).slice(2),
        role: 'agent',
        content: errContent,
      }])
      onMessagePersist?.({ role: 'agent', content: errContent })
    } finally {
      setStreaming(false)
    }
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Agent context bar */}
      {!hideContextBar && (
      <div className="flex items-center gap-2 border-b border-border/60 bg-muted/20 px-3 py-2">
        <div className="flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-semibold text-primary-foreground"
          style={{ backgroundColor: `oklch(${agentAvatarLightness(agent.name)} 0.06 155)` }}>
          {agentInitials(agent.name)}
        </div>
        <span className="text-xs font-medium">{agent.name}</span>
        <span className="text-[10px] text-muted-foreground">{agent.title ?? 'Agent'}</span>
        <RuntimeBadge runtime={agent.runtime ?? 'hosted'} />
        <span className="ml-auto flex items-center gap-1 text-[10px] text-muted-foreground">
          <Clock className="h-2.5 w-2.5" />
          {agent.schedule ? `Next: ${agent.schedule}` : 'Manual trigger'}
        </span>
      </div>
      )}

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl px-4 py-4">
          {messages.length === 0 && !streaming ? (
            <div className="flex flex-col items-center py-8 text-center">
              <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold text-primary-foreground"
                style={{ backgroundColor: `oklch(${agentAvatarLightness(agent.name)} 0.06 155)` }}>
                {agentInitials(agent.name)}
              </div>
              <p className="text-sm font-medium">Chat with {agent.name}</p>
              <p className="mt-1 max-w-sm text-xs text-muted-foreground">{agent.description}</p>
              <div className="mt-3 flex flex-wrap justify-center gap-1.5">
                <button onClick={() => setInput('What did you do today?')} className="rounded-full border border-border px-2.5 py-1 text-[11px] text-muted-foreground hover:border-primary/30 hover:text-foreground">What did you do today?</button>
                <button onClick={() => setInput('Run your workflow now')} className="rounded-full border border-border px-2.5 py-1 text-[11px] text-muted-foreground hover:border-primary/30 hover:text-foreground">Run now</button>
                <button onClick={() => setInput('What needs my attention?')} className="rounded-full border border-border px-2.5 py-1 text-[11px] text-muted-foreground hover:border-primary/30 hover:text-foreground">What needs attention?</button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {messages.map(m => (
                <AgentMessageBubble key={m.id} role={m.role} content={m.content} events={m.events} agentName={agent.name} />
              ))}
              {streaming && (
                <StreamingBubble agentName={agent.name} events={liveEvents} liveText={liveText} />
              )}
            </div>
          )}
        </div>
      </div>

      {/* Composer */}
      <div className="border-t border-border bg-background/80 p-3 backdrop-blur-md">
        <div className="mx-auto max-w-2xl">
          <div className="relative rounded-xl border border-border bg-card focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/20 transition-colors">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={`Message ${agent.name}…`}
              rows={1}
              className="min-h-[44px] max-h-32 w-full resize-none border-0 bg-transparent px-3 py-2.5 pr-12 text-sm shadow-none focus:outline-none placeholder:text-muted-foreground"
            />
            <button
              onClick={send}
              disabled={!input.trim() || streaming}
              className="absolute bottom-2 right-2 flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-primary-foreground disabled:opacity-40"
              aria-label="Send"
            >
              {streaming ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ChevronRight className="h-4 w-4" />}
            </button>
          </div>
          <div className="mt-1 px-1 text-[10px] text-muted-foreground">
            <kbd className="rounded border border-border px-1 font-mono">Enter</kbd> send
          </div>
        </div>
      </div>
    </div>
  )
}
