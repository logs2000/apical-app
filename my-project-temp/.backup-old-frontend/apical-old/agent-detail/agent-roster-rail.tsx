'use client'

import * as React from 'react'
import { useAppStore } from '@/lib/store'
import { useWorkflows, useWorkspaces, useRuns } from '@/lib/queries'
import { agentInitials, agentAvatarLightness, relativeTime } from '@/lib/apical'
import { RuntimeBadge } from '../runtime-badge'
import type { Workflow, RunStatus } from '@/lib/types'
import { cn } from '@/lib/utils'
import { motion } from 'framer-motion'
import {
  Boxes, ChevronLeft, Plus, Search, Sparkles,
  CheckCircle2, AlertTriangle, XCircle, Clock,
} from 'lucide-react'

function agentStatus(agent: Workflow, lastRun?: { status: RunStatus; flaggedCount: number }): {
  color: string; label: string
} {
  if (agent.status === 'paused') return { color: 'bg-muted-foreground', label: 'Paused' }
  if (!lastRun) return { color: 'bg-muted-foreground/50', label: 'Idle' }
  if (lastRun.status === 'failed') return { color: 'bg-destructive', label: 'Error' }
  if (lastRun.flaggedCount > 0) return { color: 'bg-gate', label: 'Flagged' }
  if (lastRun.status === 'running') return { color: 'bg-primary', label: 'Running' }
  return { color: 'bg-emerald-500', label: 'Active' }
}

function AgentRow({ agent, onPick, active }: { agent: Workflow; onPick: () => void; active: boolean }) {
  const { data: runs } = useRuns(30)
  const lastRun = runs?.find((r) => r.workflowId === agent.id)
  const status = agentStatus(agent, lastRun ? { status: lastRun.status, flaggedCount: lastRun.flaggedCount } : undefined)
  const hasHardened = agent.steps.steps.some((s) => s.hardened)

  return (
    <button onClick={onPick} className={cn(
      'flex w-full items-center gap-2.5 rounded-lg border bg-card px-2.5 py-2 text-left transition-colors',
      active ? 'border-primary/50 ring-1 ring-primary/20' : 'border-border hover:border-primary/30',
    )}>
      <div className="relative shrink-0">
        <div className="flex h-8 w-8 items-center justify-center rounded-full text-[10px] font-semibold text-primary-foreground"
          style={{ backgroundColor: `oklch(${agentAvatarLightness(agent.name)} 0.06 155)` }}>
          {agentInitials(agent.name)}
        </div>
        <span className={cn('absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-card', status.color)} title={status.label} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1">
          <span className="truncate text-xs font-medium">{agent.name}</span>
          {hasHardened && <Sparkles className="h-2.5 w-2.5 shrink-0 text-hardened" />}
        </div>
        <div className="truncate text-[10px] text-muted-foreground">
          {agent.title ?? 'Agent'} · {agent.department}
        </div>
        {lastRun && (
          <div className="truncate text-[9px] text-muted-foreground/70">
            {relativeTime(lastRun.startedAt)} · {lastRun.itemsProcessed} items
          </div>
        )}
      </div>
    </button>
  )
}

export function AgentRosterRail() {
  const selectedId = useAppStore((s) => s.selectedWorkflowId)
  const selectWorkflow = useAppStore((s) => s.selectWorkflow)
  const setMode = useAppStore((s) => s.setMode)
  const setRosterOpen = useAppStore((s) => s.setAgentRosterRailOpen)
  const activeWorkspaceId = useAppStore((s) => s.activeWorkspaceId)

  const { data: agents } = useWorkflows()
  const { data: workspaces } = useWorkspaces()
  const effectiveWsId = activeWorkspaceId ?? workspaces?.[0]?.id ?? null
  const [query, setQuery] = React.useState('')

  const filtered = React.useMemo(() => {
    if (!agents) return []
    const byWs = effectiveWsId
      ? agents.filter((a) => a.workspaceId === effectiveWsId || !a.workspaceId)
      : agents
    if (!query.trim()) return byWs
    const q = query.toLowerCase()
    return byWs.filter((a) =>
      a.name.toLowerCase().includes(q) ||
      (a.title ?? '').toLowerCase().includes(q) ||
      a.department.toLowerCase().includes(q),
    )
  }, [agents, effectiveWsId, query])

  // Group by department.
  const grouped = React.useMemo(() => {
    const map = new Map<string, Workflow[]>()
    for (const a of filtered) {
      const dept = a.department || 'General'
      if (!map.has(dept)) map.set(dept, [])
      map.get(dept)!.push(a)
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  }, [filtered])

  return (
    <div className="flex h-full flex-col bg-sidebar/30">
      {/* Header: collapse + new */}
      <div className="flex items-center gap-1 border-b border-border px-2 py-1.5">
        <button
          onClick={() => setRosterOpen(false)}
          className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-accent/50 hover:text-foreground"
          title="Collapse roster"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Agents</span>
        <button
          onClick={() => setMode('chat')}
          className="ml-auto flex h-6 w-6 items-center justify-center rounded text-primary hover:bg-primary/10"
          title="New agent (in Chat)"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Search */}
      <div className="p-2">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search agents…"
            className="w-full rounded-md border border-border bg-card pl-6 pr-2 py-1 text-[11px] outline-none focus:border-primary/50"
          />
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {filtered.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-4 text-center text-[11px] text-muted-foreground">
            <Boxes className="mx-auto mb-1 h-6 w-6 text-muted-foreground/50" />
            No agents yet.
            <button onClick={() => setMode('chat')} className="mt-2 block w-full text-primary hover:underline">
              Create one →
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {grouped.map(([dept, list]) => (
              <div key={dept}>
                <div className="mb-1 px-1 text-[9px] font-medium uppercase tracking-wide text-muted-foreground/70">{dept}</div>
                <div className="space-y-1">
                  {list.map((a) => (
                    <AgentRow
                      key={a.id}
                      agent={a}
                      onPick={() => selectWorkflow(a.id)}
                      active={a.id === selectedId}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/** Thin strip shown when the rail is collapsed — just the active agent + expand button. */
export function CollapsedRosterRail() {
  const selectedId = useAppStore((s) => s.selectedWorkflowId)
  const setRosterOpen = useAppStore((s) => s.setAgentRosterRailOpen)
  const { data: agents } = useWorkflows()
  const agent = agents?.find((a) => a.id === selectedId)

  return (
    <div className="flex h-full w-10 flex-col items-center gap-2 border-r border-border bg-sidebar/20 py-2">
      <button
        onClick={() => setRosterOpen(true)}
        className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-accent/50 hover:text-foreground"
        title="Expand roster"
      >
        <Boxes className="h-3.5 w-3.5" />
      </button>
      {agent && (
        <button
          onClick={() => setRosterOpen(true)}
          className="flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-semibold text-primary-foreground"
          style={{ backgroundColor: `oklch(${agentAvatarLightness(agent.name)} 0.06 155)` }}
          title={agent.name}
        >
          {agentInitials(agent.name)}
        </button>
      )}
    </div>
  )
}
