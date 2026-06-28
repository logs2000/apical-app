import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withUser } from '@/lib/auth-helpers'
import { mapSession, mintSessionToken } from '@/lib/desktop/session-dto'

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
