import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withAuth } from '@/lib/with-auth'

// GET /v1/webhooks/{id}/deliveries — recent delivery attempts (newest first).
// Failed rows are the dead-letter log for this endpoint.
export const GET = withAuth(
  async (req, ctx) => {
    const endpoint = await db.webhookEndpoint.findFirst({
      where: { id: ctx.params.id, workspaceId: ctx.workspace.id },
      select: { id: true },
    })
    if (!endpoint) {
      return NextResponse.json({ error: 'Webhook not found.' }, { status: 404 })
    }
    const url = new URL(req.url)
    const status = url.searchParams.get('status')
    const rows = await db.webhookDelivery.findMany({
      where: {
        endpointId: endpoint.id,
        ...(status ? { status } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })
    return NextResponse.json({
      deliveries: rows.map((d) => ({
        id: d.id,
        event: d.event,
        status: d.status,
        attempts: d.attempts,
        responseStatus: d.responseStatus,
        lastError: d.lastError,
        createdAt: d.createdAt.toISOString(),
        deliveredAt: d.deliveredAt ? d.deliveredAt.toISOString() : null,
      })),
    })
  },
  { scope: 'webhooks:manage' },
)
