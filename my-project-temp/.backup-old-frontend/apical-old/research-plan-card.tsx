'use client'

import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { WorkflowFlow } from './workflow-flow'
import type { ResearchPlan } from '@/lib/types'
import {
  Globe, Search, Code2, Clock, DollarSign, KeyRound,
  CheckCircle2, ArrowRight, Sparkles, AlertTriangle,
} from 'lucide-react'

export function ResearchPlanCard({
  plan,
  onApprove,
  onTweak,
}: {
  plan: ResearchPlan
  onApprove?: () => void
  onTweak?: () => void
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="overflow-hidden rounded-xl border border-primary/30 bg-card"
    >
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border/60 bg-primary/5 px-3 py-2">
        <Search className="h-3.5 w-3.5 text-primary" />
        <span className="text-xs font-semibold">Research plan</span>
        <span className="ml-auto text-[10px] text-muted-foreground">
          {plan.findings.length} sources · {plan.proposedWorkflow.steps.length} steps
        </span>
      </div>

      <div className="space-y-3 p-3">
        {/* Goal */}
        <div className="rounded-lg border border-border/60 bg-muted/30 p-2">
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Goal</div>
          <div className="text-xs font-medium">{plan.goal}</div>
        </div>

        {/* Strategy */}
        <div>
          <div className="mb-1 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            <Sparkles className="h-2.5 w-2.5" /> Strategy
          </div>
          <p className="text-xs leading-relaxed text-foreground/90">{plan.strategy}</p>
        </div>

        {/* Findings */}
        {plan.findings.length > 0 && (
          <div>
            <div className="mb-1 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              <Globe className="h-2.5 w-2.5" /> Data sources found
            </div>
            <div className="space-y-1.5">
              {plan.findings.slice(0, 5).map((f, i) => (
                <div key={i} className="rounded-lg border border-border/60 bg-card/60 p-2">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-xs font-medium">{f.source}</span>
                    <Badge variant="outline" className="text-[9px] capitalize">{f.type}</Badge>
                    {f.rateLimit && (
                      <span className="ml-auto flex items-center gap-0.5 text-[9px] text-muted-foreground">
                        <Clock className="h-2 w-2" /> {f.rateLimit}
                      </span>
                    )}
                  </div>
                  <div className="truncate text-[11px] text-muted-foreground">{f.url}</div>
                  {f.endpoints && f.endpoints.length > 0 && (
                    <div className="mt-1 space-y-0.5">
                      {f.endpoints.slice(0, 3).map((e, j) => (
                        <div key={j} className="flex items-center gap-1 font-mono text-[10px] text-muted-foreground">
                          <span className="rounded bg-primary/15 px-0.5 text-primary">{e.method}</span>
                          <span className="truncate">{e.path}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Proposed workflow */}
        <div>
          <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            <Code2 className="h-2.5 w-2.5" /> Proposed workflow
          </div>
          <div className="max-h-[260px] overflow-y-auto rounded-lg border border-border/60 bg-muted/10 p-2">
            <WorkflowFlow steps={plan.proposedWorkflow.steps} compact />
          </div>
        </div>

        {/* Schedule + cost + credentials */}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <div className="rounded-lg border border-border/60 bg-card/60 p-2">
            <div className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              <Clock className="h-2.5 w-2.5" /> Schedule
            </div>
            <div className="mt-0.5 text-xs font-medium">{plan.scheduleRecommendation.frequency}</div>
            <div className="text-[10px] text-muted-foreground">{plan.scheduleRecommendation.reason}</div>
          </div>
          <div className="rounded-lg border border-border/60 bg-card/60 p-2">
            <div className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              <DollarSign className="h-2.5 w-2.5" /> Est. cost/run
            </div>
            <div className="mt-0.5 text-xs font-medium">{plan.estimatedCost}</div>
          </div>
          <div className="rounded-lg border border-border/60 bg-card/60 p-2">
            <div className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              <KeyRound className="h-2.5 w-2.5" /> Credentials needed
            </div>
            <div className="mt-0.5 text-xs font-medium">
              {plan.needsCredentials.length === 0 ? 'None' : plan.needsCredentials.map((c) => c.service).join(', ')}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 border-t border-border/60 pt-2">
          <Button size="sm" onClick={onApprove} className="text-xs">
            <CheckCircle2 className="mr-1 h-3 w-3" /> Approve &amp; create agent
          </Button>
          <Button size="sm" variant="outline" onClick={onTweak} className="text-xs">
            Tweak
          </Button>
          <span className="ml-auto text-[10px] text-muted-foreground">
            The AI only thinks at the <span className="text-reason">reason</span> steps. Everything else runs mechanically.
          </span>
        </div>
      </div>
    </motion.div>
  )
}
