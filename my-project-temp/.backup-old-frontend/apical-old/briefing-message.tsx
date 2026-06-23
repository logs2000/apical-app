'use client'

import * as React from 'react'
import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { agentInitials, agentAvatarLightness, relativeTime, formatDuration } from '@/lib/apical'
import type { BriefingPayload } from '@/lib/types'
import type { Mention } from './mention'
import { MentionChip } from './mention'
import {
  AlertTriangle,
  ShieldCheck,
  ChevronRight,
  Sparkles,
  Clock,
  Check,
  X,
} from 'lucide-react'

type BriefingData = BriefingPayload

function NeedsAttentionItem({ item, onAction }: {
  item: BriefingData['needsAttention'][number]
  onAction: (action: string, item: BriefingData['needsAttention'][number], response: string) => void
}) {
  const [expanded, setExpanded] = React.useState(false)
  const [response, setResponse] = React.useState('')
  const [submitted, setSubmitted] = React.useState<string | null>(null)
  const Icon = item.kind === 'flagged_item' ? AlertTriangle : item.kind === 'approval_needed' ? ShieldCheck : AlertTriangle
  const cls = item.kind === 'flagged_item' ? 'text-gate-foreground' : item.kind === 'approval_needed' ? 'text-primary' : 'text-destructive'
  const isApproval = item.action === 'approve'
  const isAnswer = item.action === 'answer'

  const submit = (value: string) => {
    setSubmitted(value)
    onAction(item.action, item, value)
  }

  // After submission, show a compact resolved state.
  if (submitted) {
    const ok = isApproval ? submitted === 'Approve' : true
    return (
      <div className="flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-2">
        <Check className={cn('mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500')} />
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium leading-snug line-through opacity-70">{item.title}</div>
          <div className="text-[11px] text-emerald-500">
            {submitted}{isApproval ? (ok ? ' — approved' : ' — denied') : ''}
          </div>
        </div>
      </div>
    )
  }

  // Approvals: just Approve / Deny, no expansion needed.
  if (isApproval) {
    return (
      <div className="rounded-lg border border-border/60 bg-card/60 p-2">
        <div className="flex items-start gap-2">
          <Icon className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', cls)} />
          <div className="min-w-0 flex-1">
            <div className="text-xs font-medium leading-snug">{item.title}</div>
            <div className="text-[11px] text-muted-foreground">{item.detail}</div>
          </div>
        </div>
        <div className="mt-1.5 flex gap-1.5 pl-5">
          <Button size="sm" className="h-6 px-2.5 text-[10px]" onClick={() => submit('Approve')}>
            <Check className="mr-1 h-3 w-3" /> Approve
          </Button>
          <Button size="sm" variant="outline" className="h-6 px-2.5 text-[10px]" onClick={() => submit('Deny')}>
            <X className="mr-1 h-3 w-3" /> Deny
          </Button>
        </div>
      </div>
    )
  }

  // Answers (flagged items needing a decision): expandable inline.
  return (
    <div className="rounded-lg border border-border/60 bg-card/60 p-2">
      <button onClick={() => setExpanded(!expanded)} className="flex w-full items-start gap-2 text-left">
        <Icon className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', cls)} />
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium leading-snug">{item.title}</div>
          <div className="text-[11px] text-muted-foreground">{item.detail}</div>
        </div>
        <ChevronRight className={cn('mt-1 h-3 w-3 shrink-0 text-muted-foreground transition-transform', expanded && 'rotate-90')} />
      </button>
      {expanded && (
        <div className="mt-1.5 space-y-1.5 pl-5">
          <div className="flex flex-wrap gap-1">
            {['Yes', 'No', 'Not sure'].map((opt) => (
              <button
                key={opt}
                onClick={() => submit(opt)}
                className={cn(
                  'rounded-md border px-2 py-1 text-[11px] transition-colors',
                  response === opt ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:border-primary/40',
                )}
              >
                {opt}
              </button>
            ))}
          </div>
          <Textarea
            value={response}
            onChange={(e) => setResponse(e.target.value)}
            placeholder="Or type a custom answer…"
            rows={1}
            className="text-xs"
          />
          {response.trim() && !['Yes', 'No', 'Not sure'].includes(response) && (
            <Button size="sm" className="h-6 text-[10px]" onClick={() => submit(response.trim())}>
              Send answer
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

function ActivityRow({ a, onView }: {
  a: BriefingData['activity'][number]
  onView: (runId: string) => void
}) {
  return (
    <button
      onClick={() => onView(a.runId)}
      className="flex w-full items-center gap-2.5 rounded-lg border border-transparent px-1.5 py-1.5 text-left transition-colors hover:border-border hover:bg-accent/40"
    >
      <span
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-primary-foreground"
        style={{ backgroundColor: `oklch(${agentAvatarLightness(a.agentName)} 0.08 155)` }}
      >
        {agentInitials(a.agentName)}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-xs font-medium">{a.agentName}</span>
          <span className="text-[10px] text-muted-foreground">{relativeTime(a.startedAt)}</span>
        </div>
        <div className="truncate text-[11px] text-muted-foreground">{a.summary}</div>
      </div>
      <div className="shrink-0 text-right">
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <Clock className="h-2.5 w-2.5" />
          {formatDuration(a.durationMs)}
        </div>
        {a.flaggedCount > 0 && (
          <div className="text-[10px] text-gate-foreground">{a.flaggedCount} flagged</div>
        )}
      </div>
      <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/50" />
    </button>
  )
}

export function BriefingMessage({ briefing, onAction, onViewRun, onAsk }: {
  briefing: BriefingData
  onAction: (action: string, item: BriefingData['needsAttention'][number], response: string) => void
  onViewRun: (runId: string) => void
  onAsk: (prompt: string, mentions?: Mention[]) => void
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-2.5"
    >
      {/* Secretary summary — the message itself */}
      <p className="text-sm leading-relaxed text-foreground/90">{briefing.summary}</p>

      {/* Needs attention */}
      {briefing.needsAttention.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-gate-foreground">
            <AlertTriangle className="h-2.5 w-2.5" />
            Needs your attention ({briefing.needsAttention.length})
          </div>
          {briefing.needsAttention.map((item) => (
            <NeedsAttentionItem key={item.id} item={item} onAction={onAction} />
          ))}
        </div>
      )}

      {/* Recent activity */}
      {briefing.activity.length > 0 && (
        <div className="space-y-0.5">
          <div className="px-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Recent activity
          </div>
          {briefing.activity.slice(0, 4).map((a) => (
            <ActivityRow key={a.runId} a={a} onView={onViewRun} />
          ))}
        </div>
      )}

      {/* Quick ask */}
      <div className="flex flex-wrap gap-1.5 pt-1">
        <Button size="sm" variant="outline" className="h-7 text-[11px]"
          onClick={() => onAsk('Give me more detail on the flagged items')}>
          Tell me more
        </Button>
        <Button size="sm" variant="outline" className="h-7 text-[11px]"
          onClick={() => onAsk('What should I prioritize today?')}>
          What should I prioritize?
        </Button>
        {briefing.needsAttention[0] && (
          <Button size="sm" variant="outline" className="h-7 text-[11px]"
            onClick={() => onAsk(`What's going on with the ${briefing.needsAttention[0].agentName} flag?`, [{ id: briefing.needsAttention[0].agentId, name: briefing.needsAttention[0].agentName, department: '' }])}>
            <MentionChip mention={{ id: briefing.needsAttention[0].agentId, name: briefing.needsAttention[0].agentName, department: '' }} size="sm" /> ask about it
          </Button>
        )}
      </div>
    </motion.div>
  )
}
