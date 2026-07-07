import { db } from '@/lib/db'
import { withAuth } from '@/lib/with-auth'
import { okEnvelope, ApiError } from '@/lib/api/respond'
import { parsePagination, cursorFilter, cursorOrderBy, paginate } from '@/lib/api/paginate'

// GET /v1/webhooks/{id}/deliveries — delivery attempts (newest first,
// cursor-paginated). Failed rows are the dead-letter log for this endpoint.
export const GET = withAuth(
  async (req, ctx) => {
    const endpoint = await db.webhookEndpoint.findFirst({
      where: { id: ctx.params.id, workspaceId: ctx.workspace.id },
      select: { id: true },
    })
    if (!endpoint) throw new ApiError('not_found', 'Webhook not found.')
    const url = new URL(req.url)
    const status = url.searchParams.get('status')
    const { limit, cursor } = parsePagination(url)
    const rows = await db.webhookDelivery.findMany({
      where: {
        endpointId: endpoint.id,
        ...(status ? { status } : {}),
        ...cursorFilter(cursor),
      },
      orderBy: cursorOrderBy(),
      take: limit + 1,
    })
    const page = paginate(rows, limit)
    return okEnvelope({
      data: page.data.map((d) => ({
        id: d.id,
        event: d.event,
        status: d.status,
        attempts: d.attempts,
        responseStatus: d.responseStatus,
        lastError: d.lastError,
        createdAt: d.createdAt.toISOString(),
        deliveredAt: d.deliveredAt ? d.deliveredAt.toISOString() : null,
      })),
      page: page.page,
    })
  },
  { scope: 'webhooks:manage', rateLimit: { limit: 120, windowMs: 60_000 } },
)
