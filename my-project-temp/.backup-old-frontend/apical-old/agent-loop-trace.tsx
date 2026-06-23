'use client'

import * as React from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import {
  Brain,
  Search,
  Globe,
  Code2,
  Terminal,
  Database,
  Workflow,
  Plug,
  CheckCircle2,
  XCircle,
  Loader2,
  Sparkles,
  ChevronRight,
} from 'lucide-react'

// Renders the live event stream from the autonomous agent loop
// (POST /api/agent/think). Shows chain-of-thought, tool calls, observations,
// and the final answer as they arrive over SSE.

export type { AgentLoopEvent } from '@/lib/types'
import type { AgentLoopEvent } from '@/lib/types'

export interface AgentLoopTraceProps {
  events: AgentLoopEvent[]
  /** Whether the loop is still streaming. */
  isStreaming: boolean
}

const TOOL_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  web_search: Search,
  web_read: Globe,
  http_request: Globe,
  code_eval: Code2,
  cli_run: Terminal,
  data_table_create: Database,
  data_table_insert: Database,
  data_table_query: Database,
  workflow_propose: Workflow,
  integration_list: Database,
  mcp_list_servers: Plug,
  mcp_call_tool: Plug,
}

const STATUS_LABELS: Record<string, string> = {
  thinking: 'Thinking',
  acting: 'Acting',
  observing: 'Observing',
  done: 'Done',
}

