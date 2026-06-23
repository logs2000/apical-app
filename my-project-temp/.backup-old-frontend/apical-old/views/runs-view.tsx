'use client'

import * as React from 'react'
import { useRuns, useRun, useWorkflow } from '@/lib/queries'
import { useRunSocket } from '@/hooks/use-run-socket'
import { useAppStore } from '@/lib/store'
import { WorkflowFlow, type StepRenderState } from '../workflow-flow'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Progress } from '@/components/ui/progress'
import { ScrollArea } from '@/components/ui/scroll-area'
import { formatDuration, relativeTime } from '@/lib/apical'
import { motion, AnimatePresence } from 'framer-motion'
import { cn } from '@/lib/utils'
import {
  ArrowLeft,
  Activity,
  Clock,
  CheckCircle2,
  AlertTriangle,
  ShieldCheck,
  Hand,
  Calendar,
  Loader2,
  PlayCircle,
  XCircle,
  Zap,
  Brain,
  Sparkles,
  FileCheck2,
  Flag,
} from 'lucide-react'
import type { Run, RunStep, RunStatus, WorkflowStep, RunReport, RunReportItem } from '@/lib/types'

// ----------------------------------------------------------------------------
// Status helpers
// ----------------------------------------------------------------------------

const STATUS_META: Record<RunStatus, { label: string; cls: string; icon: React.ComponentType<{ className?: string }> }> = {
  running: { label: 'Running', cls: 'border-primary/40 bg-primary/15 text-primary', icon: Loader2 },
  completed: { label: 'Completed', cls: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-500', icon: CheckCircle2 },
  failed: { label: 'Failed', cls: 'border-destructive/40 bg-destructive/15 text-destructive', icon: XCircle },
  awaiting_gate: { label: 'Awaiting gate', cls: 'border-gate/50 bg-gate/15 text-gate-foreground', icon: ShieldCheck },
  cancelled: { label: 'Cancelled', cls: 'border-border bg-muted text-muted-foreground', icon: XCircle },
}

function RunStatusBadge({ status }: { status: RunStatus }) {
  const m = STATUS_META[status]
  const Icon = m.icon
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium', m.cls)}>
      <Icon className={cn('h-2.5 w-2.5', status === 'running' && 'animate-spin')} />
      {m.label}
    </span>
  )
}

function TriggerIcon({ trigger }: { trigger: Run['trigger'] }) {
  return trigger === 'manual' ? (
    <Hand className="h-3 w-3 text-muted-foreground" />
  ) : (
    <Calendar className="h-3 w-3 text-muted-foreground" />
  )
}

// ----------------------------------------------------------------------------
// List
// ----------------------------------------------------------------------------

function RunRow({ run, active, onClick }: { run: Run; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-3 rounded-lg border border-transparent px-2.5 py-2 text-left transition-colors',
        active ? 'border-primary/40 bg-primary/5 ring-1 ring-primary/20' : 'hover:border-border hover:bg-accent/40',
      )}
    >
      <div
        className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
          run.status === 'completed' && 'bg-emerald-500/10 text-emerald-500',
          run.status === 'running' && 'bg-primary/10 text-primary',
          run.status === 'failed' && 'bg-destructive/10 text-destructive',
          run.status === 'awaiting_gate' && 'bg-gate/15 text-gate-foreground',
          run.status === 'cancelled' && 'bg-muted text-muted-foreground',
        )}
      >
        {run.status === 'running' ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : run.status === 'completed' ? (
          <CheckCircle2 className="h-4 w-4" />
        ) : run.status === 'failed' ? (
          <XCircle className="h-4 w-4" />
        ) : run.status === 'awaiting_gate' ? (
          <ShieldCheck className="h-4 w-4" />
        ) : (
          <Clock className="h-4 w-4" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{run.workflowName}</div>
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <TriggerIcon trigger={run.trigger} />
          <span>{run.itemsProcessed} items</span>
          <span className="text-muted-foreground/40">·</span>
          <span>{run.automaticCount} auto</span>
          {run.flaggedCount > 0 && (
            <>
              <span className="text-muted-foreground/40">·</span>
              <span className="text-gate-foreground">{run.flaggedCount} flagged</span>
            </>
          )}
        </div>
      </div>
      <div className="shrink-0 text-right">
        <div className="text-[11px] text-muted-foreground">{relativeTime(run.startedAt)}</div>
        <div className="font-mono text-[10px] text-muted-foreground/70">
          {run.status === 'running' ? 'in progress' : formatDuration(run.durationMs)}
        </div>
      </div>
    </button>
  )
}

function ListSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-14 w-full rounded-lg" />
      ))}
    </div>
  )
}

// ----------------------------------------------------------------------------
// Detail
// ----------------------------------------------------------------------------

function StatPill({
  label,
  value,
  icon: Icon,
  accent,
}: {
  label: string
  value: React.ReactNode
  icon: React.ComponentType<{ className?: string }>
  accent?: string
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-card/40 p-2.5">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
        <Icon className={cn('h-3 w-3', accent ?? 'text-muted-foreground')} />
      </div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums">{value}</div>
    </div>
  )
}

function LiveProgressHeader({
  status,
  completedSteps,
  totalSteps,
  durationMs,
}: {
  status: RunStatus
  completedSteps: number
  totalSteps: number
  durationMs: number
}) {
  const isRunning = status === 'running'
  const pct = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0
  return (
    <div
      className={cn(
        'rounded-xl border p-3.5',
        isRunning
          ? 'border-primary/40 bg-primary/5'
          : status === 'completed'
            ? 'border-emerald-500/40 bg-emerald-500/5'
            : status === 'failed'
              ? 'border-destructive/40 bg-destructive/5'
              : 'border-border bg-card',
      )}
    >
      <div className="flex items-center gap-2">
        {isRunning ? (
          <>
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-primary" />
            </span>
            <span className="text-sm font-medium text-primary">Running…</span>
          </>
        ) : status === 'completed' ? (
          <>
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            <span className="text-sm font-medium text-emerald-500">Completed in {formatDuration(durationMs)}</span>
          </>
        ) : status === 'failed' ? (
          <>
            <XCircle className="h-4 w-4 text-destructive" />
            <span className="text-sm font-medium text-destructive">Failed after {formatDuration(durationMs)}</span>
          </>
        ) : status === 'awaiting_gate' ? (
          <>
            <ShieldCheck className="h-4 w-4 text-gate-foreground" />
            <span className="text-sm font-medium text-gate-foreground">Awaiting your approval</span>
          </>
        ) : (
          <>
            <Clock className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">{formatDuration(durationMs)}</span>
          </>
        )}
        <span className="ml-auto font-mono text-[11px] text-muted-foreground">
          {completedSteps}/{totalSteps} steps
        </span>
      </div>
      {isRunning && (
        <Progress value={pct} className="mt-2 h-1.5" />
      )}
    </div>
  )
}

