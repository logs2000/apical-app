import { z } from 'zod'
import { db } from '@/lib/db'
import { withAuth } from '@/lib/with-auth'
import { ok, ApiError } from '@/lib/api/respond'
import { parseBody } from '@/lib/api/validate'

const PatchWebhookSchema = z.object({
  url: z.string().regex(/^https?:\/\//).optional(),
  events: z.array(z.string()).optional(),
  active: z.boolean().optional(),
})

// PATCH /v1/webhooks/{id} — enable/disable or change the URL/events.
export const PATCH = withAuth(
  async (req, ctx) => {
    const row = await db.webhookEndpoint.findFirst({
      where: { id: ctx.params.id, workspaceId: ctx.workspace.id },
    })
    if (!row) throw new ApiError('not_found', 'Webhook not found.')
    const body = await parseBody(req, PatchWebhookSchema)
    const updated = await db.webhookEndpoint.update({
      where: { id: row.id },
      data: {
        ...(body.url ? { url: body.url } : {}),
        ...(body.events ? { eventsJson: JSON.stringify(body.events) } : {}),
        ...(typeof body.active === 'boolean' ? { active: body.active } : {}),
      },
    })
    return ok({
      id: updated.id,
      url: updated.url,
      events: JSON.parse(updated.eventsJson) as string[],
      active: updated.active,
      createdAt: updated.createdAt.toISOString(),
    })
  },
  { scope: 'webhooks:manage', rateLimit: { limit: 60, windowMs: 60_000 } },
)

// DELETE /v1/webhooks/{id} — remove the endpoint (and its delivery log).
export const DELETE = withAuth(
  async (_req, ctx) => {
    const row = await db.webhookEndpoint.findFirst({
      where: { id: ctx.params.id, workspaceId: ctx.workspace.id },
      select: { id: true },
    })
    if (!row) throw new ApiError('not_found', 'Webhook not found.')
    await db.webhookEndpoint.delete({ where: { id: row.id } })
    return ok({ deleted: true })
  },
  { scope: 'webhooks:manage', rateLimit: { limit: 60, windowMs: 60_000 } },
)
