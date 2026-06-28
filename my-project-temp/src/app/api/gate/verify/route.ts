// POST /api/gate/verify — pre-launch passcode check.
// Compares the submitted passcode to PRELAUNCH_PASSCODE (env only, never in
// source). On success, sets an httpOnly cookie so the browser is remembered.

import { NextResponse } from 'next/server'
import { PRELAUNCH_COOKIE } from '@/lib/prelaunch'

const COOKIE_MAX_AGE = 60 * 60 * 24 * 30 // 30 days

export async function POST(req: Request) {
  const expected = process.env.PRELAUNCH_PASSCODE
  if (!expected) {
    // Gate disabled — nothing to verify.
    return NextResponse.json({ ok: true })
  }

  const body = (await req.json().catch(() => ({}))) as { passcode?: string }
  const submitted = (body.passcode ?? '').trim()

  if (submitted !== expected) {
    return NextResponse.json({ error: 'Incorrect passcode.' }, { status: 401 })
  }

  const res = NextResponse.json({ ok: true })
  res.cookies.set(PRELAUNCH_COOKIE, '1', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: COOKIE_MAX_AGE,
  })
  return res
}
