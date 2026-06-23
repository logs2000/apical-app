'use client'

import * as React from 'react'
import { useAppStore, type AgentDetailTab } from '@/lib/store'
import { useWorkflow, useRuns, useRunWorkflow, useUpdateWorkflow, useAgentData } from '@/lib/queries'
import { useToast } from '@/hooks/use-toast'
import { agentInitials, agentAvatarLightness, relativeTime, formatCurrency, countKinds } from '@/lib/apical'
import { RuntimeBadge } from '../runtime-badge'
import type { RunStatus } from '@/lib/types'
import { cn } from '@/lib/utils'
import { motion } from 'framer-motion'
import {
  ArrowLeft, Play, Pause, Download, Loader2,
  Gauge, Workflow as WorkflowIcon, Settings, Database,
  PanelLeftOpen, MessageSquare, Pencil,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AgentRosterRail, CollapsedRosterRail } from './agent-roster-rail'
import { AgentChatRail } from './agent-chat-rail'
import { DashboardTab } from './dashboard-tab'
import { WorkflowTab } from './workflow-tab'
import { ConfigTab } from './config-tab'
import { DataTab } from './data-tab'

function agentStatus(agent: { status: string }, lastRun?: { status: RunStatus; flaggedCount: number }): {
  color: string; label: string
} {
  if (agent.status === 'paused') return { color: 'bg-muted-foreground', label: 'Paused' }
  if (!lastRun) return { color: 'bg-muted-foreground/50', label: 'Idle' }
  if (lastRun.status === 'failed') return { color: 'bg-destructive', label: 'Error' }
  if (lastRun.flaggedCount > 0) return { color: 'bg-gate', label: 'Flagged' }
  if (lastRun.status === 'running') return { color: 'bg-primary', label: 'Running' }
  return { color: 'bg-emerald-500', label: 'Active' }
}

const TABS: { key: AgentDetailTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: 'dashboard', label: 'Dashboard', icon: Gauge },
  { key: 'workflow', label: 'Workflow', icon: WorkflowIcon },
  { key: 'config', label: 'Config', icon: Settings },
]

