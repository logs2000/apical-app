import { z } from 'zod'
import { db } from '@/lib/db'
import { withAuth } from '@/lib/with-auth'
import { ok, okEnvelope } from '@/lib/api/respond'
import { parseBody } from '@/lib/api/validate'
import { parsePagination, cursorFilter, cursorOrderBy, paginate } from '@/lib/api/paginate'

// GET /v1/connected-accounts — the workspace's end-customer accounts.
export const GET = withAuth(
  async (req, { workspace }) => {
    const { limit, cursor } = parsePagination(new URL(req.url))
    const rows = await db.connectedAccount.findMany({
      where: { workspaceId: workspace.id, ...cursorFilter(cursor) },
      orderBy: cursorOrderBy(),
      take: limit + 1,
    })
    const page = paginate(rows, limit)
    return okEnvelope({
      data: page.data.map((a) => ({
        id: a.id,
        externalRef: a.externalRef,
        label: a.label,
        status: a.status,
        createdAt: a.createdAt.toISOString(),
      })),
      page: page.page,
    })
  },
  { scope: 'credentials:manage', rateLimit: { limit: 120, windowMs: 60_000 } },
)

const CreateAccountSchema = z.object({
  /** Your own reference for this end-user (their user id / email). */
  externalRef: z.string().trim().min(1, 'externalRef is required'),
  label: z.string().optional(),
})

// POST /v1/connected-accounts — register an end-customer account. Credentials
// created with connectedAccountId are preferred during that account's runs.
export const POST = withAuth(
  async (req, { workspace }) => {
    const body = await parseBody(req, CreateAccountSchema)
    const account = await db.connectedAccount.upsert({
      where: { workspaceId_externalRef: { workspaceId: workspace.id, externalRef: body.externalRef } },
      update: { ...(typeof body.label === 'string' ? { label: body.label } : {}) },
      create: {
        workspaceId: workspace.id,
        externalRef: body.externalRef,
        label: (body.label || '').trim(),
        status: 'active',
      },
    })
    return ok(
      {
        id: account.id,
        externalRef: account.externalRef,
        label: account.label,
        status: account.status,
        createdAt: account.createdAt.toISOString(),
      },
      { status: 201 },
    )
  },
  { scope: 'credentials:manage', rateLimit: { limit: 60, windowMs: 60_000 } },
)
