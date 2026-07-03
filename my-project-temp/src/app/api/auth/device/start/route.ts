import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  DEVICE_AUTH_TTL_MS,
  DEVICE_POLL_INTERVAL_MS,
  expireStaleDeviceRequests,
  hashDeviceCode,
  mintDeviceCode,
  mintUserCode,
} from '@/lib/desktop/device-auth'

// POST /api/auth/device/start — begin a desktop device-authorization login.
//
// Unauthenticated by design (the desktop has no credentials yet). Returns the
// device code (secret, kept by the desktop for polling), the short user code,
// and the browser verification URL. The desktop opens the URL and polls
// /api/auth/device/poll until the signed-in user approves.

interface StartBody {
  label?: string
  platform?: string
  arch?: string
  appVersion?: string
}

const str = (v: unknown, max: number) =>
  typeof v === 'string' ? v.trim().slice(0, max) : null

export async function POST(req: Request) {
  let body: StartBody = {}
  try {
    body = (await req.json()) as StartBody
  } catch {
    /* empty body is fine */
  }

  try {
    await expireStaleDeviceRequests()

    const deviceCode = mintDeviceCode()
    const userCode = mintUserCode()
    const expiresAt = new Date(Date.now() + DEVICE_AUTH_TTL_MS)

    await db.deviceAuthRequest.create({
      data: {
        deviceCodeHash: hashDeviceCode(deviceCode),
        userCode,
        label: str(body.label, 200) || 'My Desktop',
        platform: str(body.platform, 64),
        arch: str(body.arch, 64),
        appVersion: str(body.appVersion, 64),
        expiresAt,
      },
    })

    const origin = new URL(req.url).origin
    const verificationUrl = `${origin}/desktop/authorize?code=${encodeURIComponent(userCode)}`

    return NextResponse.json({
      deviceCode,
      userCode,
      verificationUrl,
      expiresAt: expiresAt.toISOString(),
      intervalMs: DEVICE_POLL_INTERVAL_MS,
    })
  } catch (err) {
    console.error('[api/auth/device/start] failed:', err)
    return NextResponse.json(
      { error: 'Failed to start device authorization.' },
      { status: 500 },
    )
  }
}
