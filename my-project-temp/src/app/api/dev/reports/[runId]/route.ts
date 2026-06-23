import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { mapRun } from '@/lib/mappers'
import { withDevAuth } from '@/lib/dev-auth'

interface RouteCtx {
  params: Promise<{ runId: string }>
}

// GET /api/dev/reports/[runId] — authenticated via bearer API key.
// Returns { run: Run } — the run + its report + steps. The run must belong to
// an agent (workflow) in the developer's workspace.
export const GET = withDevAuth(async (_req, { developer, apiKey, params }) => {
  try {
    const { runId } = params
    const row = await db.run.findUnique({
      where: { id: runId },
      include: {
        workflow: { select: { name: true, workspaceId: true } },
        steps: { orderBy: { order: 'asc' } },
      },
    })
    if (!row || row.workflow?.workspaceId !== developer.workspaceId) {
      return NextResponse.json(
        { error: 'Report not found in your workspace.' },
        { status: 404 },
      )
    }

    // Audit log (reads are free).
    await db.mcpAuditLog.create({
      data: {
        developerId: developer.id,
        apiKeyId: apiKey.id,
        action: 'mcp:get_report',
        target: runId,
        success: true,
        costCents: 0,
        detail: `Fetched report for run ${runId}.`,
        source: 'mcp',
      },
    }).catch((e) => {
      // Don't fail the request if the audit log write fails.
      console.error('[api/dev/reports/[runId]] audit log failed:', e)
    })

    return NextResponse.json({
      run: mapRun(row, row.workflow?.name || 'Unknown'),
    })
  } catch (err) {
    console.error('[api/dev/reports/[runId]] GET failed:', err)
    return NextResponse.json(
      { error: 'Failed to load report.' },
      { status: 500 },
    )
  }
})
