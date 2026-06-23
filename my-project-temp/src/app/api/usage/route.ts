// GET /api/usage — aggregated token-usage dashboard for the current user.
//
// Returns:
//   {
//     current: { used, allowance, overage, overrunEnabled, periodEnd, plan },
//     byModel: [{ modelId, provider, totalTokens, costCents, calls }],
//     byDay:   [{ date, tokens, costCents }],
//     recent:  [TokenUsageRecord first 20]
//   }
//
// The "current billing period" is bounded by:
//   start = subscription.currentPeriodEnd (minus 1 month) OR subscription.createdAt
//   end   = subscription.currentPeriodEnd OR now

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withUser } from '@/lib/auth-helpers'
import { getPlan } from '@/lib/platform/pricing'

async function getOrCreateSubscription(userId: string) {
  let sub = await db.subscription.findUnique({ where: { userId } })
  if (!sub) {
    const plan = getPlan('free')
    const periodEnd = new Date()
    periodEnd.setDate(periodEnd.getDate() + 30)
    sub = await db.subscription.create({
      data: {
        userId,
        plan: 'free',
        status: 'active',
        tokenAllowanceMonthly: plan.tokenAllowanceMonthly,
        currentPeriodEnd: periodEnd,
      },
    })
  }
  return sub
}

function periodStart(sub: { currentPeriodEnd: Date | null; createdAt: Date }): Date {
  if (sub.currentPeriodEnd) {
    const start = new Date(sub.currentPeriodEnd)
    start.setMonth(start.getMonth() - 1)
    return start > sub.createdAt ? start : sub.createdAt
  }
  return sub.createdAt
}

export const GET = withUser(async (_req, { user }) => {
  const sub = await getOrCreateSubscription(user.id)
  const plan = getPlan(sub.plan)
  const allowance = sub.tokenAllowanceMonthly || plan.tokenAllowanceMonthly
  const used = sub.tokenUsedMonthly
  const overage = Math.max(0, used - allowance)

  const start = periodStart(sub)
  const end = sub.currentPeriodEnd ?? new Date()

  // All records in this billing period.
  const records = await db.tokenUsageRecord.findMany({
    where: {
      userId: user.id,
      createdAt: { gte: start, lte: end },
    },
    orderBy: { createdAt: 'desc' },
  })

  // Aggregate by model.
  const byModelMap = new Map<
    string,
    { modelId: string; provider: string; totalTokens: number; costCents: number; calls: number }
  >()
  for (const r of records) {
    const key = `${r.provider}::${r.modelId}`
    const entry = byModelMap.get(key) ?? {
      modelId: r.modelId,
      provider: r.provider,
      totalTokens: 0,
      costCents: 0,
      calls: 0,
    }
    entry.totalTokens += r.totalTokens
    entry.costCents += r.costCents
    entry.calls += 1
    byModelMap.set(key, entry)
  }
  const byModel = Array.from(byModelMap.values()).sort((a, b) => b.totalTokens - a.totalTokens)

  // Aggregate by day (YYYY-MM-DD) — initialize every day in the window so the
  // chart has no gaps. Cap the window to the last 90 days so a long-running
  // user doesn't get a huge array.
  const byDay = new Map<string, { tokens: number; costCents: number }>()
  const today = new Date()
  const windowDays = Math.min(
    90,
    Math.max(1, Math.ceil((today.getTime() - start.getTime()) / (24 * 60 * 60 * 1000))),
  )
  for (let i = windowDays - 1; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    byDay.set(d.toISOString().slice(0, 10), { tokens: 0, costCents: 0 })
  }
  for (const r of records) {
    const key = r.createdAt.toISOString().slice(0, 10)
    const bucket = byDay.get(key)
    if (bucket) {
      bucket.tokens += r.totalTokens
      bucket.costCents += r.costCents
    } else {
      // Log outside the window — include at the right position.
      byDay.set(key, { tokens: r.totalTokens, costCents: r.costCents })
    }
  }
  const byDayArr = Array.from(byDay.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({ date, tokens: v.tokens, costCents: v.costCents }))

  return NextResponse.json({
    current: {
      used,
      allowance,
      overage,
      overrunEnabled: sub.overrunEnabled && plan.overrunAvailable,
      periodEnd: sub.currentPeriodEnd,
      plan: sub.plan,
    },
    byModel,
    byDay: byDayArr,
    recent: records.slice(0, 20).map((r) => ({
      id: r.id,
      modelId: r.modelId,
      provider: r.provider,
      promptTokens: r.promptTokens,
      completionTokens: r.completionTokens,
      totalTokens: r.totalTokens,
      costCents: r.costCents,
      source: r.source,
      refId: r.refId,
      createdAt: r.createdAt,
    })),
  })
})
