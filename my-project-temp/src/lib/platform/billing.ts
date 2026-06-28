// Apical billing — Stripe Checkout + Customer Portal + webhook handler +
// overrun toggle. Plug-and-play: works with zero Stripe config (demo mode)
// or with a real STRIPE_SECRET_KEY.
//
// Demo mode (default in dev):
//   • createCheckoutSession returns { url: '/?billing_demo=success&plan=pro',
//     sessionId: 'demo_...' } AND immediately upserts the Subscription to the
//     requested plan so the upgrade shows up instantly.
//   • createPortalSession returns { url: '/?billing_demo=portal' }.
//   • The webhook route accepts { event, plan, userId } for manual testing.
//
// Real mode (STRIPE_SECRET_KEY set):
//   • Uses fetch() against https://api.stripe.com/v1/... with Bearer auth and
//     form-encoded bodies — no `stripe` SDK dependency required (so we don't
//     add a new dep unless asked). Webhook signature is verified manually
//     with HMAC-SHA256 (Stripe-Signature header, t=...,v1=... scheme).
//
// Imported everywhere billing is needed: the API routes in
// src/app/api/billing/*, the LLM gateway (token metering), the scheduler
// (gate runs by status), the settings UI (subscription status card).

import { createHmac, timingSafeEqual } from 'crypto'
import { db } from '@/lib/db'
import {
  PLANS,
  PLAN_LIST,
  getPlan,
  type PlanId,
  type PlanDefinition,
} from '@/lib/platform/pricing'
import type { Subscription } from '@prisma/client'

// ---------------- Mode detection ----------------

/**
 * Whether billing is running in demo mode (no real Stripe calls).
 * True when STRIPE_SECRET_KEY is missing OR BILLING_DEMO_MODE === 'true'.
 */
export function isDemoMode(): boolean {
  if (process.env.BILLING_DEMO_MODE === 'true') return true
  if (!process.env.STRIPE_SECRET_KEY) return true
  return false
}

function stripeSecret(): string {
  return process.env.STRIPE_SECRET_KEY ?? ''
}

function priceIdFor(planId: 'personal' | 'team' | 'enterprise', interval: 'monthly' | 'yearly'): string {
  const envVar =
    planId === 'personal'
      ? interval === 'yearly'
        ? 'STRIPE_PRICE_PERSONAL_YEARLY'
        : 'STRIPE_PRICE_PERSONAL'
      : planId === 'team'
        ? interval === 'yearly'
          ? 'STRIPE_PRICE_TEAM_YEARLY'
          : 'STRIPE_PRICE_TEAM'
        : interval === 'yearly'
          ? 'STRIPE_PRICE_ENTERPRISE_YEARLY'
          : 'STRIPE_PRICE_ENTERPRISE'
  return process.env[envVar] ?? ''
}

// ---------------- Subscription lifecycle ----------------

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000

/**
 * Find the user's Subscription, or create a free one if none exists.
 * Free defaults: plan='free', status='active', tokenAllowanceMonthly from
 * PLANS.free, currentPeriodEnd = now + 30d, overrunEnabled=false.
 */
export async function getOrCreateSubscription(userId: string): Promise<Subscription> {
  const existing = await db.subscription.findUnique({ where: { userId } })
  if (existing) return existing

  const free = PLANS.free
  return db.subscription.create({
    data: {
      userId,
      plan: 'free',
      status: 'active',
      tokenAllowanceMonthly: free.tokenAllowanceMonthly,
      tokenUsedMonthly: 0,
      tokenOverageMonthly: 0,
      overrunEnabled: false,
      overrunRateCentsPer1M: 0,
      overageAccruedCents: 0,
      seats: 1,
      currentPeriodEnd: new Date(Date.now() + THIRTY_DAYS_MS),
    },
  })
}

/**
 * Apply a plan change: upsert the Subscription with the new plan's
 * tokenAllowanceMonthly. If `opts.periodEnd` is provided, treat it as the new
 * period boundary — reset tokenUsedMonthly + tokenOverageMonthly +
 * overageAccruedCents to 0. Otherwise just bump currentPeriodEnd forward by
 * 30 days (the new period starts now).
 *
 * Used by: the webhook handler (real Stripe event), demo checkout, manual
 * plan changes from the admin UI.
 */
