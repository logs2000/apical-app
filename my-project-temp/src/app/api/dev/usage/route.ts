import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withDevAuth } from '@/lib/dev-auth'

// GET /api/dev/usage?days=30 — usage stats for the developer dashboard.
//
// Computes from McpAuditLog for the developer:
//   - totalCalls
//   - totalCostCents
//   - callsByAction   — { "mcp:deploy": 12, "rest:run": 45, ... }
//   - callsByDay      — last N days, calls + costCents per day
//   - agentsDeployed  — count of workflows with origin='agent' in their workspace
//   - runsTriggered   — count of audit logs with action 'rest:run' or 'mcp:run'
//   - successRate     — %
export const GET = withDevAuth(async (req, { developer }) => {
  try {
    const url = new URL(req.url)
    const daysRaw = Number.parseInt(url.searchParams.get('days') || '30', 10)
    const days = Number.isFinite(daysRaw) && daysRaw > 0 ? Math.min(daysRaw, 365) : 30
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

    const logs = await db.mcpAuditLog.findMany({
      where: { developerId: developer.id, createdAt: { gte: since } },
      orderBy: { createdAt: 'asc' },
    })

    const totalCalls = logs.length
    const totalCostCents = logs.reduce((s, l) => s + l.costCents, 0)
    const successCount = logs.filter((l) => l.success).length
    const successRate = totalCalls > 0 ? Math.round((successCount / totalCalls) * 100) : 100

    const callsByAction: Record<string, number> = {}
    for (const l of logs) {
      callsByAction[l.action] = (callsByAction[l.action] || 0) + 1
    }

    // Bucket by day (YYYY-MM-DD) in the developer's locale.
    const byDay = new Map<string, { calls: number; costCents: number }>()
    // Initialize every day in the window so the chart has no gaps.
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000)
      const key = d.toISOString().slice(0, 10)
      byDay.set(key, { calls: 0, costCents: 0 })
    }
    for (const l of logs) {
      const key = l.createdAt.toISOString().slice(0, 10)
      const bucket = byDay.get(key)
      if (bucket) {
        bucket.calls += 1
        bucket.costCents += l.costCents
      } else {
        // Log outside the initialized window — include anyway.
        byDay.set(key, { calls: 1, costCents: l.costCents })
      }
    }
    const callsByDay = Array.from(byDay.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => ({ date, calls: v.calls, costCents: v.costCents }))

    // Count deployed agents (workflows with origin='agent' in their workspace).
    let agentsDeployed = 0
    if (developer.workspaceId) {
      agentsDeployed = await db.workflow.count({
        where: {
          workspaceId: developer.workspaceId,
          origin: 'agent',
        },
      })
    }

    const runsTriggered = logs.filter(
      (l) => l.action === 'rest:run' || l.action === 'mcp:run',
    ).length

    return NextResponse.json({
      totalCalls,
      totalCostCents,
      callsByAction,
      callsByDay,
      agentsDeployed,
      runsTriggered,
      successRate,
      days,
    })
  } catch (err) {
    console.error('[api/dev/usage] GET failed:', err)
    return NextResponse.json(
      { error: 'Failed to compute usage.' },
      { status: 500 },
    )
  }
})
