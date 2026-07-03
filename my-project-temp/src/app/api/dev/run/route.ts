import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withDevAuth } from '@/lib/dev-auth'
import { startWorkflowRun, StartRunError } from '@/lib/platform/start-run'

// The flat per-run cost charged to developer balances. Same for every run for now.
const RUN_COST_CENTS = 3

// POST /api/dev/run — authenticated via bearer API key (NOT cookie).
// Body: { agentId: string }. Triggers a run on the agent (same mechanics as
// /api/workflows/[id]/run: create Run + RunSteps, fire-and-forget executeRun).
// Deducts RUN_COST_CENTS from the workspace's balanceCents; if balance < 0,
// returns 402. Logs to McpAuditLog with action 'mcp:run', costCents=3, source='mcp'.
export const POST = withDevAuth(async (req, { workspace, apiKey }) => {
  try {
    const body = (await req.json().catch(() => ({}))) as { agentId?: string }
    const agentId = typeof body.agentId === 'string' ? body.agentId.trim() : ''
    if (!agentId) {
      return NextResponse.json(
        { error: 'agentId is required.' },
        { status: 400 },
      )
    }

    // Verify the workflow exists AND belongs to the workspace.
    const workflow = await db.workflow.findUnique({ where: { id: agentId } })
    if (!workflow || workflow.workspaceId !== workspace.id) {
      return NextResponse.json(
        { error: 'Agent not found in your workspace.' },
        { status: 404 },
      )
    }
    // Per-key spend limit check.
    if (
      apiKey.spendLimitCents != null &&
      apiKey.spentCents + RUN_COST_CENTS > apiKey.spendLimitCents
    ) {
      await db.mcpAuditLog.create({
        data: {
          workspaceId: workspace.id,
          apiKeyId: apiKey.id,
          action: 'mcp:run',
          target: agentId,
          success: false,
          costCents: 0,
          detail: `Key spend limit reached (${apiKey.spentCents}/${apiKey.spendLimitCents}¢) — run refused.`,
          source: 'mcp',
        },
      })
      return NextResponse.json(
        { error: 'API key spend limit reached' },
        { status: 402 },
      )
    }

    // Balance check — 402 if already negative.
    if (workspace.balanceCents < 0) {
      await db.mcpAuditLog.create({
        data: {
          workspaceId: workspace.id,
          apiKeyId: apiKey.id,
          action: 'mcp:run',
          target: agentId,
          success: false,
          costCents: 0,
          detail: `Insufficient balance (${workspace.balanceCents}¢) — run refused.`,
          source: 'mcp',
        },
      })
      return NextResponse.json(
        { error: 'Insufficient balance' },
        { status: 402 },
      )
    }

    // Create + start the run (pinned to the active revision). Only charge
    // once the run actually started.
    let runId: string
    try {
      const started = await startWorkflowRun(workflow, { trigger: 'manual' })
      runId = started.runId
    } catch (e) {
      if (e instanceof StartRunError) {
        return NextResponse.json({ error: e.message }, { status: e.status })
      }
      throw e
    }

    // Deduct the run cost (workspace balance + per-key spent counter).
    await db.workspace.update({
      where: { id: workspace.id },
      data: { balanceCents: { decrement: RUN_COST_CENTS } },
    })
    await db.apiKey.update({
      where: { id: apiKey.id },
      data: { spentCents: { increment: RUN_COST_CENTS } },
    })

    // Audit log.
    await db.mcpAuditLog.create({
      data: {
        workspaceId: workspace.id,
        apiKeyId: apiKey.id,
        action: 'mcp:run',
        target: runId,
        success: true,
        costCents: RUN_COST_CENTS,
        detail: `Triggered run on agent "${workflow.name}" (${agentId}).`,
        source: 'mcp',
      },
    })

    return NextResponse.json({ runId, status: 'running' })
  } catch (err) {
    console.error('[api/dev/run] POST failed:', err)
    return NextResponse.json(
      { error: 'Failed to start run.' },
      { status: 500 },
    )
  }
})
