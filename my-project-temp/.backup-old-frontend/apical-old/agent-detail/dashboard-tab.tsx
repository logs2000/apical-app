'use client'

import * as React from 'react'
import { useRuns, useRunWorkflow } from '@/lib/queries'
import { useToast } from '@/hooks/use-toast'
import { AgentDashboard } from '../agent-widgets/agent-dashboard'
import { relativeTime, formatDuration, formatCurrency, countKinds } from '@/lib/apical'
import type { Workflow } from '@/lib/types'
import { useAppStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import {
  Gauge, Clock, CheckCircle2, XCircle, AlertTriangle,
  Sparkles, TrendingUp, Activity,
} from 'lucide-react'
import { Button } from '@/components/ui/button'

function StatCard({ label, value, sub, icon: Icon, accent }: {
  label: string
  value: React.ReactNode
  sub?: string
  icon: React.ComponentType<{ className?: string }>
  accent?: 'primary' | 'emerald' | 'gate' | 'muted'
}) {
  const colorMap = {
    primary: 'text-primary',
    emerald: 'text-emerald-500',
    gate: 'text-gate-foreground',
    muted: 'text-muted-foreground',
  }
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="mb-1 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        <Icon className={cn('h-3 w-3', accent && colorMap[accent])} />
        {label}
      </div>
      <div className="text-xl font-semibold tabular-nums">{value}</div>
      {sub && <div className="mt-0.5 text-[10px] text-muted-foreground">{sub}</div>}
    </div>
  )
}