export function AgentLoopTrace({ events, isStreaming }: AgentLoopTraceProps) {
  // Compute the running status from the events.
  const lastStatus = [...events].reverse().find((e) => e.type === 'status')?.status
  const finalEvent = events.find((e) => e.type === 'final')
  const errorEvent = events.find((e) => e.type === 'error')

  return (
    <div className="space-y-2">
      {/* Status header */}
      <div className="flex items-center gap-2 pb-1">
        <div
          className={cn(
            'flex h-5 w-5 items-center justify-center rounded-full',
            errorEvent
              ? 'bg-destructive/15 text-destructive'
              : finalEvent
                ? 'bg-primary/15 text-primary'
                : 'bg-primary/10 text-primary',
          )}
        >
          {isStreaming && !finalEvent && !errorEvent ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : errorEvent ? (
            <XCircle className="h-3 w-3" />
          ) : (
            <Sparkles className="h-3 w-3" />
          )}
        </div>
        <span className="text-xs font-medium">
          {errorEvent
            ? 'Stopped'
            : finalEvent
              ? 'Done'
              : isStreaming
                ? STATUS_LABELS[lastStatus ?? 'thinking'] ?? 'Thinking'
                : 'Agent loop'}
        </span>
        {isStreaming && !finalEvent && !errorEvent && (
          <Badge variant="outline" className="ml-auto gap-1 px-1.5 py-0 text-[9px] text-muted-foreground">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" /> live
          </Badge>
        )}
      </div>

      {/* Events */}
      <div className="space-y-1.5">
        <AnimatePresence initial={false}>
          {events
            .filter((e) => e.type !== 'status')
            .map((e, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2 }}
              >
                <EventRow event={e} />
              </motion.div>
            ))}
        </AnimatePresence>
      </div>

      {/* Final answer */}
      {finalEvent && finalEvent.answer && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-3 rounded-lg border border-primary/30 bg-primary/5 p-3"
        >
          <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold">
            <CheckCircle2 className="h-3.5 w-3.5 text-primary" /> Answer
          </div>
          <div className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
            {finalEvent.answer}
          </div>
          {finalEvent.proposedWorkflow && finalEvent.proposedWorkflow.steps.length > 0 && (
            <div className="mt-3 rounded-md border border-border/60 bg-card p-2">
              <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                <Workflow className="h-3 w-3" /> Proposed workflow ({finalEvent.proposedWorkflow.steps.length} steps)
              </div>
              <div className="flex flex-wrap gap-1">
                {finalEvent.proposedWorkflow.steps.map((s, j) => (
                  <Badge
                    key={j}
                    variant="outline"
                    className={cn(
                      'gap-1 px-1.5 py-0 text-[9px] font-medium',
                      s.kind === 'reason' && 'border-reason/40 text-reason',
                      s.kind === 'gate' && 'border-gate/40 text-gate',
                      s.kind === 'tool' && 'border-tool-foreground/30 text-tool-foreground',
                    )}
                  >
                    {String(s.label ?? s.kind)}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </motion.div>
      )}

      {/* Error */}
      {errorEvent && (
        <div className="mt-2 rounded-lg border border-destructive/30 bg-destructive/5 p-2.5 text-xs text-destructive">
          {errorEvent.message}
        </div>
      )}
    </div>
  )
}

function EventRow({ event }: { event: AgentLoopEvent }) {
  if (event.type === 'thought') {
    return (
      <div className="flex gap-2 rounded-md bg-muted/30 px-2.5 py-1.5">
        <Brain className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
        <span className="text-xs leading-relaxed text-muted-foreground">{event.text}</span>
      </div>
    )
  }

  if (event.type === 'tool_call') {
    const Icon = TOOL_ICONS[event.tool ?? ''] ?? ChevronRight
    const inputStr = event.input
      ? Object.entries(event.input)
          .filter(([, v]) => v !== undefined && v !== null && v !== '')
          .map(([k, v]) => `${k}: ${typeof v === 'string' ? `"${v.slice(0, 60)}"` : JSON.stringify(v).slice(0, 60)}`)
          .join(', ')
      : ''
    return (
      <div className="flex gap-2 px-2.5 py-1">
        <Icon className="mt-0.5 h-3 w-3 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <span className="font-mono text-[11px] font-medium text-foreground">{event.tool}</span>
          {inputStr && <span className="ml-1.5 text-[11px] text-muted-foreground">{inputStr}</span>}
        </div>
      </div>
    )
  }

  if (event.type === 'observation') {
    const ok = event.ok
    const display = event.display
    const summary = display?.summary || (ok ? 'ok' : 'failed')
    return (
      <div className="flex gap-2 px-2.5 py-1 pl-6">
        {ok ? (
          <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-primary/70" />
        ) : (
          <XCircle className="mt-0.5 h-3 w-3 shrink-0 text-destructive/70" />
        )}
        <span className={cn('text-[11px]', ok ? 'text-muted-foreground' : 'text-destructive/80')}>
          {summary}
        </span>
      </div>
    )
  }

  return null
}

/**
 * Run the agent loop against POST /api/agent/think and collect events.
 * Returns the events array + a streaming flag. Re-renders on every event.
 */
export function useAgentLoop() {
  const [events, setEvents] = React.useState<AgentLoopEvent[]>([])
  const [isStreaming, setIsStreaming] = React.useState(false)

  const run = React.useCallback(async (goal: string, opts?: { context?: string; maxIterations?: number; allowCli?: boolean }) => {
    setEvents([])
    setIsStreaming(true)
    try {
      const res = await fetch('/api/agent/think', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goal, ...opts }),
      })
      if (!res.ok || !res.body) {
        setEvents((e) => [...e, { type: 'error', message: `Request failed (${res.status})` }])
        setIsStreaming(false)
        return
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const parts = buffer.split('\n\n')
        buffer = parts.pop() ?? ''
        for (const part of parts) {
          const line = part.trim()
          if (!line.startsWith('data: ')) continue
          try {
            const evt = JSON.parse(line.slice(6)) as AgentLoopEvent
            setEvents((e) => [...e, evt])
          } catch {
            /* ignore malformed */
          }
        }
      }
    } catch (e) {
      setEvents((ev) => [...ev, { type: 'error', message: (e as Error).message }])
    } finally {
      setIsStreaming(false)
    }
  }, [])

  return { events, isStreaming, run }
}