function TopBar({ agentId, onBack }: { agentId: string; onBack: () => void }) {
  const { data } = useWorkflow(agentId)
  const agent = data?.workflow
  const runWf = useRunWorkflow()
  const updateWf = useUpdateWorkflow()
  const setRosterOpen = useAppStore((s) => s.setAgentRosterRailOpen)
  const setChatOpen = useAppStore((s) => s.setAgentChatRailOpen)
  const rosterOpen = useAppStore((s) => s.agentRosterRailOpen)
  const chatOpen = useAppStore((s) => s.agentChatRailOpen)
  const setMode = useAppStore((s) => s.setMode)
  const { toast } = useToast()

  if (!agent) return null

  const exportJson = () => {
    const data = {
      name: agent.name,
      description: agent.description,
      department: agent.department,
      title: agent.title,
      trigger: { type: agent.trigger, label: agent.schedule },
      steps: agent.steps.steps,
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${agent.name.toLowerCase().replace(/\s+/g, '-')}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-background px-2">
      {/* Left: back + roster toggle (when collapsed) */}
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onBack} aria-label="Back to roster">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        {!rosterOpen && (
          <Button
            variant="ghost" size="icon" className="h-8 w-8"
            onClick={() => setRosterOpen(true)}
            aria-label="Expand roster"
          >
            <PanelLeftOpen className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      {/* Identity */}
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-primary-foreground"
        style={{ backgroundColor: `oklch(${agentAvatarLightness(agent.name)} 0.06 155)` }}>
        {agentInitials(agent.name)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-semibold">{agent.name}</span>
          <RuntimeBadge runtime={agent.runtime ?? 'hosted'} />
          <span className={cn('h-2 w-2 rounded-full',
            agent.status === 'paused' ? 'bg-muted-foreground' : 'bg-emerald-500')} title={agent.status} />
        </div>
        <div className="truncate text-[10px] text-muted-foreground">
          {agent.title ?? 'Agent'} · {agent.department} · {agent.schedule ?? 'Manual'} · {agent.runsCount} runs
        </div>
      </div>

      {/* Right: quick actions + chat toggle */}
      <div className="flex shrink-0 items-center gap-1">
        <Button
          size="sm" variant="ghost" className="h-8 px-2"
          onClick={async () => {
            try {
              await runWf.mutateAsync({ id: agent.id })
              toast({ title: 'Run started' })
            } catch (e) {
              toast({ title: 'Failed', description: (e as Error).message, variant: 'destructive' })
            }
          }}
          disabled={runWf.isPending}
          title="Run now"
        >
          {runWf.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
        </Button>
        <Button
          size="sm" variant="ghost" className="h-8 px-2"
          onClick={() => updateWf.mutate({ id: agent.id, patch: { status: agent.status === 'paused' ? 'active' : 'paused' } })}
          title={agent.status === 'paused' ? 'Resume' : 'Pause'}
        >
          {agent.status === 'paused' ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
        </Button>
        <Button size="sm" variant="ghost" className="h-8 px-2" onClick={exportJson} title="Export">
          <Download className="h-3.5 w-3.5" />
        </Button>
        {!chatOpen && (
          <Button
            size="sm" variant="ghost" className="h-8 px-2"
            onClick={() => setChatOpen(true)}
            aria-label="Expand chat"
            title="Expand chat"
          >
            <MessageSquare className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </div>
  )
}

function TabBar({ active, onChange, showData }: {
  active: AgentDetailTab
  onChange: (t: AgentDetailTab) => void
  showData: boolean
}) {
  const tabs = showData
    ? [...TABS, { key: 'data' as AgentDetailTab, label: 'Data', icon: Database }]
    : TABS
  return (
    <div className="flex h-9 shrink-0 items-center gap-0.5 border-b border-border bg-muted/20 px-2">
      {tabs.map((t) => {
        const Icon = t.icon
        const isActive = active === t.key
        return (
          <button
            key={t.key}
            onClick={() => onChange(t.key)}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
              isActive
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {t.label}
          </button>
        )
      })}
    </div>
  )
}

export function AgentDetailShell({ agentId, onBack }: { agentId: string; onBack: () => void }) {
  const { data, isLoading } = useWorkflow(agentId)
  const rosterOpen = useAppStore((s) => s.agentRosterRailOpen)
  const activeTab = useAppStore((s) => s.agentDetailTab)
  const setTab = useAppStore((s) => s.setAgentDetailTab)
  const { data: agentDataRows } = useAgentData(agentId)
  const showDataTab = !!(agentDataRows && agentDataRows.length > 0)

  if (isLoading || !data) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
      </div>
    )
  }

  const agent = data.workflow

  return (
    <div className="flex h-full">
      {/* Left: roster rail (collapsible) */}
      {rosterOpen ? (
        <div className="w-56 shrink-0 border-r border-border">
          <AgentRosterRail />
        </div>
      ) : (
        <CollapsedRosterRail />
      )}

      {/* Middle: top bar + tabs + content */}
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar agentId={agentId} onBack={onBack} />
        <TabBar active={activeTab} onChange={setTab} showData={showDataTab} />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.15 }}
            className="h-full"
          >
            {activeTab === 'dashboard' && <DashboardTab agent={agent} />}
            {activeTab === 'workflow' && <WorkflowTab agent={agent} />}
            {activeTab === 'config' && <ConfigTab agent={agent} />}
            {activeTab === 'data' && <DataTab agent={agent} />}
          </motion.div>
        </div>
      </div>

      {/* Right: chat rail (collapsible) */}
      <div className="shrink-0">
        <AgentChatRail agent={agent} />
      </div>
    </div>
  )
}
