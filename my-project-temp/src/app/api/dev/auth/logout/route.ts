import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { DEV_KEY_COOKIE } from '@/lib/dev-auth'

// POST /api/dev/auth/logout — clear the console cookie.
export async function POST() {
  try {
    const c = await cookies()
    c.delete(DEV_KEY_COOKIE)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[api/dev/auth/logout] failed:', err)
    return NextResponse.json(
      { error: 'Failed to log out.' },
      { status: 500 },
    )
  }
}