export async function applyPlanChange(
  userId: string,
  planId: PlanId,
  opts?: { periodEnd?: Date; stripeCustomerId?: string; stripeSubscriptionId?: string; stripePriceId?: string; status?: string },
): Promise<Subscription> {
  const plan = getPlan(planId)
  const periodEnd = opts?.periodEnd ?? new Date(Date.now() + THIRTY_DAYS_MS)
  const existing = await db.subscription.findUnique({ where: { userId } })

  // Reset usage if a new period is starting. We treat "no existing sub" or
  // "periodEnd moved forward of the old one" as a period rollover.
  const shouldResetUsage =
    !existing ||
    !existing.currentPeriodEnd ||
    periodEnd.getTime() > existing.currentPeriodEnd.getTime()

  // If the new plan doesn't allow overrun, force-disable it (and clear the
  // rate snapshot) so the user isn't left with overrunEnabled=true on a plan
  // that can't bill for it. (e.g. pro → free downgrade via webhook.)
  const mustDisableOverrun = !plan.overrunAvailable

  const data = {
    plan: planId,
    status: opts?.status ?? 'active',
    tokenAllowanceMonthly: plan.tokenAllowanceMonthly,
    ...(shouldResetUsage
      ? {
          tokenUsedMonthly: 0,
          tokenOverageMonthly: 0,
          overageAccruedCents: 0,
        }
      : {}),
    ...(mustDisableOverrun
      ? { overrunEnabled: false, overrunRateCentsPer1M: 0 }
      : {}),
    currentPeriodEnd: periodEnd,
    ...(opts?.stripeCustomerId !== undefined ? { stripeCustomerId: opts.stripeCustomerId } : {}),
    ...(opts?.stripeSubscriptionId !== undefined
      ? { stripeSubscriptionId: opts.stripeSubscriptionId }
      : {}),
    ...(opts?.stripePriceId !== undefined ? { stripePriceId: opts.stripePriceId } : {}),
    canceledAt: null,
  }

  if (existing) {
    return db.subscription.update({ where: { id: existing.id }, data })
  }
  return db.subscription.create({
    data: {
      userId,
      ...data,
      tokenUsedMonthly: shouldResetUsage ? 0 : 0,
      tokenOverageMonthly: 0,
      overrunEnabled: false,
      overrunRateCentsPer1M: 0,
      overageAccruedCents: 0,
      seats: 1,
    },
  })
}

// ---------------- Checkout ----------------

export interface CheckoutResult {
  url: string
  sessionId: string
  demoMode: boolean
}

/**
 * Create a Stripe Checkout Session (or a demo one). Returns the URL the
 * browser should redirect to + the session id.
 *
 * In demo mode this ALSO immediately upgrades the user's subscription, so
 * the change is visible without a webhook round-trip. (Real mode waits for
 * the `checkout.session.completed` webhook before upgrading.)
 */
