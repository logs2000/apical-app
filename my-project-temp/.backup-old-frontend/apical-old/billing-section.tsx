'use client'

// In-app billing dashboard — for the Settings "Billing" section.
//
// Renders:
//   1. Current plan card       — plan name + badge, status, current period end.
//                                 Free → "Upgrade" CTA (scrolls to plan options).
//                                 Paid → "Manage billing" (portal) + "Cancel" (subtle).
//   2. Usage this period       — big number used/allowance, progress bar (emerald;
//                                 amber >80%; red if over), overage tokens,
//                                 "Resets on <date>".
//   3. Overrun billing toggle  — Switch + explanation. Disabled (with tooltip)
//                                 on the Free plan.
//   4. Usage by model          — small table from /api/usage `byModel` +
//                                 recharts bar chart of tokens by day.
//   5. Plan options            — <PricingCards currentPlan={plan} /> so the user
//                                 can upgrade inline.
//   6. Demo-mode banner        — subtle amber note when billing is in demo mode.
//
// Fetches /api/billing/subscription + /api/usage on mount. Mutates via
// /api/billing/overrun (toggle), /api/billing/portal (manage/cancel).

import * as React from 'react'
import { motion } from 'framer-motion'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import {
  CreditCard,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  ExternalLink,
  Loader2,
  Info,
  Zap,
  TrendingUp,
  Calendar,
  ArrowDownToLine,
  Receipt,
  Cpu,
} from 'lucide-react'
import { PricingCards } from './pricing-cards'
import type { PlanDefinition, PlanId } from '@/lib/platform/pricing'

// ---------------- Types (mirror of the API responses) ----------------

interface SubscriptionRow {
  id: string
  plan: PlanId
  status: string
  currentPeriodEnd: string | null
  tokenAllowanceMonthly: number
  tokenUsedMonthly: number
  tokenOverageMonthly: number
  overrunEnabled: boolean
  overrunRateCentsPer1M: number
  overageAccruedCents: number
  canceledAt: string | null
}

interface BillingSubscriptionResponse {
  subscription: SubscriptionRow
  plan: PlanDefinition
  usage: {
    used: number
    allowance: number
    overage: number
    overrunEnabled: boolean
    periodEnd: string | null
  }
  overrunAvailable: boolean
  demoMode: boolean
}

interface UsageByModel {
  modelId: string
  provider: string
  totalTokens: number
  costCents: number
  calls: number
}

interface UsageByDay {
  date: string
  tokens: number
  costCents: number
}

interface UsageResponse {
  current: {
    used: number
    allowance: number
    overage: number
    overrunEnabled: boolean
    periodEnd: string | null
    plan: PlanId
  }
  byModel: UsageByModel[]
  byDay: UsageByDay[]
}

// ---------------- The component ----------------

