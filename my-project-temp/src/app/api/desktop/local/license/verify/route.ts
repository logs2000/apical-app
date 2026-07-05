/**
 * LOCAL-ONLY route: verify an enterprise license offline (bundled desktop).
 */

import { NextRequest, NextResponse } from 'next/server'
import { isBundledDesktopServer } from '@/lib/desktop/desktop-paths'
import { verifyLicenseToken } from '@/lib/desktop/license'

export async function POST(req: NextRequest) {
  if (!isBundledDesktopServer()) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  let body: { token?: string } = {}
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const token = (body.token ?? '').trim()
  if (!token) {
    return NextResponse.json({ valid: false, reason: 'No license provided.' })
  }

  const result = verifyLicenseToken(token)
  return NextResponse.json(result)
}