function ReportBanner({ report }: { report: RunReport }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4"
    >
      <div className="flex items-center gap-2">
        <FileCheck2 className="h-4 w-4 text-emerald-500" />
        <h3 className="text-sm font-medium">Report</h3>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-foreground">{report.summary}</p>

      {report.items.length > 0 && (
        <div className="mt-3 space-y-1.5">
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Items ({report.items.length})
          </div>
          <div className="max-h-72 space-y-1 overflow-y-auto pr-1">
            {report.items.map((it, i) => (
              <ReportItemRow key={i} item={it} />
            ))}
          </div>
        </div>
      )}

      {report.flags.length > 0 && (
        <div className="mt-3 space-y-1.5">
          <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-gate-foreground">
            <Flag className="h-2.5 w-2.5" />
            {report.flags.length} flagged for your review
          </div>
          <div className="space-y-1">
            {report.flags.map((f, i) => (
              <div key={i} className="rounded-lg border border-gate/30 bg-gate/5 p-2 text-xs">
                <div className="flex items-center gap-1.5">
                  <AlertTriangle className="h-3 w-3 shrink-0 text-gate-foreground" />
                  <code className="truncate font-mono text-[11px] text-foreground">{f.item}</code>
                </div>
                <div className="mt-0.5 pl-4 text-[11px] text-muted-foreground">{f.reason}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </motion.div>
  )
}

function ReportItemRow({ item }: { item: RunReportItem }) {
  const Icon = item.outcome === 'automatic' ? CheckCircle2 : item.outcome === 'flagged' ? AlertTriangle : ShieldCheck
  const cls =
    item.outcome === 'automatic'
      ? 'text-emerald-500'
      : item.outcome === 'flagged'
        ? 'text-gate-foreground'
        : 'text-primary'
  return (
    <div className="flex items-start gap-2 rounded-lg border border-border/60 bg-card/40 p-2">
      <Icon className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', cls)} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-medium">{item.name}</div>
        <div className="truncate text-[11px] text-muted-foreground">{item.detail}</div>
      </div>
      <span className={cn('shrink-0 rounded px-1.5 py-0.5 text-[9px] font-medium uppercase', cls)}>
        {item.outcome}
      </span>
    </div>
  )
}

function DetailSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-16 w-full rounded-xl" />
      <Skeleton className="h-32 w-full rounded-xl" />
      <Skeleton className="h-64 w-full rounded-xl" />
    </div>
  )
}

function RunDetail({ runId, onBack }: { runId: string; onBack: () => void }) {
  const { data: run, isLoading: runLoading } = useRun(runId)
  const { data: wfData } = useWorkflow(run?.workflowId ?? null)
  const live = useRunSocket(run?.status === 'running' ? runId : null)

  // Build step definitions from the workflow (rich labels/prompts); fall back to run.steps.
  const steps: WorkflowStep[] = React.useMemo(() => {
    if (wfData?.workflow.steps.steps.length) return wfData.workflow.steps.steps
    if (!run) return []
    return [...run.steps]
      .sort((a, b) => a.order - b.order)
      .map((rs: RunStep) => ({
        id: rs.stepId,
        kind: rs.kind,
        label: rs.label,
      }))
  }, [wfData, run])

  // Merge persisted + live states.
  const { states, displayStatus, report, stats, completedSteps } = React.useMemo(() => {
    const s: Record<string, StepRenderState> = {}
    // Persisted baseline
    if (run) {
      for (const rs of run.steps) {
        s[rs.stepId] = {
          status: rs.status,
          output: rs.output,
          aiTokens: rs.aiTokens,
          aiCostCents: rs.aiCostCents,
        }
      }
    }
    // Live overlay
    const isLive = run?.status === 'running'
    if (isLive) {
      for (const [stepId, ls] of Object.entries(live.steps)) {
        s[stepId] = {
          status: ls.status,
          message: ls.message,
          output: ls.output,
          aiTokens: ls.aiTokens,
          aiCostCents: ls.aiCostCents,
        }
      }
    }
    let ds: RunStatus = run?.status ?? 'running'
    if (isLive && (live.status === 'completed' || live.status === 'failed')) {
      ds = live.status
    }
    const rep = live.report ?? run?.report ?? null
    const st = live.stats ?? (run
      ? {
          itemsProcessed: run.itemsProcessed,
          automaticCount: run.automaticCount,
          flaggedCount: run.flaggedCount,
          aiCallsUsed: run.aiCallsUsed,
          aiCallsSaved: run.aiCallsSaved,
          durationMs: run.durationMs,
        }
      : null)
    const completed = Object.values(s).filter(
      (x) => x.status === 'completed' || x.status === 'flagged' || x.status === 'skipped',
    ).length
    return { states: s, displayStatus: ds, report: rep, stats: st, completedSteps: completed }
  }, [run, live])

  if (runLoading || !run) return <DetailSkeleton />

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-4"
    >
      {/* Header */}
      <Card className="p-4">
        <div className="flex items-start gap-3">
          <Button variant="ghost" size="icon" className="md:hidden -ml-2 h-8 w-8 shrink-0" onClick={onBack} aria-label="Back">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold leading-tight">{run.workflowName}</h2>
              <RunStatusBadge status={displayStatus} />
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
              <TriggerIcon trigger={run.trigger} />
              <span className="capitalize">{run.trigger}</span>
              <span className="text-muted-foreground/40">·</span>
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3 w-3" />
                Started {relativeTime(run.startedAt)}
              </span>
              <span className="text-muted-foreground/40">·</span>
              <code className="font-mono text-[10px]">{run.id}</code>
            </div>
          </div>
        </div>
      </Card>

      {/* Live progress header */}
      <LiveProgressHeader
        status={displayStatus}
        completedSteps={completedSteps}
        totalSteps={steps.length || run.steps.length}
        durationMs={stats?.durationMs ?? run.durationMs}
      />

      {/* Stats row */}
      {stats && (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
          <StatPill label="Items" value={stats.itemsProcessed} icon={Zap} accent="text-foreground" />
          <StatPill label="Automatic" value={stats.automaticCount} icon={CheckCircle2} accent="text-emerald-500" />
          <StatPill label="Flagged" value={stats.flaggedCount} icon={AlertTriangle} accent="text-gate-foreground" />
          <StatPill label="AI used" value={stats.aiCallsUsed} icon={Brain} accent="text-reason" />
          <StatPill label="AI saved" value={stats.aiCallsSaved} icon={Sparkles} accent="text-hardened" />
          <StatPill label="Duration" value={formatDuration(stats.durationMs)} icon={Clock} accent="text-muted-foreground" />
        </div>
      )}

      {/* Report */}
      <AnimatePresence>
        {report && <ReportBanner report={report} />}
      </AnimatePresence>

      {/* Live step trace */}
      <Card className="p-4">
        <div className="mb-3 flex items-center gap-2">
          <PlayCircle className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-medium">Execution trace</h3>
          <span className="ml-auto text-[11px] text-muted-foreground">
            {steps.length || run.steps.length} steps
          </span>
        </div>
        {steps.length > 0 ? (
          <WorkflowFlow steps={steps} states={states} />
        ) : (
          <div className="py-6 text-center text-xs text-muted-foreground">No steps recorded.</div>
        )}
      </Card>
    </motion.div>
  )
}

// ----------------------------------------------------------------------------
// View
// ----------------------------------------------------------------------------

export function RunsView() {
  const { data: runs, isLoading } = useRuns(30)
  const selectedRunId = useAppStore((s) => s.selectedRunId)
  const selectRun = useAppStore((s) => s.selectRun)

  const showDetail = !!selectedRunId
  const runningCount = runs?.filter((r) => r.status === 'running').length ?? 0

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 md:px-6">
      {/* Mobile: toggle between list & detail */}
      <div className="md:hidden">
        {showDetail ? (
          <RunDetail runId={selectedRunId!} onBack={() => selectRun(null)} />
        ) : (
          <div className="space-y-3">
            <div>
              <h2 className="flex items-center gap-2 text-sm font-medium">
                <Activity className="h-4 w-4 text-muted-foreground" />
                Recent runs
              </h2>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {runs?.length ?? '—'} total{runningCount > 0 && <span className="text-primary"> · {runningCount} running</span>}
              </p>
            </div>
            {isLoading ? <ListSkeleton /> : !runs || runs.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border bg-card/40 p-10 text-center">
                <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Activity className="h-5 w-5" />
                </div>
                <h3 className="text-sm font-medium">No runs yet</h3>
                <p className="mx-auto mt-1 max-w-xs text-xs text-muted-foreground">
                  Run a workflow from the Agent or Workflows view and watch it execute here in real time.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {runs.map((r) => (
                  <RunRow key={r.id} run={r} active={r.id === selectedRunId} onClick={() => selectRun(r.id)} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Desktop: split list + detail */}
      <div className="hidden md:grid md:grid-cols-[340px_1fr] md:gap-4">
        <div className="space-y-3">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-medium">
              <Activity className="h-4 w-4 text-muted-foreground" />
              Recent runs
            </h2>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {runs?.length ?? '—'} total{runningCount > 0 && <span className="text-primary"> · {runningCount} running</span>}
            </p>
          </div>
          <ScrollArea className="h-[calc(100vh-10rem)]">
            <div className="space-y-1.5 pr-2">
              {isLoading ? <ListSkeleton /> : !runs || runs.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border bg-card/40 p-8 text-center">
                  <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <Activity className="h-5 w-5" />
                  </div>
                  <h3 className="text-sm font-medium">No runs yet</h3>
                  <p className="mx-auto mt-1 max-w-xs text-xs text-muted-foreground">
                    Run a workflow and watch it execute here.
                  </p>
                </div>
              ) : (
                runs.map((r) => (
                  <RunRow key={r.id} run={r} active={r.id === selectedRunId} onClick={() => selectRun(r.id)} />
                ))
              )}
            </div>
          </ScrollArea>
        </div>

        <div>
          {showDetail ? (
            <RunDetail runId={selectedRunId!} onBack={() => selectRun(null)} />
          ) : (
            <div className="flex h-[calc(100vh-10rem)] items-center justify-center">
              <div className="text-center">
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground">
                  <Activity className="h-6 w-6" />
                </div>
                <h3 className="text-sm font-medium">Select a run</h3>
                <p className="mt-1 max-w-xs text-xs text-muted-foreground">
                  Pick one from the list to see its execution trace and report — or run a workflow and watch it live.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