function RecentActivity({ agentId }: { agentId: string }) {
  const { data: runs } = useRuns(30)
  const agentRuns = (runs ?? []).filter((r) => r.workflowId === agentId).slice(0, 5)
  const selectRun = useAppStore((s) => s.selectRun)
  const setMode = useAppStore((s) => s.setMode)
  const [expanded, setExpanded] = React.useState<string | null>(null)

  if (agentRuns.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
        No runs yet. Click "Run now" above to kick off the first one.
      </div>
    )
  }

  return (
    <div className="space-y-1.5">
      {agentRuns.map((r) => (
        <div key={r.id} className="rounded-lg border border-border bg-card/60">
          <button
            onClick={() => setExpanded(expanded === r.id ? null : r.id)}
            className="flex w-full items-center gap-2.5 p-2.5 text-left"
          >
            <div className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-full',
              r.status === 'completed' ? 'bg-emerald-500/10 text-emerald-500' :
              r.status === 'failed' ? 'bg-destructive/10 text-destructive' :
              'bg-primary/10 text-primary')}>
              {r.status === 'completed' ? <CheckCircle2 className="h-3.5 w-3.5" /> :
               r.status === 'failed' ? <XCircle className="h-3.5 w-3.5" /> :
               <Clock className="h-3.5 w-3.5" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-medium">{r.report?.summary ?? `${r.itemsProcessed} items processed`}</div>
              <div className="text-[10px] text-muted-foreground">
                {relativeTime(r.startedAt)} · {formatDuration(r.durationMs)} · {r.automaticCount} auto
                {r.flaggedCount > 0 && ` · ${r.flaggedCount} flagged`}
              </div>
            </div>
          </button>
          {expanded === r.id && r.report && (
            <div className="border-t border-border/60 p-2.5">
              {r.report.items.length > 0 && (
                <div className="mb-2 space-y-1">
                  <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Items</div>
                  {r.report.items.slice(0, 6).map((it, i) => {
                    const Icon = it.outcome === 'automatic' ? CheckCircle2 : it.outcome === 'flagged' ? AlertTriangle : Gauge
                    const cls = it.outcome === 'automatic' ? 'text-emerald-500' : it.outcome === 'flagged' ? 'text-gate-foreground' : 'text-primary'
                    return (
                      <div key={i} className="flex items-start gap-1.5 text-[11px]">
                        <Icon className={cn('mt-0.5 h-3 w-3 shrink-0', cls)} />
                        <span className="font-medium">{it.name}</span>
                        <span className="text-muted-foreground">— {it.detail}</span>
                      </div>
                    )
                  })}
                </div>
              )}
              {r.report.flags.length > 0 && (
                <div className="space-y-1">
                  <div className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-gate-foreground">
                    <AlertTriangle className="h-2.5 w-2.5" /> {r.report.flags.length} flagged
                  </div>
                  {r.report.flags.slice(0, 4).map((f, i) => (
                    <div key={i} className="rounded border border-gate/20 bg-gate/5 p-1.5 text-[11px]">
                      <code className="font-mono text-[10px]">{f.item}</code>
                      <div className="text-muted-foreground">{f.reason}</div>
                    </div>
                  ))}
                </div>
              )}
              <Button
                variant="ghost" size="sm" className="mt-2 h-6 text-[11px]"
                onClick={() => { selectRun(r.id); setMode('developer') }}
              >
                View full trace
              </Button>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

export function DashboardTab({ agent }: { agent: Workflow }) {
  const runWf = useRunWorkflow()
  const { toast } = useToast()
  const kinds = countKinds(agent.steps.steps)
  const autoPct = agent.itemsProcessed > 0
    ? Math.round((agent.automaticCount / agent.itemsProcessed) * 100)
    : 0

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold tracking-tight">
            <Gauge className="h-4 w-4 text-muted-foreground" /> Dashboard
          </h2>
          <p className="text-[11px] text-muted-foreground">
            Auto-built by {agent.name}. Updates after each run.
          </p>
        </div>
        <Button
          size="sm"
          onClick={async () => {
            try {
              await runWf.mutateAsync({ id: agent.id })
              toast({ title: 'Run started', description: `${agent.name} is executing.` })
            } catch (e) {
              toast({ title: 'Run failed', description: (e as Error).message, variant: 'destructive' })
            }
          }}
          disabled={runWf.isPending}
        >
          {runWf.isPending ? <Activity className="mr-1 h-3 w-3 animate-pulse" /> : <Activity className="mr-1 h-3 w-3" />}
          Run now
        </Button>
      </div>

      {/* Stat row */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatCard label="Runs" value={agent.runsCount} icon={Activity} accent="primary" />
        <StatCard
          label="Items"
          value={agent.itemsProcessed.toLocaleString()}
          icon={CheckCircle2}
          accent="emerald"
        />
        <StatCard
          label="Auto %"
          value={`${autoPct}%`}
          sub={`${agent.automaticCount.toLocaleString()} automatic`}
          icon={TrendingUp}
          accent={autoPct >= 80 ? 'emerald' : autoPct >= 50 ? 'primary' : 'gate'}
        />
        <StatCard
          label="Saved"
          value={formatCurrency(agent.estCostSavedCents)}
          sub={`${agent.aiCallsSaved.toLocaleString()} AI calls saved`}
          icon={Sparkles}
          accent="emerald"
        />
      </div>

      {/* Workflow breakdown */}
      <div>
        <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <Gauge className="h-3 w-3" /> Workflow breakdown
        </h3>
        <div className="flex flex-wrap gap-2">
          <div className="rounded-md border border-border bg-card px-2.5 py-1.5 text-xs">
            <span className="text-muted-foreground">Tools: </span>
            <span className="font-semibold">{kinds.tool}</span>
          </div>
          <div className="rounded-md border border-reason/30 bg-reason/5 px-2.5 py-1.5 text-xs">
            <span className="text-muted-foreground">Reason: </span>
            <span className="font-semibold text-reason">{kinds.reason}</span>
          </div>
          <div className="rounded-md border border-gate/30 bg-gate/5 px-2.5 py-1.5 text-xs">
            <span className="text-muted-foreground">Gates: </span>
            <span className="font-semibold text-gate-foreground">{kinds.gate}</span>
          </div>
          {kinds.hardened > 0 && (
            <div className="rounded-md border border-hardened/30 bg-hardened/5 px-2.5 py-1.5 text-xs">
              <span className="text-muted-foreground">Hardened: </span>
              <span className="font-semibold text-hardened">{kinds.hardened}</span>
            </div>
          )}
        </div>
      </div>

      {/* Agent dashboard widgets */}
      <div>
        <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <Sparkles className="h-3 w-3" /> Auto-built widgets
        </h3>
        <AgentDashboard agentId={agent.id} />
      </div>

      {/* Recent activity */}
      <div>
        <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <Clock className="h-3 w-3" /> Recent activity
        </h3>
        <RecentActivity agentId={agent.id} />
      </div>
    </div>
  )
}
