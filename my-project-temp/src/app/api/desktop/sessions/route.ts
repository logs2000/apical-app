import { NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { db } from '@/lib/db'
import { withUser } from '@/lib/auth-helpers'
import type { DesktopSession } from '@prisma/client'

// API routes for /api/desktop/sessions.
//
//   GET   — list the user's DesktopSessions. The sessionToken is NEVER included
//           in the response (it's a secret; only the POST that minted it ever
//           returns it, once).
//   POST  — create a new desktop session. Mints a `dsk_` + 24 random bytes hex
//           sessionToken, persists the row, returns the FULL row INCLUDING the
//           token (the only time the token is shown to the caller).
//
// The desktop app uses the sessionToken to authenticate the socket.io
// connection to the desktop-bridge mini-service (port 3005).

export interface DesktopSessionDto {
  id: string
  userId: string
  label: string
  platform: string | null
  arch: string | null
  appVersion: string | null
  status: string
  lastSeenAt: string | null
  capabilities: string[]
  createdAt: string
  updatedAt: string
}

export interface DesktopSessionWithTokenDto extends DesktopSessionDto {
  sessionToken: string
}

/** Map a Prisma DesktopSession row to the public DTO (no sessionToken). */
export function mapSession(row: DesktopSession): DesktopSessionDto {
  let capabilities: string[] = []
  try {
    const parsed = JSON.parse(row.capabilitiesJson) as unknown
    if (Array.isArray(parsed)) {
      capabilities = parsed.filter((v): v is string => typeof v === 'string')
    }
  } catch {
    /* leave empty */
  }
  return {
    id: row.id,
    userId: row.userId,
    label: row.label,
    platform: row.platform,
    arch: row.arch,
    appVersion: row.appVersion,
    status: row.status,
    lastSeenAt: row.lastSeenAt ? row.lastSeenAt.toISOString() : null,
    capabilities,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

/** Mint a fresh `dsk_` + 24 random bytes (hex) session token. */
export function mintSessionToken(): string {
  return 'dsk_' + randomBytes(24).toString('hex')
}

// GET /api/desktop/sessions — list the user's desktop sessions (no sessionToken).
export const GET = withUser(async (_req, { user }) => {
  const rows = await db.desktopSession.findMany({
    where: { userId: user.id },
    orderBy: { updatedAt: 'desc' },
  })
  return NextResponse.json({ sessions: rows.map(mapSession) })
})

interface CreateBody {
  label?: string
  platform?: string
  arch?: string
  appVersion?: string
  capabilities?: unknown
}

// POST /api/desktop/sessions — create a new desktop session.
export const POST = withUser(async (req, { user }) => {
  let body: CreateBody = {}
  try {
    body = (await req.json()) as CreateBody
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  const label = (body.label || '').trim() || 'My Desktop'
  if (label.length > 200) {
    return NextResponse.json(
      { error: 'label is too long (200 chars max)' },
      { status: 400 },
    )
  }

  const platform = typeof body.platform === 'string' ? body.platform.trim().slice(0, 64) : null
  const arch = typeof body.arch === 'string' ? body.arch.trim().slice(0, 64) : null
  const appVersion = typeof body.appVersion === 'string' ? body.appVersion.trim().slice(0, 64) : null

  // Capabilities is a string[]; we accept either a JSON array or omit.
  let capabilities: string[] = []
  if (Array.isArray(body.capabilities)) {
    capabilities = body.capabilities
      .filter((v): v is string => typeof v === 'string')
      .map((s) => s.trim().slice(0, 64))
      .filter(Boolean)
  }

  const created = await db.desktopSession.create({
    data: {
      userId: user.id,
      label,
      platform,
      arch,
      appVersion,
      sessionToken: mintSessionToken(),
      capabilitiesJson: JSON.stringify(capabilities),
      status: 'offline',
    },
  })

  // Return the FULL row including the sessionToken (this is the only time
  // the token is exposed by the API).
  return NextResponse.json(
    { ...mapSession(created), sessionToken: created.sessionToken },
    { status: 201 },
  )
})
