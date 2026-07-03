// Admin-configurable token allowance settings.
//
// Plan catalog values live in pricing.ts; this module applies a global multiplier
// and optional per-plan overrides stored in PlatformSetting (key:
// `token_allowance_config`). Env var APICAL_TOKEN_ALLOWANCE_MULTIPLIER seeds the
// default multiplier when no DB row exists.

import { db } from '@/lib/db'
import { getPlan, type PlanId } from '@/lib/platform/pricing'
import type { Subscription } from '@prisma/client'

const SETTING_KEY = 'token_allowance_config'

export interface TokenAllowanceAdminConfig {
  /** Applied to plan/subscription base allowance. 1 = no change. */
  globalMultiplier: number
  /** Optional absolute monthly limits per plan (overrides multiplier). */
  planAllowances: Partial<Record<PlanId, number>>
}

const DEFAULT_CONFIG: TokenAllowanceAdminConfig = {
  globalMultiplier: defaultMultiplierFromEnv(),
  planAllowances: {},
}

let cached: { config: TokenAllowanceAdminConfig; loadedAt: number } | null = null
const CACHE_MS = 15_000

function defaultMultiplierFromEnv(): number {
  const raw = process.env.APICAL_TOKEN_ALLOWANCE_MULTIPLIER?.trim()
  if (!raw) return 1
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : 1
}

function parseConfig(raw: string | undefined | null): TokenAllowanceAdminConfig {
  if (!raw) return { ...DEFAULT_CONFIG, planAllowances: {} }
  try {
    const parsed = JSON.parse(raw) as Partial<TokenAllowanceAdminConfig>
    const multiplier = parsed.globalMultiplier
    return {
      globalMultiplier:
        typeof multiplier === 'number' && Number.isFinite(multiplier) && multiplier > 0
          ? multiplier
          : DEFAULT_CONFIG.globalMultiplier,
      planAllowances: parsed.planAllowances ?? {},
    }
  } catch {
    return { ...DEFAULT_CONFIG, planAllowances: {} }
  }
}

export async function getTokenAllowanceConfig(): Promise<TokenAllowanceAdminConfig> {
  const now = Date.now()
  if (cached && now - cached.loadedAt < CACHE_MS) return cached.config

  try {
    const row = await db.platformSetting.findUnique({ where: { key: SETTING_KEY } })
    const config = parseConfig(row?.value)
    cached = { config, loadedAt: now }
    return config
  } catch {
    return { ...DEFAULT_CONFIG, planAllowances: {} }
  }
}

export async function saveTokenAllowanceConfig(
  config: TokenAllowanceAdminConfig,
  updatedBy?: string,
): Promise<TokenAllowanceAdminConfig> {
  const normalized: TokenAllowanceAdminConfig = {
    globalMultiplier:
      Number.isFinite(config.globalMultiplier) && config.globalMultiplier > 0
        ? config.globalMultiplier
        : 1,
    planAllowances: config.planAllowances ?? {},
  }

  await db.platformSetting.upsert({
    where: { key: SETTING_KEY },
    create: {
      key: SETTING_KEY,
      value: JSON.stringify(normalized),
      updatedBy: updatedBy ?? null,
    },
    update: {
      value: JSON.stringify(normalized),
      updatedBy: updatedBy ?? null,
    },
  })

  cached = { config: normalized, loadedAt: Date.now() }
  return normalized
}

/** Effective monthly token allowance for enforcement + dashboards. */
export async function resolveEffectiveAllowance(
  sub: Pick<Subscription, 'plan' | 'tokenAllowanceMonthly'>,
): Promise<number> {
  const plan = getPlan(sub.plan)
  const config = await getTokenAllowanceConfig()

  const planOverride = config.planAllowances[plan.id as PlanId]
  if (planOverride !== undefined && planOverride !== null) {
    return planOverride <= 0 ? 0 : Math.round(planOverride)
  }

  const base = sub.tokenAllowanceMonthly || plan.tokenAllowanceMonthly
  if (base <= 0) return 0

  return Math.round(base * config.globalMultiplier)
}

export function planAllowanceCatalog(): Record<PlanId, number> {
  return {
    free: getPlan('free').tokenAllowanceMonthly,
    personal: getPlan('personal').tokenAllowanceMonthly,
    team: getPlan('team').tokenAllowanceMonthly,
    enterprise: getPlan('enterprise').tokenAllowanceMonthly,
  }
}