export async function createCheckoutSession(
  userId: string,
  planId: 'personal' | 'team' | 'enterprise',
  interval: 'monthly' | 'yearly',
): Promise<CheckoutResult> {
  if (isDemoMode()) {
    // Demo: mint a fake session id, upgrade immediately, return the success URL.
    const sessionId = `demo_${planId}_${interval}_${Math.random().toString(36).slice(2, 10)}`
    const periodEnd = new Date(
      Date.now() + (interval === 'yearly' ? 365 : 30) * 24 * 60 * 60 * 1000,
    )
    await applyPlanChange(userId, planId, {
      periodEnd,
      status: 'active',
      stripeCustomerId: `demo_cus_${userId.slice(0, 8)}`,
      stripeSubscriptionId: `demo_sub_${sessionId}`,
      stripePriceId: `demo_price_${planId}_${interval}`,
    })
    return {
      url: `/?billing_demo=success&plan=${planId}&interval=${interval}`,
      sessionId,
      demoMode: true,
    }
  }

  // Real Stripe Checkout Session.
  const price = priceIdFor(planId, interval)
  if (!price) {
    throw new Error(
      `STRIPE_PRICE_${planId.toUpperCase()} is not set — cannot create a real Checkout session for ${planId}.`,
    )
  }

  const origin = process.env.NEXTAUTH_URL ?? 'http://localhost:3000'
  const body = new URLSearchParams({
    mode: 'subscription',
    'line_items[0][price]': price,
    'line_items[0][quantity]': '1',
    success_url: `${origin}/?billing=success`,
    cancel_url: `${origin}/?billing=canceled`,
    client_reference_id: userId,
    'metadata[plan]': planId,
    'metadata[userId]': userId,
    'metadata[interval]': interval,
  })

  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${stripeSecret()}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Stripe checkout/sessions failed (${res.status}): ${text}`)
  }

  const session = (await res.json()) as { id: string; url: string }
  return {
    url: session.url,
    sessionId: session.id,
    demoMode: false,
  }
}

// ---------------- Customer Portal ----------------

export interface PortalResult {
  url: string
  demoMode: boolean
}

/**
 * Create a Stripe Billing Portal session (or return the demo URL).
 * Used by the settings page so the user can manage their card / cancel.
 */
export async function createPortalSession(userId: string): Promise<PortalResult> {
  if (isDemoMode()) {
    return { url: '/?billing_demo=portal', demoMode: true }
  }

  const sub = await getOrCreateSubscription(userId)
  if (!sub.stripeCustomerId) {
    throw new Error('No Stripe customer id on the subscription — cannot open the portal.')
  }

  const origin = process.env.NEXTAUTH_URL ?? 'http://localhost:3000'
  const body = new URLSearchParams({
    customer: sub.stripeCustomerId,
    return_url: `${origin}/?billing=portal`,
  })

  const res = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${stripeSecret()}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Stripe billing_portal/sessions failed (${res.status}): ${text}`)
  }

  const session = (await res.json()) as { url: string }
  return { url: session.url, demoMode: false }
}

// ---------------- Overrun toggle ----------------

/**
 * Turn pay-as-you-go overrun billing on/off. Only allowed on plans where
 * `getPlan(sub.plan).overrunAvailable` is true (personal, team, enterprise).
 * When enabling, snapshot the plan's `overrunRateCentsPer1M` so the user's
 * rate doesn't silently change if we update pricing later.
 */
export async function toggleOverrun(
  userId: string,
  enabled: boolean,
): Promise<Subscription> {
  const sub = await getOrCreateSubscription(userId)
  const plan = getPlan(sub.plan)

  if (enabled && !plan.overrunAvailable) {
    throw new Error(`Overrun billing is not available on the ${plan.name} plan.`)
  }

  return db.subscription.update({
    where: { id: sub.id },
    data: {
      overrunEnabled: enabled,
      // Snapshot the rate on enable; clear it on disable (so the dashboard
      // shows "$0/M" when off and the live rate when on).
      overrunRateCentsPer1M: enabled ? plan.overrunRateCentsPer1M : 0,
    },
  })
}

// ---------------- Billing status ----------------

export interface BillingUsage {
  used: number
  allowance: number
  overage: number
  overrunEnabled: boolean
  periodEnd: Date | null
}

export interface BillingStatus {
  subscription: Subscription
  plan: PlanDefinition
  usage: BillingUsage
  overrunAvailable: boolean
  demoMode: boolean
}

/**
 * The full billing status: the subscription row, the resolved PlanDefinition,
 * computed usage (used / allowance / overage / overrunEnabled / periodEnd),
 * whether overrun billing is even available on this plan, and whether we're
 * in demo mode. Powers the settings "Billing" card + the pricing page CTA.
 */
export async function getBillingStatus(userId: string): Promise<BillingStatus> {
  const subscription = await getOrCreateSubscription(userId)
  const plan = getPlan(subscription.plan)

  return {
    subscription,
    plan,
    usage: {
      used: subscription.tokenUsedMonthly,
      allowance: subscription.tokenAllowanceMonthly,
      overage: subscription.tokenOverageMonthly,
      overrunEnabled: subscription.overrunEnabled,
      periodEnd: subscription.currentPeriodEnd,
    },
    overrunAvailable: plan.overrunAvailable,
    demoMode: isDemoMode(),
  }
}

