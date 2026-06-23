'use client'

import { useStats, useRuns, useWorkflows } from '@/lib/queries'
import { useAppStore } from '@/lib/store'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatCurrency, formatDuration, relativeTime } from '@/lib/apical'
import { motion } from 'framer-motion'
import {
  Files,
  Brain,
  TrendingDown,
  Sparkles,
  ArrowUpRight,
  Lock,
  Activity,
  CheckCircle2,
  AlertTriangle,
  Clock,
} from 'lucide-react'
import { cn } from '@/lib/utils'

function StatCard({
  label,
  value,
  sub,
  icon: Icon,
  accent,
  delay,
}: {
  label: string
  value: React.ReactNode
  sub?: React.ReactNode
  icon: React.ComponentType<{ className?: string }>
  accent?: string
  delay: number
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
    >
      <Card className="relative overflow-hidden p-4">
        <div className="flex items-start justify-between">
          <div className="min-w-0">
            <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
            <div className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">{value}</div>
            {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
          </div>
          <div className={cn('flex h-9 w-9 items-center justify-center rounded-lg', accent ?? 'bg-muted text-muted-foreground')}>
            <Icon className="h-4 w-4" />
          </div>
        </div>
      </Card>
    </motion.div>
  )
}

export function DashboardView() {
  const { data: stats, isLoading } = useStats()
  const { data: runs } = useRuns(6)
  const { data: workflows } = useWorkflows()
  const setView = useAppStore((s) => s.setView)
  const selectWorkflow = useAppStore((s) => s.selectWorkflow)
  const selectRun = useAppStore((s) => s.selectRun)

  const hardeningOpps = workflows
    ? workflows
        .map((w) => ({
          wf: w,
          reasonSteps: w.steps.steps.filter((s) => s.kind === 'reason' && !s.hardened),
        }))
        .filter((x) => x.reasonSteps.length > 0)
    : []

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 md:px-6 space-y-6">
      {/* Hero strip */}
      <div className="relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-primary/10 via-card to-card p-5">
        <div className="bg-dots absolute inset-0 opacity-40" />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Your AI workforce</h2>
            <p className="mt-1 max-w-xl text-sm text-muted-foreground">
              {stats?.activeWorkflows ?? '—'} active workflows have processed{' '}
              {stats?.itemsThisWeek?.toLocaleString() ?? '—'} items this week —{' '}
              {stats ? Math.round(stats.automaticPct) : '—'}% fully automatic.
            </p>
          </div>
          <Button onClick={() => setView('agent')} className="gap-1.5">
            <Sparkles className="h-4 w-4" />
            Describe a new job
          </Button>
        </div>
      </div>

      {/* Stat grid */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Items this week"
          value={isLoading ? '—' : stats?.itemsThisWeek.toLocaleString()}
          sub="across all workflows"
          icon={Files}
          accent="bg-primary/10 text-primary"
          delay={0.05}
        />
        <StatCard
          label="Automatic"
          value={isLoading ? '—' : `${Math.round(stats?.automaticPct ?? 0)}%`}
          sub="ran without a human"
          icon={CheckCircle2}
          accent="bg-emerald-500/10 text-emerald-500"
          delay={0.1}
        />
        <StatCard
          label="AI calls saved"
          value={isLoading ? '—' : stats?.aiCallsSaved.toLocaleString()}
          sub="via hardening + smart routing"
          icon={Brain}
          accent="bg-reason/15 text-reason"
          delay={0.15}
        />
        <StatCard
          label="Est. cost saved"
          value={isLoading ? '—' : formatCurrency(stats?.estCostSavedCents ?? 0)}
          sub="vs. running everything through the model"
          icon={TrendingDown}
          accent="bg-hardened/15 text-hardened"
          delay={0.2}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Recent runs */}
        <Card className="lg:col-span-2 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-sm font-medium">
              <Activity className="h-4 w-4 text-muted-foreground" />
              Recent runs
            </h3>
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setView('runs')}>
              View all <ArrowUpRight className="ml-1 h-3 w-3" />
            </Button>
          </div>
          <div className="space-y-2">
            {runs?.slice(0, 5).map((r) => (
              <button
                key={r.id}
                onClick={() => {
                  selectRun(r.id)
                  setView('runs')
                }}
                className="flex w-full items-center gap-3 rounded-lg border border-transparent px-2 py-2 text-left transition-colors hover:border-border hover:bg-accent/40"
              >
                <div
                  className={cn(
                    'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
                    r.status === 'completed' && 'bg-emerald-500/10 text-emerald-500',
                    r.status === 'running' && 'bg-primary/10 text-primary',
                    r.status === 'failed' && 'bg-destructive/10 text-destructive',
                  )}
                >
                  {r.status === 'completed' ? (
                    <CheckCircle2 className="h-4 w-4" />
                  ) : r.status === 'running' ? (
                    <Clock className="h-4 w-4" />
                  ) : (
                    <AlertTriangle className="h-4 w-4" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{r.workflowName}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {r.itemsProcessed} items · {r.automaticCount} auto · {r.flaggedCount} flagged
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[11px] text-muted-foreground">{relativeTime(r.startedAt)}</div>
                  <div className="text-[10px] font-mono text-muted-foreground/70">{formatDuration(r.durationMs)}</div>
                </div>
              </button>
            ))}
            {runs?.length === 0 && (
              <div className="py-8 text-center text-sm text-muted-foreground">No runs yet.</div>
            )}
          </div>
        </Card>

        {/* Hardening opportunities */}
        <Card className="p-4">
          <div className="mb-3 flex items-center gap-2">
            <Lock className="h-4 w-4 text-hardened" />
            <h3 className="text-sm font-medium">Hardening</h3>
          </div>
          <p className="mb-3 text-xs text-muted-foreground">
            Reason steps that have run consistently enough to become deterministic rules.
          </p>
          <div className="space-y-2">
            {hardeningOpps.slice(0, 3).map(({ wf, reasonSteps }) => (
              <button
                key={wf.id}
                onClick={() => {
                  selectWorkflow(wf.id)
                  setView('workflows')
                }}
                className="w-full rounded-lg border border-hardened/20 bg-hardened/5 p-2.5 text-left transition-colors hover:border-hardened/40"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-xs font-medium">{wf.name}</span>
                  <Badge variant="outline" className="border-hardened/40 text-hardened text-[10px]">
                    {reasonSteps.length} step{reasonSteps.length > 1 ? 's' : ''}
                  </Badge>
                </div>
                <div className="mt-1 truncate text-[11px] text-muted-foreground">
                  {reasonSteps[0]?.label}
                </div>
              </button>
            ))}
            {hardeningOpps.length === 0 && (
              <div className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                Nothing ripe yet. Run a workflow a few times.
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  )
}
