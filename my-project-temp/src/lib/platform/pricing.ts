// Apical pricing model — the single source of truth for plans, allowances,
// and overrun rates. Imported by the billing lib, the settings UI, and the
// landing page.
//
// Four tiers:
//   Free       — try it out, bring your own keys, limited agents.
//   Personal   — one person doing real work. More agents, more tokens.
//   Team       — a few people sharing agents + a shared workspace.
//   Enterprise — unlimited scale, SSO, SLA, audit logs.

export type PlanId = 'free' | 'personal' | 'team' | 'enterprise'

export interface PlanDefinition {
  id: PlanId
  name: string
  tagline: string
  priceMonthly: number // USD, whole dollars; 0 = free
  priceYearly: number // USD, whole dollars; 0 = free
  stripePriceIdMonthly?: string
  stripePriceIdYearly?: string
  // Token allowance per month (prompt + completion, across all hosted models).
  // 0 means "unlimited" (enterprise) — for free it's the hosted credit quota.
  tokenAllowanceMonthly: number
  // Max concurrent agents (workflows). 0 = unlimited.
  maxAgents: number
  // Whether the user can opt into pay-as-you-go overrun billing.
  overrunAvailable: boolean
  // Cents per 1M tokens (prompt + completion combined) for overrun.
  overrunRateCentsPer1M: number
  // Whether BYOK (bring your own key) is allowed on this plan.
  byokAllowed: boolean
  // Whether local/offline models (Ollama, llama.cpp) are allowed.
  localModelsAllowed: boolean
  // Whether the desktop bridge (hosted agents accessing your filesystem) is allowed.
  desktopBridgeAllowed: boolean
  // Number of seats (people sharing the workspace). 1 for free/personal.
  seats: number
  // Featured/highlighted in the pricing card.
  featured: boolean
  // Bullets for the pricing card.
  features: string[]
}

export const PLANS: Record<PlanId, PlanDefinition> = {
  free: {
    id: 'free',
    name: 'Free',
    tagline: 'Try it out. No credit card.',
    priceMonthly: 0,
    priceYearly: 0,
    tokenAllowanceMonthly: 50_000,
    maxAgents: 3,
    overrunAvailable: false,
    overrunRateCentsPer1M: 0,
    byokAllowed: true,
    localModelsAllowed: true,
    desktopBridgeAllowed: true,
    seats: 1,
    featured: false,
    features: [
      '3 agents',
      '50,000 tokens included / month',
      'Bring your own API keys',
      'Runs on your computer',
      'Community support',
    ],
  },
  personal: {
    id: 'personal',
    name: 'Personal',
    tagline: 'For one person getting real work done.',
    priceMonthly: 16,
    priceYearly: 160, // ~2 months free
    tokenAllowanceMonthly: 2_000_000,
    maxAgents: 25,
    overrunAvailable: true,
    overrunRateCentsPer1M: 400, // $4 / 1M tokens
    byokAllowed: true,
    localModelsAllowed: true,
    desktopBridgeAllowed: true,
    seats: 1,
    featured: true,
    features: [
      '25 agents',
      '2,000,000 tokens / month',
      'Pay-as-you-go after that ($4 / 1M)',
      'Bring your own keys',
      'Runs on your computer',
      'Email updates + daily briefs',
      'Priority support',
    ],
  },
  team: {
    id: 'team',
    name: 'Team',
    tagline: 'A few people sharing the same agents.',
    priceMonthly: 12, // per seat / month
    priceYearly: 120, // per seat / year
    tokenAllowanceMonthly: 5_000_000, // shared pool
    maxAgents: 100,
    overrunAvailable: true,
    overrunRateCentsPer1M: 300, // $3 / 1M tokens
    byokAllowed: true,
    localModelsAllowed: true,
    desktopBridgeAllowed: true,
    seats: 5, // default seat count; scales
    featured: false,
    features: [
      '5 seats included (add more anytime)',
      '100 agents, shared across the team',
      '5,000,000 tokens / month, shared',
      'Shared workspace + roles',
      'Pay-as-you-go after that ($3 / 1M)',
      'Team usage dashboard',
      'Email updates + daily briefs',
    ],
  },
  enterprise: {
    id: 'enterprise',
    name: 'Enterprise',
    tagline: 'Unlimited scale. SSO, audit logs, and a dedicated environment.',
    priceMonthly: 0, // contact sales
    priceYearly: 0,
    tokenAllowanceMonthly: 0, // 0 = unlimited (custom)
    maxAgents: 0, // 0 = unlimited
    overrunAvailable: true,
    overrunRateCentsPer1M: 200, // $2 / 1M tokens (volume rate)
    byokAllowed: true,
    localModelsAllowed: true,
    desktopBridgeAllowed: true,
    seats: 0, // 0 = unlimited
    featured: false,
    features: [
      'Unlimited agents',
      'Unlimited seats',
      'Custom token volume + volume pricing',
      'SSO / SAML + SCIM provisioning',
      'Audit logs + data residency',
      'Dedicated support + SLA',
      'On-prem / VPC deployment options',
    ],
  },
}

export const PLAN_LIST: PlanDefinition[] = [PLANS.free, PLANS.personal, PLANS.team, PLANS.enterprise]

// Paid plan ids (used by checkout). Free is not checkout-able.
export const PAID_PLAN_IDS: PlanId[] = ['personal', 'team', 'enterprise']

export function getPlan(id: string): PlanDefinition {
  return PLANS[id as PlanId] ?? PLANS.free
}

// How much of the monthly allowance has been used (0–1, capped at 1).
export function usageFraction(used: number, allowance: number): number {
  if (allowance <= 0) return 0 // unlimited
  return Math.min(1, used / allowance)
}

// Whether a user has exceeded their allowance and needs overrun billing or
// a hard stop.
export function isOverAllowance(used: number, allowance: number): boolean {
  if (allowance <= 0) return false // unlimited
  return used >= allowance
}
