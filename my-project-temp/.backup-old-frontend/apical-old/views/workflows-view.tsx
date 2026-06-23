'use client'

import * as React from 'react'
import { useWorkflows, useWorkflow, useUpdateWorkflow, useRunWorkflow, useHardenStep } from '@/lib/queries'
import { useAppStore } from '@/lib/store'
import { WorkflowFlow } from '../workflow-flow'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useToast } from '@/hooks/use-toast'
import { countKinds, formatCurrency, relativeTime } from '@/lib/apical'
import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import {
  Plus,
  Play,
  Pause,
  Lock,
  Sparkles,
  ArrowLeft,
  Clock,
  Calendar,
  Hand,
  TrendingDown,
  Loader2,
  Check,
  Brain,
  Workflow as WorkflowIcon,
  Zap,
  ShieldCheck,
  Activity,
} from 'lucide-react'
import type { Workflow, WorkflowStep, ExecutionPattern } from '@/lib/types'

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

const KIND_PILL: Record<'tool' | 'reason' | 'gate' | 'hardened', { label: string; cls: string }> = {
  tool: { label: 'tool', cls: 'bg-muted text-muted-foreground' },
  reason: { label: 'reason', cls: 'bg-reason/15 text-reason' },
  gate: { label: 'gate', cls: 'bg-gate/15 text-gate-foreground' },
  hardened: { label: 'hardened', cls: 'bg-hardened/15 text-hardened' },
}

function StatusBadge({ status }: { status: Workflow['status'] }) {
  const map: Record<Workflow['status'], { label: string; cls: string }> = {
    active: { label: 'Active', cls: 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30' },
    paused: { label: 'Paused', cls: 'bg-muted text-muted-foreground border-border' },
    draft: { label: 'Draft', cls: 'bg-amber-500/15 text-amber-500 border-amber-500/30' },
  }
  const m = map[status]
  return <span className={cn('inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium', m.cls)}>{m.label}</span>
}

function KindCounts({ steps }: { steps: WorkflowStep[] }) {
  const c = countKinds(steps)
  return (
    <div className="flex flex-wrap items-center gap-1 text-[10px]">
      {c.tool > 0 && <span className={cn('rounded px-1.5 py-0.5 font-mono', KIND_PILL.tool.cls)}>{c.tool} tool</span>}
      {c.reason > 0 && <span className={cn('rounded px-1.5 py-0.5 font-mono', KIND_PILL.reason.cls)}>{c.reason} reason</span>}
      {c.gate > 0 && <span className={cn('rounded px-1.5 py-0.5 font-mono', KIND_PILL.gate.cls)}>{c.gate} gate</span>}
      {c.hardened > 0 && (
        <span className={cn('rounded px-1.5 py-0.5 font-mono', KIND_PILL.hardened.cls)}>{c.hardened} hardened</span>
      )}
    </div>
  )
}

function TriggerChip({ wf }: { wf: Workflow }) {
  if (wf.trigger === 'manual') {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
        <Hand className="h-3 w-3" /> Manual
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground" title={wf.schedule ?? ''}>
      <Calendar className="h-3 w-3" /> {wf.schedule ?? 'Schedule'}
    </span>
  )
}

/** Suggest a deterministic rule based on the reason step's prompt + output shape. */
function suggestRule(step: WorkflowStep): string {
  const shape = step.outputShape ? Object.keys(step.outputShape).join(', ') : 'value'
  const toolHint = step.allowedTools && step.allowedTools.length > 0 ? step.allowedTools[0] : 'match'
  return `if input matches a known signature, return { ${shape} } deterministically; else fall back to ${toolHint}`
}

// ----------------------------------------------------------------------------
// List
// ----------------------------------------------------------------------------

function WorkflowListCard({ wf, active, onClick }: { wf: Workflow; active: boolean; onClick: () => void }) {
  const counts = countKinds(wf.steps.steps)
  const autoPct = wf.itemsProcessed > 0 ? Math.round((wf.automaticCount / wf.itemsProcessed) * 100) : 0
  return (
    <motion.button
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      onClick={onClick}
      className={cn(
        'group w-full rounded-xl border bg-card p-3.5 text-left transition-colors',
        active ? 'border-primary/60 ring-1 ring-primary/20' : 'border-border hover:border-primary/40 hover:bg-accent/30',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium">{wf.name}</span>
            {counts.hardened > 0 && (
              <span className="inline-flex items-center gap-0.5 rounded bg-hardened/15 px-1 py-0.5 text-[9px] font-medium text-hardened">
                <Lock className="h-2.5 w-2.5" />
                {counts.hardened}
              </span>
            )}
          </div>
          <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{wf.description}</p>
        </div>
        <StatusBadge status={wf.status} />
      </div>

      <div className="mt-2.5 flex items-center gap-2">
        <TriggerChip wf={wf} />
        <span className="text-muted-foreground/40">·</span>
        <KindCounts steps={wf.steps.steps} />
      </div>

      <div className="mt-2.5 grid grid-cols-3 gap-2 border-t border-border/60 pt-2.5 text-[11px]">
        <div>
          <div className="font-mono text-foreground tabular-nums">{wf.runsCount}</div>
          <div className="text-muted-foreground">runs</div>
        </div>
        <div>
          <div className="font-mono text-foreground tabular-nums">{autoPct}%</div>
          <div className="text-muted-foreground">automatic</div>
        </div>
        <div>
          <div className="font-mono text-foreground tabular-nums">{formatCurrency(wf.estCostSavedCents)}</div>
          <div className="text-muted-foreground">saved</div>
        </div>
      </div>
    </motion.button>
  )
}

function ListSkeleton() {
  return (
    <div className="space-y-2.5">
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-32 w-full rounded-xl" />
      ))}
    </div>
  )
}

