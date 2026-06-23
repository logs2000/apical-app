'use client'

import { cn } from '@/lib/utils'
import { Monitor, Cloud } from 'lucide-react'
import type { AgentRuntime } from '@/lib/types'

/** A small badge showing where an agent runs — local (desktop) or hosted (cloud). */
export function RuntimeBadge({ runtime, size = 'xs' }: { runtime: AgentRuntime; size?: 'xs' | 'sm' }) {
  const isLocal = runtime === 'local'
  const Icon = isLocal ? Monitor : Cloud
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md border font-medium',
        size === 'xs' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-xs',
        isLocal
          ? 'border-primary/30 bg-primary/10 text-primary'
          : 'border-border bg-muted text-muted-foreground',
      )}
      title={isLocal ? 'Runs on your machine (desktop app) — has filesystem, CLI, and network access' : 'Runs on the Apical server — accessible from anywhere, no direct filesystem access'}
    >
      <Icon className={size === 'xs' ? 'h-2.5 w-2.5' : 'h-3 w-3'} />
      {isLocal ? 'Local' : 'Hosted'}
    </span>
  )
}