export function BillingSection() {
  const { toast } = useToast()
  const [billing, setBilling] = React.useState<BillingSubscriptionResponse | null>(null)
  const [usage, setUsage] = React.useState<UsageResponse | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [overrunBusy, setOverrunBusy] = React.useState(false)
  const [portalBusy, setPortalBusy] = React.useState(false)
  const [cancelOpen, setCancelOpen] = React.useState(false)
  const [cancelBusy, setCancelBusy] = React.useState(false)
  const planOptionsRef = React.useRef<HTMLDivElement | null>(null)

  // ---- Initial fetch ----
  const refresh = React.useCallback(async () => {
    const [billRes, useRes] = await Promise.all([
      fetch('/api/billing/subscription'),
      fetch('/api/usage'),
    ])
    if (billRes.ok) {
      const data = (await billRes.json()) as BillingSubscriptionResponse
      setBilling(data)
    }
    if (useRes.ok) {
      const data = (await useRes.json()) as UsageResponse
      setUsage(data)
    }
  }, [])

  React.useEffect(() => {
    let active = true
    setLoading(true)
    refresh()
      .catch((err) => {
        if (!active) return
        toast({
          title: 'Could not load billing',
          description: err instanceof Error ? err.message : 'Unknown error',
          variant: 'destructive',
        })
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [refresh, toast])

  // ---- Handle ?billing_demo=success / ?billing=success / ?billing=canceled ----
  React.useEffect(() => {
    if (typeof window === 'undefined') return
    const url = new URL(window.location.href)
    const demoSuccess = url.searchParams.get('billing_demo')
    const realStatus = url.searchParams.get('billing')
    const plan = url.searchParams.get('plan')
    const interval = url.searchParams.get('interval')

    if (demoSuccess === 'success' && plan) {
      toast({
        title: 'Plan updated',
        description: `You are now on the ${plan} plan${
          interval ? ` (${interval})` : ''
        }. Demo mode — no card was charged.`,
      })
    } else if (demoSuccess === 'portal') {
      toast({
        title: 'Billing portal (demo)',
        description: 'Demo mode — manage your subscription via the in-app controls below.',
      })
    } else if (realStatus === 'success') {
      toast({
        title: 'Thanks for upgrading!',
        description: 'Your subscription is being processed. Refresh in a moment to see your new plan.',
      })
    } else if (realStatus === 'canceled') {
      toast({
        title: 'Checkout canceled',
        description: 'No changes were made to your plan.',
      })
    } else if (realStatus === 'portal') {
      // No toast — returning from the portal, nothing to announce.
    }

    if (demoSuccess || realStatus) {
      url.searchParams.delete('billing_demo')
      url.searchParams.delete('billing')
      url.searchParams.delete('plan')
      url.searchParams.delete('interval')
      window.history.replaceState({}, '', url.toString())
    }
  }, [toast])

  // ---- Actions ----

  const handleToggleOverrun = React.useCallback(
    async (enabled: boolean) => {
      if (!billing) return
      // Optimistic update.
      setBilling({
        ...billing,
        subscription: {
          ...billing.subscription,
          overrunEnabled: enabled,
          overrunRateCentsPer1M: enabled ? billing.plan.overrunRateCentsPer1M : 0,
        },
      })
      setOverrunBusy(true)
      try {
        const res = await fetch('/api/billing/overrun', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled }),
        })
        if (!res.ok) {
          const e = (await res.json().catch(() => ({}))) as { error?: string }
          throw new Error(e.error || `Failed (${res.status})`)
        }
        toast({
          title: enabled ? 'Overrun billing on' : 'Overrun billing off',
          description: enabled
            ? `Billed at $${(billing.plan.overrunRateCentsPer1M / 100).toFixed(2)} / 1M tokens after your included quota.`
            : 'You will be hard-stopped at your allowance.',
        })
        await refresh()
      } catch (err) {
        // Roll back.
        setBilling(billing)
        toast({
          title: 'Could not toggle overrun',
          description: err instanceof Error ? err.message : 'Unknown error',
          variant: 'destructive',
        })
      } finally {
        setOverrunBusy(false)
      }
    },
    [billing, refresh, toast],
  )

  const openPortal = React.useCallback(async () => {
    setPortalBusy(true)
    try {
      const res = await fetch('/api/billing/portal', { method: 'POST' })
      if (!res.ok) {
        const e = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(e.error || `Failed (${res.status})`)
      }
      const data = (await res.json()) as { url: string; demoMode?: boolean }
      if (data.url) {
        // Demo URL is "/?billing_demo=portal" — in demo mode, just reload.
        // Real URL is Stripe's hosted portal.
        window.location.href = data.url
      }
    } catch (err) {
      toast({
        title: 'Could not open billing portal',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      })
      setPortalBusy(false)
    }
  }, [toast])

  const confirmCancel = React.useCallback(async () => {
    if (!billing?.demoMode) {
      // Real Stripe — open the portal, where cancellation lives.
      setCancelBusy(true)
      try {
        const res = await fetch('/api/billing/portal', { method: 'POST' })
        if (!res.ok) throw new Error(`Failed (${res.status})`)
        const data = (await res.json()) as { url: string }
        if (data.url) window.location.href = data.url
      } catch (err) {
        toast({
          title: 'Could not open billing portal',
          description: err instanceof Error ? err.message : 'Unknown error',
          variant: 'destructive',
        })
        setCancelBusy(false)
        setCancelOpen(false)
      }
      return
    }
    // Demo mode — there is no real subscription to cancel. Explain and close.
    toast({
      title: 'Demo mode',
      description:
        'Billing is in demo mode — there is no real subscription to cancel. Set STRIPE_SECRET_KEY to enable real Stripe billing.',
    })
    setCancelOpen(false)
  }, [billing?.demoMode, toast])

  const scrollToPlans = React.useCallback(() => {
    planOptionsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  // ---- Render ----

  if (loading || !billing) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-28 rounded-xl" />
        <Skeleton className="h-40 rounded-xl" />
        <Skeleton className="h-24 rounded-xl" />
      </div>
    )
  }

  const sub = billing.subscription
  const plan = billing.plan
  const isFree = sub.plan === 'free'
  const isPaid = !isFree
  const isEnterprise = sub.plan === 'enterprise'

  // Usage math.
  const allowance = sub.tokenAllowanceMonthly || plan.tokenAllowanceMonthly
  const used = sub.tokenUsedMonthly
  const overage = Math.max(0, used - allowance)
  const isUnlimited = allowance <= 0 // enterprise
  const pct = isUnlimited ? 0 : Math.min(100, allowance > 0 ? (used / allowance) * 100 : 0)
  const usageState: 'normal' | 'near' | 'over' = isUnlimited
    ? 'normal'
    : used >= allowance
      ? 'over'
      : pct >= 80
        ? 'near'
        : 'normal'

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="space-y-5"
    >
      {/* ---------------- Demo banner ---------------- */}
      {billing.demoMode && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-[11px] text-amber-700 dark:text-amber-400">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div>
            <span className="font-medium">Demo billing</span> — no real charges.
            Set <code className="font-mono">STRIPE_SECRET_KEY</code> in your environment to go live.
            Plan changes apply instantly so you can test the full flow.
          </div>
        </div>
      )}

      {/* ---------------- Current plan ---------------- */}
      <Card className="overflow-hidden">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <CreditCard className="h-4 w-4 text-primary" />
            <CardTitle className="text-sm">Current plan</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-lg font-semibold">{plan.name}</span>
                <PlanStatusBadge status={sub.status} />
                {plan.featured && (
                  <Badge
                    variant="outline"
                    className="border-primary/40 bg-primary/5 text-primary"
                  >
                    <Sparkles className="mr-0.5 h-2.5 w-2.5" /> Most popular
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground">{plan.tagline}</p>
              <div className="flex items-center gap-1.5 pt-1 text-[11px] text-muted-foreground">
                <Calendar className="h-3 w-3" />
                <span>
                  {sub.canceledAt
                    ? `Canceled — ends ${formatDate(sub.currentPeriodEnd)}`
                    : isPaid
                      ? `Renews ${formatDate(sub.currentPeriodEnd)}`
                      : `Resets ${formatDate(sub.currentPeriodEnd)}`}
                </span>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {isPaid ? (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={openPortal}
                    disabled={portalBusy}
                  >
                    {portalBusy ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <ExternalLink className="h-3.5 w-3.5" />
                    )}
                    <span className="ml-1">Manage billing</span>
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setCancelOpen(true)}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    Cancel
                  </Button>
                </>
              ) : (
                <Button size="sm" onClick={scrollToPlans}>
                  <ArrowDownToLine className="h-3.5 w-3.5" />
                  <span className="ml-1">Upgrade</span>
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ---------------- Usage this period ---------------- */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-primary" />
            <CardTitle className="text-sm">Usage this period</CardTitle>
          </div>
          <CardDescription className="text-xs">
            Token usage across all hosted models since the start of your billing period.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-semibold tracking-tight">
              {formatTokens(used)}
            </span>
            <span className="text-sm text-muted-foreground">
              {isUnlimited ? 'tokens used (unlimited plan)' : `/ ${formatTokens(allowance)} tokens`}
            </span>
          </div>

          {!isUnlimited && (
            <>
              <UsageBar state={usageState} pct={pct} />
              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span>
                  {pct.toFixed(0)}% used
                  {overage > 0 && (
                    <span className="ml-1.5 text-red-500">
                      · {formatTokens(overage)} overage
                    </span>
                  )}
                </span>
                <span>Resets on {formatDate(sub.currentPeriodEnd)}</span>
              </div>
            </>
          )}

          {isUnlimited && (
            <div className="text-[11px] text-muted-foreground">
              Resets on {formatDate(sub.currentPeriodEnd)}.
            </div>
          )}

          {overage > 0 && (
            <div
              className={cn(
                'mt-1 flex items-start gap-2 rounded-lg border p-2.5 text-[11px]',
                usageState === 'over'
                  ? 'border-red-500/30 bg-red-500/5 text-red-700 dark:text-red-300'
                  : 'border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-400',
              )}
            >
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <div>
                You have exceeded your included quota by{' '}
                <span className="font-medium">{formatTokens(overage)}</span> tokens.
                {sub.overrunEnabled
                  ? ` You will be billed at $${(sub.overrunRateCentsPer1M / 100).toFixed(2)} / 1M tokens for the overage.`
                  : ' Overrun billing is off — your agents may be hard-stopped. Enable it below to keep them running.'}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ---------------- Overrun toggle ---------------- */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-primary" />
            <CardTitle className="text-sm">Overrun billing</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <p className="text-xs leading-relaxed text-foreground/80">
                Pay-as-you-go overrun billing —{' '}
                <span className="font-medium">
                  ${(plan.overrunRateCentsPer1M / 100).toFixed(2)} / 1M tokens
                </span>{' '}
                after your included quota. Only charged if you exceed your plan.
              </p>
              <p className="text-[11px] text-muted-foreground">
                Without overrun billing, your agents are hard-stopped at the allowance. With it,
                they keep running and you pay for the extra tokens at your plan&apos;s rate.
              </p>
            </div>
            <div className="flex shrink-0 items-center pt-0.5">
              {billing.overrunAvailable ? (
                <Switch
                  checked={sub.overrunEnabled}
                  onCheckedChange={handleToggleOverrun}
                  disabled={overrunBusy}
                  aria-label="Toggle overrun billing"
                />
              ) : (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      {/* Span wrapper because Switch's disabled state still needs a hover target. */}
                      <span className="inline-flex">
                        <Switch checked={false} disabled aria-label="Overrun billing disabled" />
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="left">
                      Upgrade to Pro to enable overrun billing.
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
            </div>
          </div>

          {sub.overrunEnabled && (
            <div className="mt-3 flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/5 p-2 text-[11px] text-primary">
              <CheckCircle2 className="h-3.5 w-3.5" />
              <span>
                Overrun billing is on at{' '}
                <span className="font-medium">
                  ${(sub.overrunRateCentsPer1M / 100).toFixed(2)} / 1M tokens
                </span>
                . Rate is locked in for this billing period.
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ---------------- Usage by model + by day ---------------- */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Cpu className="h-4 w-4 text-primary" />
            <CardTitle className="text-sm">Usage breakdown</CardTitle>
          </div>
          <CardDescription className="text-xs">
            Tokens by model and by day for the current billing period.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <UsageByModelTable rows={usage?.byModel ?? []} />

          <div>
            <h4 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Tokens by day
            </h4>
            <UsageByDayChart data={usage?.byDay ?? []} />
          </div>
        </CardContent>
      </Card>

      {/* ---------------- Plan options (inline upgrade) ---------------- */}
      <div ref={planOptionsRef} className="scroll-mt-4">
        <div className="mb-3 flex items-center gap-2">
          <Receipt className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Plans</h3>
          {isEnterprise && (
            <Badge variant="outline" className="text-[10px] text-muted-foreground">
              You are on Enterprise
            </Badge>
          )}
        </div>
        <PricingCards currentPlan={sub.plan} />
      </div>

      {/* ---------------- Cancel confirmation ---------------- */}
      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Cancel your {plan.name} plan?</DialogTitle>
            <DialogDescription>
              {billing.demoMode
                ? 'Billing is in demo mode — there is no real subscription to cancel. To test the real cancellation flow, set STRIPE_SECRET_KEY in your environment and use the Stripe billing portal.'
                : `You will be redirected to the Stripe billing portal, where you can cancel your subscription. Your plan remains active until ${formatDate(
                    sub.currentPeriodEnd,
                  )}.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCancelOpen(false)}
              disabled={cancelBusy}
            >
              Keep my plan
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={confirmCancel}
              disabled={cancelBusy}
            >
              {cancelBusy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <ExternalLink className="h-3.5 w-3.5" />
              )}
              <span className="ml-1">
                {billing.demoMode ? 'Understood' : 'Open portal to cancel'}
              </span>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </motion.div>
  )
}

export default BillingSection

// ---------------- Sub-components ----------------

function PlanStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    active: {
      label: 'Active',
      className: 'border-primary/30 bg-primary/5 text-primary',
    },
    trialing: {
      label: 'Trial',
      className: 'border-primary/30 bg-primary/5 text-primary',
    },
    past_due: {
      label: 'Past due',
      className: 'border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-400',
    },
    canceled: {
      label: 'Canceled',
      className: 'border-red-500/40 bg-red-500/5 text-red-700 dark:text-red-300',
    },
  }
  const entry = map[status] ?? {
    label: status,
    className: 'border-border bg-muted text-muted-foreground',
  }
  return (
    <Badge variant="outline" className={cn('text-[10px]', entry.className)}>
      {entry.label}
    </Badge>
  )
}

function UsageBar({
  state,
  pct,
}: {
  state: 'normal' | 'near' | 'over'
  pct: number
}) {
  const colorClass =
    state === 'over'
      ? 'bg-red-500'
      : state === 'near'
        ? 'bg-amber-500'
        : 'bg-primary'
  return (
    <div
      className="relative h-2.5 w-full overflow-hidden rounded-full bg-muted"
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <motion.div
        className={cn('h-full rounded-full transition-colors', colorClass)}
        initial={{ width: 0 }}
        animate={{ width: `${pct}%` }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
      />
    </div>
  )
}

function UsageByModelTable({ rows }: { rows: UsageByModel[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
        No usage yet this period. Run a workflow with a hosted model to see it here.
      </div>
    )
  }
  return (
    <div className="max-h-64 overflow-y-auto rounded-lg border border-border">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-muted/60 backdrop-blur">
          <tr className="border-b border-border text-left text-[10px] uppercase tracking-wide text-muted-foreground">
            <th className="px-3 py-2 font-medium">Model</th>
            <th className="px-3 py-2 text-right font-medium">Tokens</th>
            <th className="px-3 py-2 text-right font-medium">Calls</th>
            <th className="px-3 py-2 text-right font-medium">Cost</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.provider}::${r.modelId}`} className="border-b border-border/60 last:border-0">
              <td className="px-3 py-2">
                <div className="flex items-center gap-1.5">
                  <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[9px] uppercase text-muted-foreground">
                    {r.provider}
                  </span>
                  <span className="font-mono text-[11px]">{r.modelId}</span>
                </div>
              </td>
              <td className="px-3 py-2 text-right tabular-nums">{formatTokens(r.totalTokens)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{r.calls}</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatCost(r.costCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function UsageByDayChart({ data }: { data: UsageByDay[] }) {
  // Compact the data: if we have >30 days, bucket weekly so the chart stays readable.
  const chartData = React.useMemo(() => {
    if (data.length <= 31) {
      return data.map((d) => ({
        date: d.date.slice(5), // MM-DD
        tokens: d.tokens,
        costCents: d.costCents,
      }))
    }
    // Bucket by week.
    const buckets: { date: string; tokens: number; costCents: number }[] = []
    for (let i = 0; i < data.length; i += 7) {
      const slice = data.slice(i, i + 7)
      const sum = slice.reduce(
        (acc, d) => {
          acc.tokens += d.tokens
          acc.costCents += d.costCents
          return acc
        },
        { tokens: 0, costCents: 0 },
      )
      buckets.push({
        date: slice[0].date.slice(5), // first day of the week
        tokens: sum.tokens,
        costCents: sum.costCents,
      })
    }
    return buckets
  }, [data])

  if (chartData.length === 0 || chartData.every((d) => d.tokens === 0)) {
    return (
      <div className="flex h-[160px] items-center justify-center rounded-lg border border-dashed border-border text-xs text-muted-foreground">
        No daily usage yet this period.
      </div>
    )
  }

  return (
    <div className="h-[180px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -16 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} opacity={0.5} />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
            minTickGap={16}
          />
          <YAxis
            tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }}
            tickLine={false}
            axisLine={false}
            width={40}
            tickFormatter={(v: number) => formatTokens(v)}
          />
          <RechartsTooltip
            cursor={{ fill: 'var(--muted)', opacity: 0.4 }}
            contentStyle={{
              borderRadius: 8,
              border: '1px solid var(--border)',
              background: 'var(--background)',
              fontSize: 11,
              color: 'var(--foreground)',
            }}
            labelStyle={{ color: 'var(--muted-foreground)', fontSize: 10 }}
            formatter={(value: number) => [formatTokens(Number(value)), 'Tokens']}
          />
          <Bar dataKey="tokens" fill="var(--primary)" radius={[3, 3, 0, 0]} maxBarSize={28} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

// ---------------- Format helpers ----------------

function formatTokens(n: number): string {
  if (n >= 1_000_000) {
    const v = n / 1_000_000
    return `${v % 1 === 0 ? v.toFixed(0) : v.toFixed(1)}M`
  }
  if (n >= 1_000) {
    const v = n / 1_000
    return `${v % 1 === 0 ? v.toFixed(0) : v.toFixed(1)}K`
  }
  return String(n)
}

function formatCost(cents: number): string {
  if (cents === 0) return '—'
  return `$${(cents / 100).toFixed(2)}`
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  } catch {
    return '—'
  }
}
