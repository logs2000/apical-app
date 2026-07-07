import { db } from '@/lib/db'
import { withAuth } from '@/lib/with-auth'
import { okEnvelope } from '@/lib/api/respond'
import { parsePagination, cursorFilter, cursorOrderBy, paginate } from '@/lib/api/paginate'
import { mapRunV1, workflowScopeWhere } from '@/lib/v1/mappers'

// GET /v1/runs — list runs across the workspace's workflows (cursor-paginated
// by startedAt). Query: workflowId?, status?, limit? (default 50, max 200),
// cursor?.
export const GET = withAuth(
  async (req, { workspace, user }) => {
    const url = new URL(req.url)
    const workflowId = url.searchParams.get('workflowId')
    const status = url.searchParams.get('status')
    const { limit, cursor } = parsePagination(url)

    const rows = await db.run.findMany({
      where: {
        workflow: {
          ...workflowScopeWhere(workspace.id, user?.id ?? null),
          ...(workflowId ? { id: workflowId } : {}),
        },
        ...(status ? { status } : {}),
        ...cursorFilter(cursor, 'startedAt'),
      },
      orderBy: cursorOrderBy('startedAt'),
      take: limit + 1,
    })
    const page = paginate(rows, limit, 'startedAt')
    return okEnvelope({ data: page.data.map((r) => mapRunV1(r)), page: page.page })
  },
  { scope: 'runs:read', rateLimit: { limit: 120, windowMs: 60_000 } },
)
