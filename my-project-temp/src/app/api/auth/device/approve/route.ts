import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withUser } from '@/lib/auth-helpers'
import {
  approveDeviceRequest,
  expireStaleDeviceRequests,
} from '@/lib/desktop/device-auth'

// GET  /api/auth/device/approve?code=XXXX-XXXX — describe a pending request
//      (so the authorize page can show which device is asking).
// POST /api/auth/device/approve { userCode, approve } — approve (creates the
//      DesktopSession) or deny the request. Requires a signed-in user.

export const GET = withUser(async (req) => {
  const code = (new URL(req.url).searchParams.get('code') ?? '')
    .trim()
    .toUpperCase()
  if (!code) {
    return NextResponse.json({ error: 'code is required' }, { status: 400 })
  }

  await expireStaleDeviceRequests()
  const row = await db.deviceAuthRequest.findUnique({ where: { userCode: code } })
  if (!row || row.status !== 'pending') {
    return NextResponse.json(
      { error: 'This code is invalid or has expired. Restart the login on your desktop.' },
      { status: 404 },
    )
  }

  return NextResponse.json({
    userCode: row.userCode,
    label: row.label,
    platform: row.platform,
    appVersion: row.appVersion,
    expiresAt: row.expiresAt.toISOString(),
  })
})

export const POST = withUser(async (req, { user }) => {
  let body: { userCode?: string; approve?: boolean } = {}
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  const userCode = typeof body.userCode === 'string' ? body.userCode.trim().toUpperCase() : ''
  if (!userCode) {
    return NextResponse.json({ error: 'userCode is required' }, { status: 400 })
  }

  if (body.approve === false) {
    await expireStaleDeviceRequests()
    const updated = await db.deviceAuthRequest.updateMany({
      where: { userCode, status: 'pending' },
      data: { status: 'denied' },
    })
    if (updated.count === 0) {
      return NextResponse.json({ error: 'code not found or already handled' }, { status: 404 })
    }
    return NextResponse.json({ status: 'denied' })
  }

  const session = await approveDeviceRequest(user, userCode)
  if (!session) {
    return NextResponse.json(
      { error: 'This code is invalid or has expired. Restart the login on your desktop.' },
      { status: 404 },
    )
  }

  return NextResponse.json({ status: 'approved', label: session.label })
})
