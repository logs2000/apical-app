import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { mapWorkflow } from '@/lib/mappers'
import { withDevAuth } from '@/lib/dev-auth'

// GET /api/dev/agents — authenticated via bearer API key.
// Lists the workspace's workflows. Returns Workflow[] (mapped).
export const GET = withDevAuth(async (_req, { workspace, apiKey }) => {
  try {
    const rows = await db.workflow.findMany({
      where: { workspaceId: workspace.id },
      orderBy: { updatedAt: 'desc' },
    })

    // Best-effort audit log (reads are free).
    void db.mcpAuditLog
      .create({
        data: {
          workspaceId: workspace.id,
          apiKeyId: apiKey.id,
          action: 'mcp:list_agents',
          target: workspace.id,
          success: true,
          costCents: 0,
          detail: `Listed ${rows.length} agent(s).`,
          source: 'mcp',
        },
      })
      .catch((e) => {
        console.error('[api/dev/agents] audit log failed:', e)
      })

    return NextResponse.json(rows.map(mapWorkflow))
  } catch (err) {
    console.error('[api/dev/agents] GET failed:', err)
    return NextResponse.json(
      { error: 'Failed to list agents.' },
      { status: 500 },
    )
  }
})
