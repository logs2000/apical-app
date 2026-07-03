import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withAuth } from '@/lib/with-auth'

// GET /v1/connected-accounts — the workspace's end-customer accounts.
export const GET = withAuth(
  async (req, { workspace }) => {
    const rows = await db.connectedAccount.findMany({
      where: { workspaceId: workspace.id },
      orderBy: { createdAt: 'desc' },
    })
    return NextResponse.json({
      connectedAccounts: rows.map((a) => ({
        id: a.id,
        externalRef: a.externalRef,
        label: a.label,
        status: a.status,
        createdAt: a.createdAt.toISOString(),
      })),
    })
  },
  { scope: 'credentials:manage' },
)

interface CreateBody {
  /** Your own reference for this end-user (their user id / email). */
  externalRef?: string
  label?: string
}

// POST /v1/connected-accounts — register an end-customer account. Credentials
// created with connectedAccountId are preferred during that account's runs.
export const POST = withAuth(
  async (req, { workspace }) => {
    const body = (await req.json().catch(() => ({}))) as CreateBody
    const externalRef = (body.externalRef || '').trim()
    if (!externalRef) {
      return NextResponse.json(
        { error: 'externalRef is required.' },
        { status: 400 },
      )
    }
    const account = await db.connectedAccount.upsert({
      where: { workspaceId_externalRef: { workspaceId: workspace.id, externalRef } },
      update: { ...(typeof body.label === 'string' ? { label: body.label } : {}) },
      create: {
        workspaceId: workspace.id,
        externalRef,
        label: (body.label || '').trim(),
        status: 'active',
      },
    })
    return NextResponse.json(
      {
        connectedAccount: {
          id: account.id,
          externalRef: account.externalRef,
          label: account.label,
          status: account.status,
          createdAt: account.createdAt.toISOString(),
        },
      },
      { status: 201 },
    )
  },
  { scope: 'credentials:manage' },
)