function EmptyList({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-card/40 p-8 text-center">
      <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
        <WorkflowIcon className="h-5 w-5" />
      </div>
      <h3 className="text-sm font-medium">No employees yet</h3>
      <p className="mx-auto mt-1 max-w-xs text-xs text-muted-foreground">
        Describe a job to the office manager, or deploy an Automation File from the Schema tab.
      </p>
      <Button size="sm" onClick={onCreate} className="mt-3 gap-1.5">
        <Sparkles className="h-3.5 w-3.5" />
        Describe a job
      </Button>
    </div>
  )
}

// ----------------------------------------------------------------------------
// Hardening panel
// ----------------------------------------------------------------------------

function HardenableStepCard({
  step,
  workflowId,
  patterns,
}: {
  step: WorkflowStep
  workflowId: string
  patterns: ExecutionPattern[]
}) {
  const { toast } = useToast()
  const harden = useHardenStep()
  const [rule, setRule] = React.useState('')
  const [touched, setTouched] = React.useState(false)
  const stepPatterns = patterns.filter((p) => p.stepId === step.id)
  const suggested = React.useMemo(() => suggestRule(step), [step])

  React.useEffect(() => {
    if (!touched) setRule(suggested)
  }, [suggested, touched])

  const submit = async () => {
    const r = rule.trim()
    if (!r) return
    try {
      await harden.mutateAsync({ id: workflowId, stepId: step.id, rule: r })
      toast({
        title: 'Step hardened',
        description: `"${step.label}" is now a deterministic rule — no AI needed.`,
      })
    } catch (e) {
      toast({ title: 'Could not harden step', description: (e as Error).message, variant: 'destructive' })
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl border border-hardened/30 bg-hardened/5 p-3.5"
    >
      <div className="flex items-start gap-2">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-reason/40 bg-reason/15 text-reason">
          <Brain className="h-3.5 w-3.5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-medium">{step.label}</span>
            <Badge variant="outline" className="border-hardened/40 text-hardened text-[10px]">
              <Sparkles className="h-2.5 w-2.5" />
              Hardenable
            </Badge>
          </div>
          {step.prompt && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{step.prompt}</p>}
        </div>
      </div>

      {/* Patterns observed for this step */}
      {stepPatterns.length > 0 && (
        <div className="mt-3 space-y-1.5">
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Patterns observed</div>
          {stepPatterns.map((p) => (
            <div key={p.id} className="rounded-lg border border-border/60 bg-card/60 p-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <code className="truncate font-mono text-[11px] text-foreground">{p.signature}</code>
                <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{p.occurrences}×</span>
              </div>
              {p.hardened && p.rule ? (
                <div className="mt-1 flex items-start gap-1.5 text-[11px] text-hardened">
                  <Lock className="mt-0.5 h-2.5 w-2.5 shrink-0" />
                  <code className="font-mono leading-relaxed break-words">{p.rule}</code>
                </div>
              ) : (
                <div className="mt-0.5 text-[10px] text-muted-foreground">
                  {p.occurrences >= 10 ? 'Ripe — hardened below to lock it in.' : `${10 - p.occurrences} more runs to ripen.`}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="mt-3 space-y-1.5">
        <FieldLabel>Rule</FieldLabel>
        <Input
          value={rule}
          onChange={(e) => {
            setTouched(true)
            setRule(e.target.value)
          }}
          placeholder={suggested}
          className="font-mono text-xs"
        />
        <Button size="sm" onClick={submit} disabled={harden.isPending || !rule.trim()} className="gap-1.5">
          {harden.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Lock className="h-3.5 w-3.5" />}
          Harden to rule
        </Button>
      </div>
    </motion.div>
  )
}

// Minimal inline field label so we don't pull in the form Label for a single use.
function FieldLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{children}</div>
}

// ----------------------------------------------------------------------------
// Detail
// ----------------------------------------------------------------------------

function DetailSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-24 w-full rounded-xl" />
      <Skeleton className="h-64 w-full rounded-xl" />
      <Skeleton className="h-40 w-full rounded-xl" />
    </div>
  )
}

function StatTile({
  label,
  value,
  sub,
  icon: Icon,
  accent,
}: {
  label: string
  value: React.ReactNode
  sub?: string
  icon: React.ComponentType<{ className?: string }>
  accent?: string
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-card/40 p-3">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
        <Icon className={cn('h-3.5 w-3.5', accent ?? 'text-muted-foreground')} />
      </div>
      <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground">{sub}</div>}
    </div>
  )
}

function WorkflowDetail({ workflowId, onBack }: { workflowId: string; onBack: () => void }) {
  const { data, isLoading } = useWorkflow(workflowId)
  const updateWf = useUpdateWorkflow()
  const runWf = useRunWorkflow()
  const { toast } = useToast()
  const selectRun = useAppStore((s) => s.selectRun)
  const setDevTab = useAppStore((s) => s.setDevTab)

  const wf = data?.workflow
  const patterns = data?.patterns ?? []

  const handleRun = async () => {
    if (!wf) return
    try {
      const { runId } = await runWf.mutateAsync({ id: wf.id, trigger: 'manual' })
      toast({ title: 'Run started', description: `Watching "${wf.name}" execute.` })
      selectRun(runId)
      setDevTab('runs')
    } catch (e) {
      toast({ title: 'Could not start run', description: (e as Error).message, variant: 'destructive' })
    }
  }

  const handleStatus = async (next: Workflow['status']) => {
    if (!wf) return
    try {
      await updateWf.mutateAsync({ id: wf.id, patch: { status: next } })
      toast({ title: next === 'active' ? 'Workflow activated' : next === 'paused' ? 'Workflow paused' : 'Workflow updated' })
    } catch (e) {
      toast({ title: 'Update failed', description: (e as Error).message, variant: 'destructive' })
    }
  }

  if (isLoading || !wf) return <DetailSkeleton />

  const counts = countKinds(wf.steps.steps)
  const autoPct = wf.itemsProcessed > 0 ? Math.round((wf.automaticCount / wf.itemsProcessed) * 100) : 0
  const hardenableSteps = wf.steps.steps.filter((s) => s.kind === 'reason' && !s.hardened)
  const hardenedSteps = wf.steps.steps.filter((s) => s.hardened)

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-4"
    >
      {/* Header card */}
      <Card className="p-4">
        <div className="flex items-start gap-3">
          <Button variant="ghost" size="icon" className="md:hidden -ml-2 h-8 w-8 shrink-0" onClick={onBack} aria-label="Back">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold leading-tight">{wf.name}</h2>
              <StatusBadge status={wf.status} />
              {wf.origin === 'agent' && (
                <Badge variant="outline" className="border-primary/30 text-primary text-[10px]">
                  <Sparkles className="h-2.5 w-2.5" />
                  Agent-built
                </Badge>
              )}
              {counts.hardened > 0 && (
                <Badge variant="outline" className="border-hardened/40 text-hardened text-[10px]">
                  <Lock className="h-2.5 w-2.5" />
                  Self-optimizing
                </Badge>
              )}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{wf.description}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
              <TriggerChip wf={wf} />
              <span className="text-muted-foreground/40">·</span>
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3 w-3" />
                Updated {relativeTime(wf.updatedAt)}
              </span>
              <span className="text-muted-foreground/40">·</span>
              <KindCounts steps={wf.steps.steps} />
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border/60 pt-3">
          <Button size="sm" onClick={handleRun} disabled={runWf.isPending} className="gap-1.5">
            {runWf.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            Run now
          </Button>
          {wf.status === 'active' && (
            <Button size="sm" variant="outline" onClick={() => handleStatus('paused')} disabled={updateWf.isPending} className="gap-1.5">
              <Pause className="h-3.5 w-3.5" />
              Pause
            </Button>
          )}
          {wf.status === 'paused' && (
            <Button size="sm" variant="outline" onClick={() => handleStatus('active')} disabled={updateWf.isPending} className="gap-1.5">
              <Play className="h-3.5 w-3.5" />
              Resume
            </Button>
          )}
          {wf.status === 'draft' && (
            <Button size="sm" variant="outline" onClick={() => handleStatus('active')} disabled={updateWf.isPending} className="gap-1.5">
              <Check className="h-3.5 w-3.5" />
              Activate
            </Button>
          )}
        </div>
      </Card>

      {/* The flow */}
      <Card className="p-4">
        <div className="mb-3 flex items-center gap-2">
          <WorkflowIcon className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-medium">Flow</h3>
          <span className="ml-auto text-[11px] text-muted-foreground">{wf.steps.steps.length} steps</span>
        </div>
        <WorkflowFlow steps={wf.steps.steps} />
      </Card>

      {/* Hardening panel */}
      {(hardenableSteps.length > 0 || hardenedSteps.length > 0 || patterns.length > 0) && (
        <Card className="p-4">
          <div className="mb-3 flex items-center gap-2">
            <Lock className="h-4 w-4 text-hardened" />
            <h3 className="text-sm font-medium">Self-optimization</h3>
            <span className="ml-auto text-[11px] text-muted-foreground">
              {hardenedSteps.length} hardened · {hardenableSteps.length} candidates
            </span>
          </div>
          <p className="mb-3 text-xs text-muted-foreground">
            When a <span className="text-reason">reason</span> step resolves the same way ~10+ times, Apical can flip it into a
            deterministic <span className="text-hardened">tool</span> rule. Same JSON, no AI, basically free.
          </p>

          {hardenableSteps.length > 0 && (
            <div className="space-y-3">
              <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Candidates</div>
              {hardenableSteps.map((s) => (
                <HardenableStepCard key={s.id} step={s} workflowId={wf.id} patterns={patterns} />
              ))}
            </div>
          )}

          {hardenedSteps.length > 0 && (
            <div className="mt-4 space-y-2">
              <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Hardened rules</div>
              {hardenedSteps.map((s) => (
                <div key={s.id} className="rounded-lg border border-hardened/30 bg-hardened/5 p-2.5">
                  <div className="flex items-center gap-1.5">
                    <Lock className="h-3 w-3 text-hardened" />
                    <span className="text-xs font-medium">{s.label}</span>
                  </div>
                  {s.rule && (
                    <code className="mt-1 block font-mono text-[11px] text-hardened break-words">{s.rule}</code>
                  )}
                </div>
              ))}
            </div>
          )}

          {hardenableSteps.length === 0 && hardenedSteps.length === 0 && patterns.length > 0 && (
            <div className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
              {patterns.length} pattern{patterns.length === 1 ? '' : 's'} observed. Run this workflow a few more times to ripen
              them into hardening candidates.
            </div>
          )}
        </Card>
      )}

      {/* Aggregate stats */}
      <Card className="p-4">
        <div className="mb-3 flex items-center gap-2">
          <TrendingDown className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-medium">Lifetime stats</h3>
        </div>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          <StatTile label="Runs" value={wf.runsCount} icon={Activity} accent="text-primary" />
          <StatTile label="Items processed" value={wf.itemsProcessed.toLocaleString()} icon={Zap} accent="text-foreground" />
          <StatTile label="Automatic" value={`${autoPct}%`} sub={`${wf.automaticCount.toLocaleString()} auto · ${wf.flaggedCount} flagged`} icon={Check} accent="text-emerald-500" />
          <StatTile label="Flagged" value={wf.flaggedCount} sub="for your review" icon={ShieldCheck} accent="text-gate-foreground" />
          <StatTile label="AI calls saved" value={wf.aiCallsSaved.toLocaleString()} sub="via hardening" icon={Brain} accent="text-reason" />
          <StatTile label="Est. cost saved" value={formatCurrency(wf.estCostSavedCents)} sub="vs. all-AI" icon={TrendingDown} accent="text-hardened" />
        </div>
      </Card>
    </motion.div>
  )
}

// ----------------------------------------------------------------------------
// View
// ----------------------------------------------------------------------------

export function WorkflowsView() {
  const { data: workflows, isLoading } = useWorkflows()
  const selectedWorkflowId = useAppStore((s) => s.selectedWorkflowId)
  const selectWorkflow = useAppStore((s) => s.selectWorkflow)
  const setMode = useAppStore((s) => s.setMode)

  const showDetail = !!selectedWorkflowId

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 md:px-6">
      {/* Mobile: toggle between list & detail */}
      <div className="md:hidden">
        {showDetail ? (
          <WorkflowDetail workflowId={selectedWorkflowId!} onBack={() => selectWorkflow(null)} />
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-medium">Employees</h2>
                <p className="text-[11px] text-muted-foreground">Your AI staff, as JSON.</p>
              </div>
              <Button size="sm" onClick={() => setMode('chat')} className="gap-1.5">
                <Plus className="h-3.5 w-3.5" />
                New
              </Button>
            </div>
            {isLoading ? <ListSkeleton /> : !workflows || workflows.length === 0 ? <EmptyList onCreate={() => setMode('chat')} /> : (
              <div className="space-y-2.5">
                {workflows.map((wf) => (
                  <WorkflowListCard
                    key={wf.id}
                    wf={wf}
                    active={false}
                    onClick={() => selectWorkflow(wf.id)}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Desktop: split list + detail */}
      <div className="hidden md:grid md:grid-cols-[320px_1fr] md:gap-4">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-medium">Employees</h2>
              <p className="text-[11px] text-muted-foreground">{workflows?.length ?? '—'} total</p>
            </div>
            <Button size="sm" onClick={() => setMode('chat')} className="gap-1.5">
              <Plus className="h-3.5 w-3.5" />
              New
            </Button>
          </div>
          <ScrollArea className="h-[calc(100vh-10rem)]">
            <div className="space-y-2.5 pr-2">
              {isLoading ? <ListSkeleton /> : !workflows || workflows.length === 0 ? <EmptyList onCreate={() => setMode('chat')} /> : (
                workflows.map((wf) => (
                  <WorkflowListCard
                    key={wf.id}
                    wf={wf}
                    active={wf.id === selectedWorkflowId}
                    onClick={() => selectWorkflow(wf.id)}
                  />
                ))
              )}
            </div>
          </ScrollArea>
        </div>

        <div>
          {showDetail ? (
            <WorkflowDetail workflowId={selectedWorkflowId!} onBack={() => selectWorkflow(null)} />
          ) : (
            <div className="flex h-[calc(100vh-10rem)] items-center justify-center">
              <div className="text-center">
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground">
                  <WorkflowIcon className="h-6 w-6" />
                </div>
                <h3 className="text-sm font-medium">Select an employee</h3>
                <p className="mt-1 max-w-xs text-xs text-muted-foreground">
                  Pick one from the list to inspect its flow, harden candidates, and see lifetime stats.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
