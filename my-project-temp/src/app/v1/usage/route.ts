import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withAuth } from '@/lib/with-auth'
import { RUN_COST_CENTS } from '@/lib/platform/run-billing'
import { workflowScopeWhere } from '@/lib/v1/mappers'

// GET /v1/usage — workspace balance, plan, per-key spend, and recent run
// activity. Scope: usage:read.
export const GET = withAuth(
  async (req, { workspace, apiKey, user }) => {
    const url = new URL(req.url)
    const days = Math.min(Math.max(Number(url.searchParams.get('days')) || 30, 1), 90)
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

    const [runsCount, failedCount, audit, keys] = await Promise.all([
      db.run.count({
        where: {
          workflow: workflowScopeWhere(workspace.id, user?.id ?? null),
          startedAt: { gte: since },
        },
      }),
      db.run.count({
        where: {
          workflow: workflowScopeWhere(workspace.id, user?.id ?? null),
          startedAt: { gte: since },
          status: 'failed',
        },
      }),
      db.mcpAuditLog.aggregate({
        where: { workspaceId: workspace.id, createdAt: { gte: since } },
        _sum: { costCents: true },
        _count: true,
      }),
      db.apiKey.findMany({
        where: { workspaceId: workspace.id, status: 'active' },
        select: {
          id: true,
          label: true,
          keyPrefix: true,
          spentCents: true,
          spendLimitCents: true,
          lastUsedAt: true,
        },
      }),
    ])

    return NextResponse.json({
      workspace: {
        id: workspace.id,
        plan: workspace.plan,
        balanceCents: workspace.balanceCents,
      },
      period: { days, since: since.toISOString() },
      runs: { total: runsCount, failed: failedCount, costCentsPerRun: RUN_COST_CENTS },
      spend: {
        totalCents: audit._sum.costCents ?? 0,
        events: audit._count,
      },
      keys: keys.map((k) => ({
        id: k.id,
        label: k.label,
        keyPrefix: k.keyPrefix,
        spentCents: k.spentCents,
        spendLimitCents: k.spendLimitCents,
        remainingCents:
          k.spendLimitCents > 0 ? Math.max(0, k.spendLimitCents - k.spentCents) : null,
        lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
      })),
      // The requesting key's own budget, for quick self-checks.
      currentKey: apiKey
        ? {
            id: apiKey.id,
            spentCents: apiKey.spentCents,
            spendLimitCents: apiKey.spendLimitCents,
          }
        : null,
    })
  },
  { scope: 'usage:read' },
)
