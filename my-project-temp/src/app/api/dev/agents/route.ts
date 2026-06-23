import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { mapWorkflow } from '@/lib/mappers'
import { withDevAuth } from '@/lib/dev-auth'

// GET /api/dev/agents — authenticated via bearer API key.
// Lists the developer's workflows (by workspaceId). Returns Workflow[] (mapped).
export const GET = withDevAuth(async (_req, { developer, apiKey }) => {
  try {
    if (!developer.workspaceId) {
      return NextResponse.json([])
    }
    const rows = await db.workflow.findMany({
      where: { workspaceId: developer.workspaceId },
      orderBy: { updatedAt: 'desc' },
    })

    // Best-effort audit log (reads are free).
    void db.mcpAuditLog
      .create({
        data: {
          developerId: developer.id,
          apiKeyId: apiKey.id,
          action: 'mcp:list_agents',
          target: developer.workspaceId,
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
