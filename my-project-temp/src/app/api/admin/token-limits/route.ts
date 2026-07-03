// GET/PATCH /api/admin/token-limits — platform operator token allowance config.
//
// GET  → { config, catalog, effectiveByPlan }
// PATCH { globalMultiplier?, planAllowances? } → updated config
//
// Requires APICAL_ADMIN_EMAILS and a signed-in admin user.

import { NextResponse } from 'next/server'
import { withUser, isAdminUser } from '@/lib/auth-helpers'
import {
  getTokenAllowanceConfig,
  saveTokenAllowanceConfig,
  planAllowanceCatalog,
  resolveEffectiveAllowance,
  type TokenAllowanceAdminConfig,
} from '@/lib/platform/token-allowance-config'
import { getPlan, type PlanId } from '@/lib/platform/pricing'
import { db } from '@/lib/db'

const PLAN_IDS: PlanId[] = ['free', 'personal', 'team', 'enterprise']

async function effectiveByPlan(config: TokenAllowanceAdminConfig) {
  const out: Record<PlanId, number> = {
    free: 0,
    personal: 0,
    team: 0,
    enterprise: 0,
  }
  for (const id of PLAN_IDS) {
    const plan = getPlan(id)
    const override = config.planAllowances[id]
    if (override !== undefined && override !== null) {
      out[id] = override <= 0 ? 0 : Math.round(override)
      continue
    }
    const base = plan.tokenAllowanceMonthly
    out[id] = base <= 0 ? 0 : Math.round(base * config.globalMultiplier)
  }
  return out
}

export const GET = withUser(async (_req, { user }) => {
  if (!isAdminUser(user)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const config = await getTokenAllowanceConfig()
  return NextResponse.json({
    config,
    catalog: planAllowanceCatalog(),
    effectiveByPlan: await effectiveByPlan(config),
  })
})

export const PATCH = withUser(async (req, { user }) => {
  if (!isAdminUser(user)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: Partial<TokenAllowanceAdminConfig>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const current = await getTokenAllowanceConfig()
  const next: TokenAllowanceAdminConfig = {
    globalMultiplier:
      typeof body.globalMultiplier === 'number' && body.globalMultiplier > 0
        ? body.globalMultiplier
        : current.globalMultiplier,
    planAllowances: { ...current.planAllowances },
  }

  if (body.planAllowances && typeof body.planAllowances === 'object') {
    for (const id of PLAN_IDS) {
      const val = body.planAllowances[id]
      if (val === null || val === undefined) {
        delete next.planAllowances[id]
      } else if (typeof val === 'number' && Number.isFinite(val) && val >= 0) {
        next.planAllowances[id] = Math.round(val)
      }
    }
  }

  const saved = await saveTokenAllowanceConfig(next, user.email)
  return NextResponse.json({
    config: saved,
    catalog: planAllowanceCatalog(),
    effectiveByPlan: await effectiveByPlan(saved),
  })
})

/** Optional: sample effective allowance for a user subscription (admin debug). */
export const POST = withUser(async (req, { user }) => {
  if (!isAdminUser(user)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: { userId?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const targetId = body.userId?.trim() || user.id
  const sub = await db.subscription.findUnique({ where: { userId: targetId } })
  if (!sub) {
    return NextResponse.json({ error: 'Subscription not found' }, { status: 404 })
  }

  const allowance = await resolveEffectiveAllowance(sub)
  return NextResponse.json({
    userId: targetId,
    plan: sub.plan,
    used: sub.tokenUsedMonthly,
    allowance,
    periodEnd: sub.currentPeriodEnd,
  })
})
