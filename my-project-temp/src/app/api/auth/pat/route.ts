// PAT endpoints — Personal Access Tokens for the MCP server + REST API.
//
//   POST   /api/auth/pat        → create a new PAT (raw shown ONCE in response)
//   GET    /api/auth/pat         → list the user's PATs (never the raw token)
//   DELETE /api/auth/pat/[id]    → revoke a PAT
//
// Replaces the old /api/dev/keys endpoints for user-facing API auth. The
// apical-mcp mini-service authenticates by sending `Authorization: Bearer
// ap_pat_...` to the REST API, which validate via `authenticatePat` (in
// src/lib/auth-helpers.ts).

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser, generatePat } from '@/lib/auth-helpers'

// ---------------- POST: create a PAT ----------------

interface CreatePatBody {
  label?: string
}

export async function POST(req: Request) {
  try {
    const user = await getCurrentUser(req)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = (await req.json().catch(() => ({}))) as CreatePatBody
    const label =
      typeof body.label === 'string' && body.label.trim()
        ? body.label.trim().slice(0, 64)
        : 'Default'

    const { raw, hash, prefix } = generatePat(user.id)
    const pat = await db.personalAccessToken.create({
      data: {
        userId: user.id,
        label,
        tokenHash: hash,
        tokenPrefix: prefix,
        status: 'active',
      },
    })

    // Raw token is returned EXACTLY ONCE. Never persist it anywhere.
    return NextResponse.json({
      id: pat.id,
      label: pat.label,
      prefix: pat.tokenPrefix,
      raw,
      status: pat.status,
      createdAt: pat.createdAt.toISOString(),
    })
  } catch (err) {
    console.error('[api/auth/pat] POST failed:', err)
    return NextResponse.json(
      { error: 'Could not create personal access token.' },
      { status: 500 },
    )
  }
}

// ---------------- GET: list PATs ----------------

export async function GET(req: Request) {
  try {
    const user = await getCurrentUser(req)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const pats = await db.personalAccessToken.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
    })

    // Never include the raw token (we don't store it) or the hash.
    return NextResponse.json({
      tokens: pats.map((p) => ({
        id: p.id,
        label: p.label,
        prefix: p.tokenPrefix,
        status: p.status,
        lastUsedAt: p.lastUsedAt ? p.lastUsedAt.toISOString() : null,
        createdAt: p.createdAt.toISOString(),
      })),
    })
  } catch (err) {
    console.error('[api/auth/pat] GET failed:', err)
    return NextResponse.json(
      { error: 'Could not list personal access tokens.' },
      { status: 500 },
    )
  }
}
