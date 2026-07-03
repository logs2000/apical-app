import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withAuth } from '@/lib/with-auth'
import { mapRunV1, workflowScopeWhere } from '@/lib/v1/mappers'

// GET /v1/runs — list runs across the workspace's workflows.
// Query: workflowId?, status?, limit? (default 50, max 200).
export const GET = withAuth(
  async (req, { workspace, user }) => {
    const url = new URL(req.url)
    const workflowId = url.searchParams.get('workflowId')
    const status = url.searchParams.get('status')
    const limit = Math.min(Number(url.searchParams.get('limit')) || 50, 200)

    const rows = await db.run.findMany({
      where: {
        workflow: {
          ...workflowScopeWhere(workspace.id, user?.id ?? null),
          ...(workflowId ? { id: workflowId } : {}),
        },
        ...(status ? { status } : {}),
      },
      orderBy: { startedAt: 'desc' },
      take: limit,
    })
    return NextResponse.json({ runs: rows.map((r) => mapRunV1(r)) })
  },
  { scope: 'runs:read' },
)
