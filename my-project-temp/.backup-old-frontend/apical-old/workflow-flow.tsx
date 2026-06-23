'use client'

import { cn } from '@/lib/utils'
import type { WorkflowStep, RunStepStatus, StepKind } from '@/lib/types'
import { StepKindBadge } from './step-badge'
import { motion } from 'framer-motion'
import {
  Check,
  Loader2,
  AlertTriangle,
  ChevronRight,
  Wrench,
  Brain,
  ShieldCheck,
  Lock,
  Sparkles,
} from 'lucide-react'

const KIND_ICON: Record<StepKind, React.ComponentType<{ className?: string }>> = {
  tool: Wrench,
  reason: Brain,
  gate: ShieldCheck,
}

const STATUS_STYLE: Record<RunStepStatus, { ring: string; dot: string; icon?: React.ComponentType<{ className?: string }> }> = {
  pending: { ring: 'border-border', dot: 'bg-muted-foreground/40' },
  running: { ring: 'border-primary/60 ring-1 ring-primary/30', dot: 'bg-primary', icon: Loader2 },
  completed: { ring: 'border-emerald-500/30', dot: 'bg-emerald-500', icon: Check },
  flagged: { ring: 'border-gate/50', dot: 'bg-gate', icon: AlertTriangle },
  skipped: { ring: 'border-border', dot: 'bg-muted-foreground/30' },
  awaiting: { ring: 'border-gate/50', dot: 'bg-gate', icon: ShieldCheck },
  failed: { ring: 'border-destructive/50', dot: 'bg-destructive', icon: AlertTriangle },
}

export interface StepRenderState {
  status?: RunStepStatus
  message?: string
  output?: unknown
  aiTokens?: number
  aiCostCents?: number
}

/** A single step rendered as a card. Used both in static workflow views and live run traces. */
export function StepCard({
  step,
  index,
  state,
  compact = false,
}: {
  step: WorkflowStep
  index: number
  state?: StepRenderState
  compact?: boolean
}) {
  const Icon = step.hardened ? Lock : KIND_ICON[step.kind]
  const status = state?.status
  const statusStyle = status ? STATUS_STYLE[status] : null
  const StatusIcon = statusStyle?.icon

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: index * 0.03 }}
      className={cn(
        'relative rounded-xl border bg-card/80 backdrop-blur-sm transition-colors',
        compact ? 'p-3' : 'p-4',
        statusStyle?.ring ?? 'border-border',
        status === 'running' && 'shadow-[0_0_0_1px_color-mix(in_oklch,var(--primary)_30%,transparent)]',
      )}
    >
      <div className="flex items-start gap-3">
        {/* Index / kind icon */}
        <div
          className={cn(
            'flex shrink-0 items-center justify-center rounded-lg border font-mono text-xs font-semibold',
            compact ? 'h-8 w-8' : 'h-9 w-9',
            step.hardened
              ? 'border-hardened/40 bg-hardened/15 text-hardened'
              : step.kind === 'reason'
                ? 'border-reason/40 bg-reason/15 text-reason'
                : step.kind === 'gate'
                  ? 'border-gate/40 bg-gate/15 text-gate-foreground'
                  : 'border-border bg-muted text-muted-foreground',
            status === 'running' && 'animate-pulse-soft',
          )}
        >
          <Icon className={cn('h-4 w-4', status === 'running' && 'animate-spin')} />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium leading-tight">{step.label}</span>
            <StepKindBadge kind={step.kind} hardened={step.hardened} size="xs" />
            {step.http ? (
              <span className="inline-flex items-center gap-1 rounded bg-primary/10 px-1.5 py-0.5 font-mono text-[10px]">
                <span className="font-semibold text-primary">{step.http.method}</span>
                <span className="max-w-[180px] truncate text-muted-foreground">{step.http.url}</span>
              </span>
            ) : step.tool && !step.hardened ? (
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                {step.tool}
              </code>
            ) : null}
            {status && statusStyle && (
              <span className="ml-auto flex items-center gap-1 text-[11px] text-muted-foreground">
                {StatusIcon && (
                  <StatusIcon className={cn('h-3 w-3', status === 'running' && 'animate-spin')} />
                )}
                {status}
              </span>
            )}
          </div>

          {/* Detail line */}
          {!compact && (
            <div className="mt-1.5 space-y-1">
              {step.hardened && step.rule && (
                <p className="flex items-start gap-1.5 text-xs text-hardened">
                  <Sparkles className="mt-0.5 h-3 w-3 shrink-0" />
                  <span className="font-mono leading-relaxed">{step.rule}</span>
                </p>
              )}
              {!step.hardened && step.kind === 'reason' && step.prompt && (
                <p className="text-xs text-muted-foreground line-clamp-2">{step.prompt}</p>
              )}
              {!step.hardened && step.kind === 'gate' && step.gateMessage && (
                <p className="text-xs text-gate-foreground/80">{step.gateMessage}</p>
              )}
              {step.note && (
                <p className="text-[11px] text-muted-foreground/70 italic">{step.note}</p>
              )}
            </div>
          )}

          {/* Live message during execution */}
          {state?.message && status === 'running' && (
            <p className="mt-1.5 flex items-center gap-1.5 text-xs text-primary">
              <Loader2 className="h-3 w-3 animate-spin" />
              {state.message}
            </p>
          )}

          {/* Output preview when completed */}
          {state?.output && status && (status === 'completed' || status === 'flagged') && (
            <div className="mt-2 rounded-md bg-muted/50 px-2 py-1 font-mono text-[11px] text-muted-foreground">
              {formatOutput(state.output)}
            </div>
          )}

          {/* AI cost badge */}
          {state?.aiTokens ? (
            <div className="mt-1.5 flex items-center gap-2 text-[10px] text-muted-foreground">
              <span className="inline-flex items-center gap-1 rounded bg-reason/10 px-1.5 py-0.5 text-reason">
                <Brain className="h-2.5 w-2.5" />
                {state.aiTokens.toLocaleString()} tokens
              </span>
              {state.aiCostCents ? <span>≈ {state.aiCostCents}¢</span> : null}
            </div>
          ) : null}
        </div>
      </div>
    </motion.div>
  )
}

function formatOutput(output: unknown): string {
  if (typeof output === 'string') return output
  try {
    const obj = output as Record<string, unknown>
    const parts: string[] = []
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'object' && v !== null) continue
      parts.push(`${k}: ${v}`)
    }
    return parts.slice(0, 4).join('  ·  ')
  } catch {
    return JSON.stringify(output)
  }
}

/** A vertical flow of steps with connecting lines. */
export function WorkflowFlow({
  steps,
  states,
  compact = false,
}: {
  steps: WorkflowStep[]
  states?: Record<string, StepRenderState>
  compact?: boolean
}) {
  return (
    <div className="flex flex-col">
      {steps.map((step, i) => (
        <div key={step.id} className="relative">
          <StepCard step={step} index={i} state={states?.[step.id]} compact={compact} />
          {i < steps.length - 1 && (
            <div className="flex justify-start pl-5">
              <div className="flex flex-col items-center">
                <ChevronRight className="h-3.5 w-3.5 -rotate-90 text-muted-foreground/40" />
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