// ---------------- Webhook ----------------

/**
 * Verify a Stripe webhook signature. Returns the parsed event object on
 * success, throws on failure. Implements Stripe's t=...,v1=... scheme:
 *   signedPayload = `${t}.${rawBody}`
 *   expected = HMAC-SHA256(secret, signedPayload)  (hex)
 *   v1 in header must equal expected, and t must be within 5 minutes of now.
 *
 * No `stripe` SDK needed.
 */
export function verifyStripeWebhook(
  rawBody: string,
  signatureHeader: string,
  secret: string,
): unknown {
  const parts = signatureHeader.split(',').map((s) => s.trim())
  const tPart = parts.find((s) => s.startsWith('t='))
  const v1Part = parts.find((s) => s.startsWith('v1='))
  if (!tPart || !v1Part) {
    throw new Error('Stripe-Signature missing t= or v1= segment')
  }
  const t = Number(tPart.slice(2))
  const v1 = v1Part.slice(3)
  if (!Number.isFinite(t)) throw new Error('Stripe-Signature t= is not a number')

  // 5-minute tolerance to defend against replay attacks.
  const skewMs = Math.abs(Date.now() - t * 1000)
  if (skewMs > 5 * 60 * 1000) {
    throw new Error(`Stripe webhook timestamp out of range (skew=${skewMs}ms)`)
  }

  const signedPayload = `${t}.${rawBody}`
  const expected = createHmac('sha256', secret).update(signedPayload).digest('hex')

  // timingSafeEqual needs equal-length buffers; compare the hex strings as
  // Buffers. If lengths differ, the signature is invalid.
  const a = Buffer.from(expected, 'utf8')
  const b = Buffer.from(v1, 'utf8')
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new Error('Stripe webhook signature mismatch')
  }

  return JSON.parse(rawBody) as unknown
}

// Loosely-typed Stripe event shapes (only the fields we read).
interface StripeEvent {
  type: string
  data?: { object?: Record<string, unknown> }
}
interface StripeCheckoutSession {
  id: string
  client_reference_id?: string
  customer?: string
  subscription?: string
  metadata?: Record<string, string | undefined>
}
interface StripeSubscription {
  id: string
  status?: string
  current_period_end?: number
  customer?: string
  items?: { data?: Array<{ price?: { id?: string } }> }
}

/**
 * Apply a webhook event to the Subscription. Handles the four events we care
 * about: checkout.session.completed, customer.subscription.updated,
 * customer.subscription.deleted, invoice.payment_failed. Any other event
 * type is a no-op (logged by the caller).
 *
 * In demo mode the webhook route passes a synthesized event
 * `{ type: 'checkout.session.completed', metadata: { plan, userId } }`
 * so this same code path applies the change.
 */
