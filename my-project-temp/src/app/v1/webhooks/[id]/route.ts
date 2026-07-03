import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withAuth } from '@/lib/with-auth'

// PATCH /v1/webhooks/{id} — enable/disable or change the URL/events.
export const PATCH = withAuth(
  async (req, ctx) => {
    const row = await db.webhookEndpoint.findFirst({
      where: { id: ctx.params.id, workspaceId: ctx.workspace.id },
    })
    if (!row) {
      return NextResponse.json({ error: 'Webhook not found.' }, { status: 404 })
    }
    const body = (await req.json().catch(() => ({}))) as {
      url?: string
      events?: string[]
      active?: boolean
    }
    const updated = await db.webhookEndpoint.update({
      where: { id: row.id },
      data: {
        ...(typeof body.url === 'string' && /^https?:\/\//.test(body.url)
          ? { url: body.url }
          : {}),
        ...(Array.isArray(body.events)
          ? { eventsJson: JSON.stringify(body.events) }
          : {}),
        ...(typeof body.active === 'boolean' ? { active: body.active } : {}),
      },
    })
    return NextResponse.json({
      webhook: {
        id: updated.id,
        url: updated.url,
        events: JSON.parse(updated.eventsJson) as string[],
        active: updated.active,
        createdAt: updated.createdAt.toISOString(),
      },
    })
  },
  { scope: 'webhooks:manage' },
)

// DELETE /v1/webhooks/{id} — remove the endpoint (and its delivery log).
export const DELETE = withAuth(
  async (_req, ctx) => {
    const row = await db.webhookEndpoint.findFirst({
      where: { id: ctx.params.id, workspaceId: ctx.workspace.id },
      select: { id: true },
    })
    if (!row) {
      return NextResponse.json({ error: 'Webhook not found.' }, { status: 404 })
    }
    await db.webhookEndpoint.delete({ where: { id: row.id } })
    return NextResponse.json({ ok: true })
  },
  { scope: 'webhooks:manage' },
)
