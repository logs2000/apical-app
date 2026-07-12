import { z } from 'zod'
import { db } from '@/lib/db'
import { withAuth } from '@/lib/with-auth'
import { ok, okEnvelope, ApiError } from '@/lib/api/respond'
import { parseBody } from '@/lib/api/validate'
import { parsePagination, cursorFilter, cursorOrderBy, paginate } from '@/lib/api/paginate'
import { encryptSecretMetaFields, redactSecretMetaFields } from '@/lib/platform/vault'

// GET /v1/credentials — the workspace's vault entries (metadata only —
// secret fields are always redacted; raw secrets never leave the vault).
export const GET = withAuth(
  async (req, { workspace, user }) => {
    const { limit, cursor } = parsePagination(new URL(req.url))
    const rows = await db.credential.findMany({
      where: {
        OR: [
          { workspaceId: workspace.id },
          ...(user ? [{ userId: user.id, workspaceId: null }] : []),
        ],
        ...cursorFilter(cursor),
      },
      orderBy: cursorOrderBy(),
      take: limit + 1,
    })
    const page = paginate(rows, limit)
    return okEnvelope({
      data: page.data.map((c) => ({
        id: c.id,
        service: c.service,
        label: c.label,
        kind: c.kind,
        status: c.status,
        connectedAccountId: c.connectedAccountId,
        meta: redactSecretMetaFields(safeParse(c.metaJson) ?? {}),
        createdAt: c.createdAt.toISOString(),
      })),
      page: page.page,
    })
  },
  { scope: 'credentials:manage', rateLimit: { limit: 120, windowMs: 60_000 } },
)

const CreateCredentialSchema = z.object({
  service: z.string().trim().min(1, 'service is required'),
  label: z.string().trim().optional(),
  kind: z.enum(['oauth', 'apikey', 'payment', 'mcp_token']).optional(),
  /** Secret + non-secret fields. Secret-shaped keys are encrypted at rest. */
  meta: z.record(z.string(), z.unknown()).optional(),
  connectedAccountId: z.string().trim().optional(),
})

// POST /v1/credentials — add a credential to the workspace vault.
export const POST = withAuth(
  async (req, { workspace, user }) => {
    const body = await parseBody(req, CreateCredentialSchema)
    const kind = body.kind ?? 'apikey'
    const meta = body.meta ?? {}

    // Optional connected-account binding (must be in this workspace).
    let connectedAccountId: string | null = null
    if (body.connectedAccountId) {
      const account = await db.connectedAccount.findFirst({
        where: { id: body.connectedAccountId, workspaceId: workspace.id },
      })
      if (!account) {
        throw new ApiError('validation_failed', 'connectedAccountId not found in this workspace.')
      }
      connectedAccountId = account.id
    }

    const created = await db.credential.create({
      data: {
        userId: user?.id ?? null,
        workspaceId: workspace.id,
        connectedAccountId,
        service: body.service,
        label: body.label || body.service,
        kind,
        status: 'active',
        metaJson: JSON.stringify(encryptSecretMetaFields(meta)),
      },
    })
    return ok(
      {
        id: created.id,
        service: created.service,
        label: created.label,
        kind: created.kind,
        status: created.status,
        connectedAccountId: created.connectedAccountId,
        createdAt: created.createdAt.toISOString(),
      },
      { status: 201 },
    )
  },
  { scope: 'credentials:manage', rateLimit: { limit: 60, windowMs: 60_000 } },
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
