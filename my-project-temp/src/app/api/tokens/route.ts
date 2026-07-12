import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withUser, getWorkspaceForUser } from '@/lib/auth-helpers'
import { generateApiKey, ALL_SCOPES } from '@/lib/api-key-auth'

// GET  /api/tokens — list the current user's personal API keys (ap_pat_).
//   Returns: { tokens: [{ id, label, tokenPrefix, lastUsedAt, status, createdAt }] }
//   Never returns the raw token (only the prefix for identification).
//
// POST /api/tokens — create a new personal key.
//   Body: { label?: string }
//   Returns: { id, label, tokenPrefix, raw, createdAt }
//   The raw token (`ap_pat_...`) is shown ONCE here. Never again.
//
// Personal tokens are unified workspace API keys (ApiKey table) created with
// the `ap_pat_` display prefix and bound to the user via createdById.

export const GET = withUser(async (_req, { user }) => {
  const workspace = await getWorkspaceForUser(user)
  const rows = await db.apiKey.findMany({
    where: { workspaceId: workspace.id, createdById: user.id },
    orderBy: { createdAt: 'desc' },
  })
  return NextResponse.json({
    tokens: rows.map((t) => ({
      id: t.id,
      label: t.label,
      tokenPrefix: t.keyPrefix,
      lastUsedAt: t.lastUsedAt ? t.lastUsedAt.toISOString() : null,
      status: t.status,
      createdAt: t.createdAt.toISOString(),
    })),
  })
})

export const POST = withUser(async (req, { user }) => {
  let body: { label?: string }
  try {
    body = (await req.json().catch(() => ({}))) as { label?: string }
  } catch {
    body = {}
  }
  const label =
    typeof body.label === 'string' && body.label.trim()
      ? body.label.trim().slice(0, 60)
      : 'Default'

  const workspace = await getWorkspaceForUser(user)
  const { raw, hash, prefix } = generateApiKey('ap_pat_')

  const key = await db.apiKey.create({
    data: {
      workspaceId: workspace.id,
      createdById: user.id,
      label,
      keyHash: hash,
      keyPrefix: prefix,
      // Personal tokens are full-access by design; record scopes explicitly
      // rather than relying on the empty-list sentinel (now fail-closed).
      scopesJson: JSON.stringify(ALL_SCOPES),
      status: 'active',
    },
  })

  return NextResponse.json(
    {
      id: key.id,
      label: key.label,
      tokenPrefix: key.keyPrefix,
      raw, // shown ONLY here, once
      createdAt: key.createdAt.toISOString(),
    },
    { status: 201 },
  )
})
