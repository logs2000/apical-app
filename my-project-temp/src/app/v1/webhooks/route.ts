import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withAuth } from '@/lib/with-auth'
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
  async (_req, ctx) => {
    const rows = await db.webhookEndpoint.findMany({
      where: { workspaceId: ctx.workspace.id },
      orderBy: { createdAt: 'desc' },
    })
    return NextResponse.json({ webhooks: rows.map(mapEndpoint) })
  },
  { scope: 'webhooks:manage' },
)

// POST /v1/webhooks — register an endpoint. Body: { url, events?: string[] }.
// The signing secret is returned ONCE; verify deliveries with
// X-Apical-Signature: t=<unix>,v1=hex(hmac_sha256(secret, `${t}.${body}`)).
export const POST = withAuth(
  async (req, ctx) => {
    const body = (await req.json().catch(() => ({}))) as {
      url?: string
      events?: string[]
    }
    if (!body.url || !/^https?:\/\//.test(body.url)) {
      return NextResponse.json(
        { error: 'url is required and must be http(s).' },
        { status: 400 },
      )
    }
    const events = Array.isArray(body.events)
      ? body.events.filter((e): e is (typeof VALID_EVENTS)[number] =>
          (VALID_EVENTS as readonly string[]).includes(e),
        )
      : []

    const secret = generateWebhookSecret()
    const row = await db.webhookEndpoint.create({
      data: {
        workspaceId: ctx.workspace.id,
        url: body.url,
        secret,
        eventsJson: JSON.stringify(events),
      },
    })
    return NextResponse.json(
      { webhook: mapEndpoint(row), secret },
      { status: 201 },
    )
  },
  { scope: 'webhooks:manage' },
)
