import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { mapWorkflow, mapExecutionPattern } from '@/lib/mappers'
import { withDevAuth } from '@/lib/dev-auth'

interface RouteCtx {
  params: Promise<{ id: string }>
}

// GET /api/dev/agents/[id] — authenticated via bearer API key.
// Returns one agent (mapped, with patterns). Must belong to the developer's
// workspace — otherwise 404 (don't leak existence).
export const GET = withDevAuth(async (_req, { developer, params }) => {
  try {
    const { id } = params
    const row = await db.workflow.findUnique({
      where: { id },
      include: { patterns: true },
    })
    if (!row || row.workspaceId !== developer.workspaceId) {
      return NextResponse.json(
        { error: 'Agent not found in your workspace.' },
        { status: 404 },
      )
    }
    const agent = mapWorkflow(row)
    return NextResponse.json({
      ...agent,
      patterns: row.patterns.map(mapExecutionPattern),
    })
  } catch (err) {
    console.error('[api/dev/agents/[id]] GET failed:', err)
    return NextResponse.json(
      { error: 'Failed to load agent.' },
      { status: 500 },
    )
  }
})
