import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withAuth } from '@/lib/with-auth'
import { encryptSecretMetaFields, redactSecretMetaFields } from '@/lib/platform/vault'

// GET /v1/credentials — the workspace's vault entries (metadata only —
// secret fields are always redacted; raw secrets never leave the vault).
export const GET = withAuth(
  async (req, { workspace, user }) => {
    const rows = await db.credential.findMany({
      where: {
        OR: [
          { workspaceId: workspace.id },
          ...(user ? [{ userId: user.id, workspaceId: null }] : []),
        ],
      },
      orderBy: { createdAt: 'desc' },
    })
    return NextResponse.json({
      credentials: rows.map((c) => ({
        id: c.id,
        service: c.service,
        label: c.label,
        kind: c.kind,
        status: c.status,
        connectedAccountId: c.connectedAccountId,
        meta: redactSecretMetaFields(safeParse(c.metaJson) ?? {}),
        createdAt: c.createdAt.toISOString(),
      })),
    })
  },
  { scope: 'credentials:manage' },
)

interface CreateBody {
  service?: string
  label?: string
  kind?: 'oauth' | 'apikey' | 'payment' | 'mcp_token'
  /** Secret + non-secret fields. Secret-shaped keys are encrypted at rest. */
  meta?: Record<string, unknown>
  connectedAccountId?: string
}

// POST /v1/credentials — add a credential to the workspace vault.
export const POST = withAuth(
  async (req, { workspace, user }) => {
    const body = (await req.json().catch(() => ({}))) as CreateBody
    const service = (body.service || '').trim()
    if (!service) {
      return NextResponse.json({ error: 'service is required.' }, { status: 400 })
    }
    const kind =
      body.kind === 'oauth' || body.kind === 'payment' || body.kind === 'mcp_token'
        ? body.kind
        : 'apikey'
    const meta =
      body.meta && typeof body.meta === 'object' && !Array.isArray(body.meta)
        ? body.meta
        : {}

    // Optional connected-account binding (must be in this workspace).
    let connectedAccountId: string | null = null
    if (typeof body.connectedAccountId === 'string' && body.connectedAccountId.trim()) {
      const account = await db.connectedAccount.findFirst({
        where: { id: body.connectedAccountId.trim(), workspaceId: workspace.id },
      })
      if (!account) {
        return NextResponse.json(
          { error: 'connectedAccountId not found in this workspace.' },
          { status: 400 },
        )
      }
      connectedAccountId = account.id
    }

    const created = await db.credential.create({
      data: {
        userId: user?.id ?? null,
        workspaceId: workspace.id,
        connectedAccountId,
        service,
        label: (body.label || '').trim() || service,
        kind,
        status: 'active',
        metaJson: JSON.stringify(encryptSecretMetaFields(meta)),
      },
    })
    return NextResponse.json(
      {
        credential: {
          id: created.id,
          service: created.service,
          label: created.label,
          kind: created.kind,
          status: created.status,
          connectedAccountId: created.connectedAccountId,
          createdAt: created.createdAt.toISOString(),
        },
      },
      { status: 201 },
    )
  },
  { scope: 'credentials:manage' },
)

function safeParse(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}
