import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { executeRun, parseSteps } from '@/lib/runtime'
import { broadcastRun } from '@/lib/relay-client'
import { withDevAuth } from '@/lib/dev-auth'

// The flat per-run cost charged to developer balances. Same for every run for now.
const RUN_COST_CENTS = 3

// POST /api/dev/run — authenticated via bearer API key (NOT cookie).
// Body: { agentId: string }. Triggers a run on the agent (same mechanics as
// /api/workflows/[id]/run: create Run + RunSteps, fire-and-forget executeRun).
// Deducts RUN_COST_CENTS from the developer's balanceCents; if balance < 0,
// returns 402. Logs to McpAuditLog with action 'mcp:run', costCents=3, source='mcp'.
export const POST = withDevAuth(async (req, { developer, apiKey }) => {
  try {
    const body = (await req.json().catch(() => ({}))) as { agentId?: string }
    const agentId = typeof body.agentId === 'string' ? body.agentId.trim() : ''
    if (!agentId) {
      return NextResponse.json(
        { error: 'agentId is required.' },
        { status: 400 },
      )
    }

    // Verify the workflow exists AND belongs to the developer's workspace.
    const workflow = await db.workflow.findUnique({ where: { id: agentId } })
    if (!workflow || workflow.workspaceId !== developer.workspaceId) {
      return NextResponse.json(
        { error: 'Agent not found in your workspace.' },
        { status: 404 },
      )
    }
    const steps = parseSteps(workflow.stepsJson)
    if (steps.length === 0) {
      return NextResponse.json(
        { error: 'Agent has no steps to run.' },
        { status: 400 },
      )
    }

    // Balance check — 402 if already negative.
    if (developer.balanceCents < 0) {
      await db.mcpAuditLog.create({
        data: {
          developerId: developer.id,
          apiKeyId: apiKey.id,
          action: 'mcp:run',
          target: agentId,
          success: false,
          costCents: 0,
          detail: `Insufficient balance (${developer.balanceCents}¢) — run refused.`,
          source: 'mcp',
        },
      })
      return NextResponse.json(
        { error: 'Insufficient balance' },
        { status: 402 },
      )
    }

    // Deduct the run cost.
    await db.developerAccount.update({
      where: { id: developer.id },
      data: { balanceCents: { decrement: RUN_COST_CENTS } },
    })

    // Create the run record.
    const run = await db.run.create({
      data: {
        workflowId: agentId,
        status: 'running',
        trigger: 'manual',
        startedAt: new Date(),
      },
    })
    await db.runStep.createMany({
      data: steps.map((s, i) => ({
        runId: run.id,
        stepId: s.id,
        kind: s.kind,
        label: s.label,
        status: 'pending',
        order: i,
      })),
    })

    // Make sure the relay is warm — pre-broadcast a no-op so the socket
    // connects before the first real event.
    broadcastRun(run.id, 'run:started', { runId: run.id, workflowId: agentId })

    // Fire and forget — the runtime streams progress over the relay.
    void executeRun(
      run.id,
      { ...workflow, userId: workflow.userId ?? developer.id },
      steps,
      'manual',
    ).catch((err) => {
      console.error('[api/dev/run] executeRun crashed:', err)
    })

    // Audit log.
    await db.mcpAuditLog.create({
      data: {
        developerId: developer.id,
        apiKeyId: apiKey.id,
        action: 'mcp:run',
        target: run.id,
        success: true,
        costCents: RUN_COST_CENTS,
        detail: `Triggered run on agent "${workflow.name}" (${agentId}).`,
        source: 'mcp',
      },
    })

    return NextResponse.json({ runId: run.id, status: 'running' })
  } catch (err) {
    console.error('[api/dev/run] POST failed:', err)
    return NextResponse.json(
      { error: 'Failed to start run.' },
      { status: 500 },
    )
  }
})
