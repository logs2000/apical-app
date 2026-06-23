import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth-helpers'

// GET /api/stats — dashboard rollups, scoped to the current user's
// workflows + runs. Anonymous callers get 401.
export async function GET(req: Request) {
  try {
    const user = await getCurrentUser(req)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    // Workflow.userId is optional on the schema (legacy seed rows can be
    // null). Scope to this user's rows; null-userId rows are skipped.
    const workflowOwner = { userId: user.id }
    const runThroughWorkflow = { workflow: workflowOwner }

    const startOfToday = new Date()
    startOfToday.setHours(0, 0, 0, 0)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

    const [
      workflows,
      activeWorkflows,
      runsToday,
      recentRuns,
      lastWeekRuns,
      workflowsAgg,
      flaggedRuns,
      hardeningOpportunities,
    ] = await Promise.all([
      db.workflow.count({ where: workflowOwner }),
      db.workflow.count({ where: { ...workflowOwner, status: 'active' } }),
      db.run.count({
        where: {
          ...runThroughWorkflow,
          startedAt: { gte: startOfToday },
        },
      }),
      db.run.findMany({
        where: runThroughWorkflow,
        take: 100,
        orderBy: { startedAt: 'desc' },
        select: { flaggedCount: true, status: true },
      }),
      db.run.findMany({
        where: {
          ...runThroughWorkflow,
          startedAt: { gte: sevenDaysAgo },
        },
        select: { itemsProcessed: true },
      }),
      db.workflow.aggregate({
        where: workflowOwner,
        _sum: {
          aiCallsSaved: true,
          estCostSavedCents: true,
          itemsProcessed: true,
          automaticCount: true,
        },
      }),
      db.run.count({
        where: {
          ...runThroughWorkflow,
          flaggedCount: { gt: 0 },
          status: { not: 'completed' },
        },
      }),
      db.executionPattern.count({
        where: {
          workflow: workflowOwner,
          hardened: false,
          occurrences: { gte: 5 },
        },
      }),
    ])

    // flaggedOpen: count of recent runs with flaggedCount>0 (not strictly
    // limited to "open" since most seeded runs are completed; include the
    // strictly-open count above plus recent flagged runs to surface real work).
    const recentFlagged = recentRuns.filter((r) => r.flaggedCount > 0).length
    const flaggedOpen = flaggedRuns + recentFlagged

    const itemsThisWeek = lastWeekRuns.reduce(
      (sum, r) => sum + (r.itemsProcessed || 0),
      0,
    )

    const itemsTotal = workflowsAgg._sum.itemsProcessed || 0
    const automaticTotal = workflowsAgg._sum.automaticCount || 0
    const automaticPct =
      itemsTotal > 0 ? Math.round((automaticTotal / itemsTotal) * 100) : 0

    return NextResponse.json({
      workflows,
      activeWorkflows,
      runsToday,
      itemsThisWeek,
      automaticPct,
      aiCallsSaved: workflowsAgg._sum.aiCallsSaved || 0,
      estCostSavedCents: workflowsAgg._sum.estCostSavedCents || 0,
      flaggedOpen,
      hardeningOpportunities,
    })
  } catch (err) {
    console.error('[api/stats] failed:', err)
    return NextResponse.json(
      { error: 'Failed to load stats' },
      { status: 500 },
    )
  }
}