export async function handleWebhookEvent(event: unknown): Promise<void> {
  const ev = event as StripeEvent
  if (!ev || typeof ev.type !== 'string') {
    throw new Error('Invalid webhook event: missing type')
  }

  const obj = ev.data?.object ?? {}

  switch (ev.type) {
    case 'checkout.session.completed': {
      const sess = obj as unknown as StripeCheckoutSession
      const userId = sess.client_reference_id || sess.metadata?.userId
      const planId = (sess.metadata?.plan ?? 'free') as PlanId
      if (!userId) {
        console.warn('[billing] checkout.session.completed with no userId — skipping')
        return
      }
      const plan = getPlan(planId)
      // Stripe subscription id (so we can match future update/delete events).
      const stripeSubId =
        typeof sess.subscription === 'string' ? sess.subscription : undefined
      const stripeCustomerId =
        typeof sess.customer === 'string' ? sess.customer : undefined

      // Fetch the subscription to get current_period_end (real mode).
      let periodEnd: Date | undefined
      let stripePriceId: string | undefined
      if (stripeSubId && !isDemoMode()) {
        try {
          const s = (await fetchStripe(`/v1/subscriptions/${stripeSubId}`)) as StripeSubscription
          if (s.current_period_end) {
            periodEnd = new Date(s.current_period_end * 1000)
          }
          stripePriceId = s.items?.data?.[0]?.price?.id
        } catch (err) {
          console.warn('[billing] failed to fetch subscription period end:', err)
        }
      }

      await applyPlanChange(userId, planId, {
        periodEnd: periodEnd ?? new Date(Date.now() + THIRTY_DAYS_MS),
        status: 'active',
        stripeCustomerId,
        stripeSubscriptionId: stripeSubId,
        stripePriceId,
      })

      // Mark the plan's overrun rate as the snapshot (don't auto-enable
      // overrun — the user opts in via /api/billing/overrun).
      void plan
      return
    }

    case 'customer.subscription.updated': {
      const s = obj as unknown as StripeSubscription
      if (!s.id) return
      // Find the subscription by stripeSubscriptionId.
      const sub = await db.subscription.findFirst({
        where: { stripeSubscriptionId: s.id },
      })
      if (!sub) {
        console.warn(`[billing] subscription.updated: no local sub for ${s.id}`)
        return
      }
      const status = mapStripeSubStatus(s.status)
      const periodEnd = s.current_period_end
        ? new Date(s.current_period_end * 1000)
        : undefined
      const priceId = s.items?.data?.[0]?.price?.id
      await db.subscription.update({
        where: { id: sub.id },
        data: {
          status,
          ...(periodEnd ? { currentPeriodEnd: periodEnd } : {}),
          ...(priceId ? { stripePriceId: priceId } : {}),
          canceledAt: null,
        },
      })
      return
    }

    case 'customer.subscription.deleted': {
      const s = obj as unknown as StripeSubscription
      if (!s.id) return
      const sub = await db.subscription.findFirst({
        where: { stripeSubscriptionId: s.id },
      })
      if (!sub) return
      // Canceled → drop back to free.
      const free = PLANS.free
      await db.subscription.update({
        where: { id: sub.id },
        data: {
          plan: 'free',
          status: 'canceled',
          tokenAllowanceMonthly: free.tokenAllowanceMonthly,
          overrunEnabled: false,
          overrunRateCentsPer1M: 0,
          canceledAt: new Date(),
          stripeSubscriptionId: null,
          stripePriceId: null,
        },
      })
      return
    }

    case 'invoice.payment_failed': {
      // Mark the user's subscription as past_due. The invoice carries the
      // subscription id under `subscription` (or `parent.subscription_entity`
      // in newer API versions); we match by it.
      const inv = obj as {
        subscription?: string
        customer?: string
      }
      const subId = typeof inv.subscription === 'string' ? inv.subscription : null
      const cusId = typeof inv.customer === 'string' ? inv.customer : null
      const match = await db.subscription.findFirst({
        where: {
          OR: [
            ...(subId ? [{ stripeSubscriptionId: subId }] : []),
            ...(cusId ? [{ stripeCustomerId: cusId }] : []),
          ],
        },
      })
      if (!match) return
      await db.subscription.update({
        where: { id: match.id },
        data: { status: 'past_due' },
      })
      return
    }

    default:
      // Unknown / unhandled event — no-op. The route still returns 200 so
      // Stripe doesn't keep retrying.
      return
  }
}

function mapStripeSubStatus(s?: string): string {
  if (!s) return 'active'
  // Stripe → Apical status mapping. 'active' | 'trialing' | 'past_due' |
  // 'canceled' (and a few we collapse).
  switch (s) {
    case 'active':
    case 'trialing':
      return s
    case 'past_due':
    case 'unpaid':
      return 'past_due'
    case 'canceled':
      return 'canceled'
    case 'incomplete':
    case 'incomplete_expired':
      return 'past_due'
    default:
      return 'active'
  }
}

/** Tiny helper: GET a Stripe resource with Bearer auth. */
async function fetchStripe(path: string): Promise<unknown> {
  const res = await fetch(`https://api.stripe.com${path}`, {
    headers: { Authorization: `Bearer ${stripeSecret()}` },
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Stripe GET ${path} failed (${res.status}): ${text}`)
  }
  return res.json()
}

// ---------------- Exports for the UI ----------------

export { PLANS, PLAN_LIST, getPlan }
export type { PlanId, PlanDefinition }
