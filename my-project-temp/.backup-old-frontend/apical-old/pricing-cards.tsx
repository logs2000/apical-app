'use client'

// Reusable pricing-cards component for Apical.
//
// Renders the 4 plans (Free / Personal / Team / Enterprise) as cards. The
// Personal card is "featured" — emerald border, "Most popular" badge, slightly
// elevated. Optional monthly/yearly toggle that updates the displayed price +
// the `interval` passed to `onChoose` (or POSTed to /api/billing/checkout).
//
// Props:
//   currentPlan?: string              — plan id ('free'|'personal'|'team'|'enterprise').
//                                       If a card matches it, its CTA becomes
//                                       a disabled "Current plan" button.
//   onChoose?: (planId, interval) => void | Promise<void>
//                                     — if provided, the CTA calls it instead of
//                                       starting a checkout. Lets the landing
//                                       page or settings wrap the action.
//   showToggle?: boolean (default true)
//                                     — show the monthly/yearly segmented toggle.
//
// If `onChoose` is NOT provided, the CTA POSTs /api/billing/checkout with
// `{ planId, interval }` and `window.location.href = url` on success. In demo
// mode the URL is `/?billing_demo=success&plan=...` and the subscription is
// upgraded server-side immediately, so the change shows up on reload.
//
// Enterprise never starts a checkout — its CTA is "Contact sales" and just
// shows a toast with the sales email (or calls `onChoose('enterprise', ...)` so
// the host can route to a contact form).

import * as React from 'react'
import { motion } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { Check, Sparkles, ArrowRight, Loader2, Mail } from 'lucide-react'
import {
  PLAN_LIST,
  type PlanDefinition,
  type PlanId,
} from '@/lib/platform/pricing'

export type BillingInterval = 'monthly' | 'yearly'

export interface PricingCardsProps {
  /** Plan id of the user's current plan. Matching card shows "Current plan". */
  currentPlan?: string
  /** Optional override. If omitted, the CTA POSTs /api/billing/checkout. */
  onChoose?: (planId: PlanId, interval: BillingInterval) => void | Promise<void>
  /** Show the monthly/yearly toggle. Default true. */
  showToggle?: boolean
  /** Optional className for the outer wrapper. */
  className?: string
}

/**
 * Pricing section — the 3 plans as cards. See module docstring.
 */
export function PricingCards({
  currentPlan,
  onChoose,
  showToggle = true,
  className,
}: PricingCardsProps) {
  const { toast } = useToast()
  const [interval, setInterval] = React.useState<BillingInterval>('monthly')
  const [busyPlan, setBusyPlan] = React.useState<PlanId | null>(null)

  const handleChoose = React.useCallback(
    async (planId: PlanId) => {
      // Enterprise → contact sales (no checkout).
      if (planId === 'enterprise') {
        if (onChoose) {
          await onChoose(planId, interval)
          return
        }
        toast({
          title: 'Talk to sales',
          description: 'Email sales@apical.dev — we will design a plan that fits.',
        })
        return
      }

      setBusyPlan(planId)
      try {
        if (onChoose) {
          await onChoose(planId, interval)
          return
        }
        const res = await fetch('/api/billing/checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ planId, interval }),
        })
        if (!res.ok) {
          const e = (await res.json().catch(() => ({}))) as { error?: string }
          throw new Error(e.error || `Checkout failed (${res.status})`)
        }
        const data = (await res.json()) as { url?: string; demoMode?: boolean }
        if (data.url) {
          // Demo URL reloads the SPA with ?billing_demo=success; real URL is
          // Stripe's hosted checkout page.
          window.location.href = data.url
        } else {
          toast({ title: 'Checkout started', description: 'Check your email for a receipt.' })
        }
      } catch (err) {
        toast({
          title: 'Could not start checkout',
          description: err instanceof Error ? err.message : 'Unknown error',
          variant: 'destructive',
        })
      } finally {
        setBusyPlan(null)
      }
    },
    [onChoose, interval, toast],
  )

  return (
    <div className={cn('space-y-6', className)}>
      {showToggle && (
        <IntervalToggle value={interval} onChange={setInterval} />
      )}
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {PLAN_LIST.map((plan, i) => (
          <PlanCard
            key={plan.id}
            plan={plan}
            interval={interval}
            current={plan.id === currentPlan}
            busy={busyPlan === plan.id}
            onChoose={() => handleChoose(plan.id)}
            delay={i * 0.08}
          />
        ))}
      </div>
    </div>
  )
}

export default PricingCards

// ---------------- Interval toggle ----------------

function IntervalToggle({
  value,
  onChange,
}: {
  value: BillingInterval
  onChange: (v: BillingInterval) => void
}) {
  return (
    <div className="flex items-center justify-center">
      <div
        role="tablist"
        aria-label="Billing interval"
        className="inline-flex items-center rounded-full border border-border bg-muted/40 p-0.5 text-xs"
      >
        <ToggleButton active={value === 'monthly'} onClick={() => onChange('monthly')}>
          Monthly
        </ToggleButton>
        <ToggleButton active={value === 'yearly'} onClick={() => onChange('yearly')}>
          Yearly
          <span className="ml-1 rounded-full bg-primary/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-primary">
            2 mo free
          </span>
        </ToggleButton>
      </div>
    </div>
  )
}

function ToggleButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      role="tab"
      type="button"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        'inline-flex items-center rounded-full px-3.5 py-1.5 font-medium transition-colors',
        active
          ? 'bg-background text-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </button>
  )
}

// ---------------- Single plan card ----------------

function PlanCard({
  plan,
  interval,
  current,
  busy,
  onChoose,
  delay,
}: {
  plan: PlanDefinition
  interval: BillingInterval
  current: boolean
  busy: boolean
  onChoose: () => void
  delay: number
}) {
  const featured = plan.featured
  const isEnterprise = plan.id === 'enterprise'
  const isFree = plan.id === 'free'

  const priceInfo = computePrice(plan, interval)

  // CTA label + variant per plan.
  let ctaLabel: string
  if (current) ctaLabel = 'Current plan'
  else if (isEnterprise) ctaLabel = 'Contact sales'
  else if (isFree) ctaLabel = 'Get started'
  else ctaLabel = 'Upgrade'

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.3, ease: 'easeOut' }}
      className={cn(
        'relative flex flex-col rounded-xl border bg-card p-6 transition-all',
        featured
          ? 'border-primary/60 shadow-md md:-translate-y-2 md:scale-[1.015]'
          : 'border-border hover:border-primary/30 hover:shadow-sm',
      )}
    >
      {featured && (
        <Badge
          className="absolute -top-2.5 left-6 gap-1 border-primary/40 bg-primary text-primary-foreground"
          variant="default"
        >
          <Sparkles className="h-3 w-3" /> Most popular
        </Badge>
      )}

      {/* Header: name + tagline */}
      <div className="space-y-1">
        <h3 className="text-base font-semibold">{plan.name}</h3>
        <p className="min-h-[2.5rem] text-xs leading-relaxed text-muted-foreground">
          {plan.tagline}
        </p>
      </div>

      {/* Price */}
      <div className="mt-4 flex items-baseline gap-1.5">
        <span className="text-3xl font-semibold tracking-tight">
          {priceInfo.display}
        </span>
        {priceInfo.suffix && (
          <span className="text-sm text-muted-foreground">{priceInfo.suffix}</span>
        )}
      </div>
      <div className="mt-1 min-h-[1rem] text-[11px] text-muted-foreground">
        {priceInfo.sub || '\u00A0'}
      </div>

      {/* CTA */}
      <div className="mt-5">
        <Button
          type="button"
          onClick={onChoose}
          disabled={current || busy}
          variant={featured ? 'default' : 'outline'}
          className="w-full"
        >
          {busy ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Redirecting…
            </>
          ) : current ? (
            <>
              <Check className="h-4 w-4" /> Current plan
            </>
          ) : isEnterprise ? (
            <>
              <Mail className="h-4 w-4" /> {ctaLabel}
            </>
          ) : (
            <>
              {ctaLabel} <ArrowRight className="h-4 w-4" />
            </>
          )}
        </Button>
      </div>

      {/* Feature list */}
      <ul className="mt-6 space-y-2.5">
        {plan.features.map((f) => (
          <li key={f} className="flex items-start gap-2 text-xs">
            <span
              className={cn(
                'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full',
                featured
                  ? 'bg-primary/15 text-primary'
                  : 'bg-primary/10 text-primary',
              )}
            >
              <Check className="h-2.5 w-2.5" />
            </span>
            <span className="leading-relaxed text-foreground/80">{f}</span>
          </li>
        ))}
      </ul>
    </motion.div>
  )
}

// ---------------- Price computation ----------------

interface PriceDisplay {
  /** Big number, e.g. "$20" or "Custom". */
  display: string
  /** Suffix after the big number, e.g. "/mo". */
  suffix?: string
  /** Sub-line under the price, e.g. "$192/yr — 2 months free". */
  sub?: string
}

function computePrice(plan: PlanDefinition, interval: BillingInterval): PriceDisplay {
  if (plan.id === 'enterprise') {
    return {
      display: 'Custom',
      sub: 'Volume pricing — talk to sales.',
    }
  }
  if (plan.id === 'free') {
    return {
      display: '$0',
      suffix: '/mo',
      sub: 'Free forever. No credit card.',
    }
  }
  // Team is priced per seat.
  const perSeatSuffix = plan.id === 'team' ? ' /seat' : ''
  if (interval === 'monthly') {
    return {
      display: `$${plan.priceMonthly}`,
      suffix: `/mo${perSeatSuffix}`,
      sub: plan.id === 'team' ? `5 seats included. Billed monthly.` : 'Billed monthly.',
    }
  }
  // Yearly: show effective monthly price + annual total + months free.
  const perMonth = plan.priceYearly / 12
  const monthsFree = 12 - Math.round(plan.priceYearly / plan.priceMonthly)
  return {
    display: `$${perMonth % 1 === 0 ? perMonth : perMonth.toFixed(2)}`,
    suffix: `/mo${perSeatSuffix}`,
    sub: plan.id === 'team'
      ? `$${plan.priceYearly}/yr/seat — ${monthsFree} months free`
      : `$${plan.priceYearly}/yr — ${monthsFree} months free`,
  }
}
