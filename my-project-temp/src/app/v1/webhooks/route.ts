import { z } from 'zod'
import { db } from '@/lib/db'
import { withAuth } from '@/lib/with-auth'
import { ok, okEnvelope } from '@/lib/api/respond'
import { parseBody } from '@/lib/api/validate'
import { parsePagination, cursorFilter, cursorOrderBy, paginate } from '@/lib/api/paginate'
import { generateWebhookSecret } from '@/lib/platform/webhooks'

const VALID_EVENTS = ['run.completed', 'run.failed', 'step.failed'] as const

function mapEndpoint(row: {
  id: string
  url: string
  eventsJson: string
  active: boolean
  createdAt: Date
}) {
  let events: string[] = []
  try {
    events = JSON.parse(row.eventsJson) as string[]
  } catch {
    // treat as all events
  }
  return {
    id: row.id,
    url: row.url,
    events,
    active: row.active,
    createdAt: row.createdAt.toISOString(),
  }
}

// GET /v1/webhooks — list the workspace's webhook endpoints (secrets omitted).
export const GET = withAuth(
  async (req, ctx) => {
    const { limit, cursor } = parsePagination(new URL(req.url))
    const rows = await db.webhookEndpoint.findMany({
      where: { workspaceId: ctx.workspace.id, ...cursorFilter(cursor) },
      orderBy: cursorOrderBy(),
      take: limit + 1,
    })
    const page = paginate(rows, limit)
    return okEnvelope({ data: page.data.map(mapEndpoint), page: page.page })
  },
  { scope: 'webhooks:manage', rateLimit: { limit: 120, windowMs: 60_000 } },
)

const CreateWebhookSchema = z.object({
  url: z.string().regex(/^https?:\/\//, 'url is required and must be http(s)'),
  events: z.array(z.string()).optional(),
})

// POST /v1/webhooks — register an endpoint. Body: { url, events?: string[] }.
// The signing secret is returned ONCE; verify deliveries with
// X-Apical-Signature: t=<unix>,v1=hex(hmac_sha256(secret, `${t}.${body}`)).
export const POST = withAuth(
  async (req, ctx) => {
    const body = await parseBody(req, CreateWebhookSchema)
    const events = (body.events ?? []).filter((e): e is (typeof VALID_EVENTS)[number] =>
      (VALID_EVENTS as readonly string[]).includes(e),
    )

    const secret = generateWebhookSecret()
    const row = await db.webhookEndpoint.create({
      data: {
        workspaceId: ctx.workspace.id,
        url: body.url,
        secret,
        eventsJson: JSON.stringify(events),
      },
    })
    return ok({ ...mapEndpoint(row), secret }, { status: 201 })
  },
  { scope: 'webhooks:manage', rateLimit: { limit: 60, windowMs: 60_000 } },
)
