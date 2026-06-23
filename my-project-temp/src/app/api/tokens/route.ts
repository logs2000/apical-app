import { NextResponse } from 'next/server'
import { createHash, randomBytes } from 'crypto'
import { db } from '@/lib/db'
import { withUser } from '@/lib/auth-helpers'

// GET  /api/tokens — list the current user's personal access tokens (PATs).
//   Returns: { tokens: [{ id, label, tokenPrefix, lastUsedAt, status, createdAt }] }
//   Never returns the raw token (only the prefix for identification).
//
// POST /api/tokens — create a new PAT.
//   Body: { label?: string }
//   Returns: { id, label, tokenPrefix, raw, createdAt }
//   The raw token (`ap_pat_...`) is shown ONCE here. Never again.

const TOKEN_PREFIX = 'ap_pat_'

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

export const GET = withUser(async (_req, { user }) => {
  const rows = await db.personalAccessToken.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
  })
  return NextResponse.json({
    tokens: rows.map((t) => ({
      id: t.id,
      label: t.label,
      tokenPrefix: t.tokenPrefix,
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

  // Generate a random 24-byte token (base64url → ~32 chars).
  const raw = TOKEN_PREFIX + randomBytes(24).toString('base64url')
  const tokenHash = hashToken(raw)
  const tokenPrefix = raw.slice(0, 12)

  const pat = await db.personalAccessToken.create({
    data: {
      userId: user.id,
      label,
      tokenHash,
      tokenPrefix,
      status: 'active',
    },
  })

  return NextResponse.json(
    {
      id: pat.id,
      label: pat.label,
      tokenPrefix: pat.tokenPrefix,
      raw, // shown ONLY here, once
      createdAt: pat.createdAt.toISOString(),
    },
    { status: 201 },
  )
})
