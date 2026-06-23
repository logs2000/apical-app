'use client'

import { cn } from '@/lib/utils'
import { STEP_KIND_META } from '@/lib/apical'
import type { StepKind } from '@/lib/types'
import { Wrench, Brain, ShieldCheck, Lock, Split } from 'lucide-react'

const ICON: Record<StepKind, React.ComponentType<{ className?: string }>> = {
  tool: Wrench,
  reason: Brain,
  gate: ShieldCheck,
  spawn: Split,
}

/** Small pill showing a step's kind with its semantic color. */
export function StepKindBadge({
  kind,
  hardened,
  size = 'sm',
  className,
}: {
  kind: StepKind
  hardened?: boolean
  size?: 'sm' | 'xs'
  className?: string
}) {
  if (hardened) {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1 rounded-md font-medium border border-hardened/40 bg-hardened/15 text-hardened',
          size === 'xs' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-xs',
          className,
        )}
      >
        <Lock className="h-3 w-3" />
        Hardened rule
      </span>
    )
  }
  const meta = STEP_KIND_META[kind]
  const Icon = ICON[kind]
  const colorVar = meta.color // 'tool' | 'reason' | 'gate'
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md font-medium border',
        size === 'xs' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-xs',
        kind === 'reason' && 'border-reason/40 bg-reason/15 text-reason',
        kind === 'tool' && 'border-tool/40 bg-tool/30 text-tool-foreground',
        kind === 'gate' && 'border-gate/40 bg-gate/15 text-gate-foreground',
        className,
      )}
      style={
        kind === 'tool'
          ? undefined
          : { color: `var(--color-${colorVar})` }
      }
    >
      <Icon className="h-3 w-3" />
      {meta.label}
    </span>
  )
}
