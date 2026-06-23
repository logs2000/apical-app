'use client'

import * as React from 'react'
import { useWorkflows } from '@/lib/queries'
import { useAppStore } from '@/lib/store'
import { agentInitials, agentAvatarLightness } from '@/lib/apical'
import { RuntimeBadge } from './runtime-badge'
import type { Workflow, RunStatus } from '@/lib/types'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Boxes, Plus } from 'lucide-react'
import { AgentDetailShell } from './agent-detail/agent-detail-shell'

// ---------------- Status ring ----------------
function agentStatus(agent: Workflow, lastRun?: { status: RunStatus; flaggedCount: number }): {
  color: string; label: string; ring: string
} {
  if (agent.status === 'paused') return { color: 'bg-muted-foreground', label: 'Paused', ring: 'ring-muted-foreground/40' }
  if (!lastRun) return { color: 'bg-muted-foreground/50', label: 'Idle', ring: 'ring-muted-foreground/30' }
  if (lastRun.status === 'failed') return { color: 'bg-destructive', label: 'Error', ring: 'ring-destructive/50' }
  if (lastRun.flaggedCount > 0) return { color: 'bg-gate', label: 'Flagged', ring: 'ring-gate/50' }
  if (lastRun.status === 'running') return { color: 'bg-primary', label: 'Running', ring: 'ring-primary/50' }
  return { color: 'bg-emerald-500', label: 'Active', ring: 'ring-emerald-500/40' }
}

// ---------------- Roster list (empty state) ----------------
function AgentRow({ agent, onPick, active }: { agent: Workflow; onPick: () => void; active: boolean }) {
  const status = agentStatus(agent)
  const hasHardened = agent.steps.steps.some((s) => s.hardened)

  return (
    <button onClick={onPick} className={cn(
      'flex w-full items-center gap-3 rounded-xl border bg-card p-3 text-left transition-colors',
      active ? 'border-primary/50 ring-1 ring-primary/20' : 'border-border hover:border-primary/30',
    )}>
      <div className="relative shrink-0">
        <div className="flex h-10 w-10 items-center justify-center rounded-full text-xs font-semibold text-primary-foreground"
          style={{ backgroundColor: `oklch(${agentAvatarLightness(agent.name)} 0.06 155)` }}>
          {agentInitials(agent.name)}
        </div>
        <span className={cn('absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-card', status.color)} title={status.label} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium">{agent.name}</span>
          {hasHardened && <span className="text-[10px] text-hardened">★</span>}
          <RuntimeBadge runtime={agent.runtime ?? 'hosted'} />
          <span className="text-[10px] text-muted-foreground">{status.label}</span>
        </div>
        <div className="truncate text-[11px] text-muted-foreground">
          {agent.title ?? 'Agent'} · {agent.department}
          {agent.schedule ? ` · ${agent.schedule}` : ' · manual'}
        </div>
        <div className="mt-0.5 truncate text-[10px] text-muted-foreground/70">
          {agent.runsCount} runs · {agent.itemsProcessed.toLocaleString()} items
        </div>
      </div>
    </button>
  )
}

function RosterList({ onPick }: { onPick: (id: string) => void }) {
  const { data: agents } = useWorkflows()
  const setMode = useAppStore((s) => s.setMode)
  const selectedId = useAppStore((s) => s.selectedWorkflowId)

  if (!agents || agents.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border p-8 text-center">
        <Boxes className="mx-auto mb-2 h-8 w-8 text-muted-foreground/50" />
        <p className="text-sm font-medium">No agents yet.</p>
        <p className="mt-1 text-xs text-muted-foreground">Tell the assistant what you need done.</p>
        <Button size="sm" className="mt-3" onClick={() => setMode('chat')}>
          <Plus className="mr-1 h-3 w-3" /> Create an agent
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-1.5">
      {agents.map((a) => (
        <AgentRow key={a.id} agent={a} onPick={() => onPick(a.id)} active={a.id === selectedId} />
      ))}
    </div>
  )
}

// ---------------- Agents tab ----------------
export function AgentsTab() {
  const selectedId = useAppStore((s) => s.selectedWorkflowId)
  const selectWorkflow = useAppStore((s) => s.selectWorkflow)

  if (selectedId) {
    return (
      <AgentDetailShell
        agentId={selectedId}
        onBack={() => selectWorkflow(null)}
      />
    )
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-4 py-5 md:px-6">
        <div className="mb-4">
          <h1 className="flex items-center gap-2 text-base font-semibold tracking-tight">
            <Boxes className="h-4 w-4 text-muted-foreground" /> Agents
          </h1>
          <p className="text-[11px] text-muted-foreground">
            Your AI agents. Click one to see its dashboard, workflow, and config — or chat with it.
          </p>
        </div>
        <RosterList onPick={(id) => selectWorkflow(id)} />
      </div>
    </div>
  )
}
