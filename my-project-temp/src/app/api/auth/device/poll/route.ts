import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  expireStaleDeviceRequests,
  hashDeviceCode,
} from '@/lib/desktop/device-auth'
import { mapSession } from '@/lib/desktop/session-dto'

// POST /api/auth/device/poll — the desktop polls with its device code.
//
// Responses:
//   { status: 'pending' }                       — keep polling
//   { status: 'denied' | 'expired' }            — stop, restart the flow
//   { status: 'approved', sessionToken, session } — delivered EXACTLY once;
//     the request is then marked consumed and later polls return 'expired'.

export async function POST(req: Request) {
  let deviceCode = ''
  try {
    const body = (await req.json()) as { deviceCode?: string }
    deviceCode = typeof body.deviceCode === 'string' ? body.deviceCode.trim() : ''
  } catch {
    /* handled below */
  }
  if (!deviceCode.startsWith('dvc_')) {
    return NextResponse.json({ error: 'deviceCode is required' }, { status: 400 })
  }

  try {
    await expireStaleDeviceRequests()

    const row = await db.deviceAuthRequest.findUnique({
      where: { deviceCodeHash: hashDeviceCode(deviceCode) },
    })
    if (!row) {
      return NextResponse.json({ error: 'unknown device code' }, { status: 404 })
    }

    if (row.status === 'pending') {
      return NextResponse.json({ status: 'pending' })
    }
    if (row.status === 'denied') {
      return NextResponse.json({ status: 'denied' })
    }
    if (row.status !== 'approved' || !row.desktopSessionId) {
      // expired or already consumed.
      return NextResponse.json({ status: 'expired' })
    }

    const session = await db.desktopSession.findUnique({
      where: { id: row.desktopSessionId },
    })
    if (!session) {
      return NextResponse.json({ status: 'expired' })
    }

    // One-shot delivery: consume before returning the token.
    await db.deviceAuthRequest.update({
      where: { id: row.id },
      data: { status: 'consumed' },
    })

    return NextResponse.json({
      status: 'approved',
      sessionToken: session.sessionToken,
      session: mapSession(session),
    })
  } catch (err) {
    console.error('[api/auth/device/poll] failed:', err)
    return NextResponse.json(
      { error: 'Failed to poll device authorization.' },
      { status: 500 },
    )
  }
}
