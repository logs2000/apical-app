// GET    /api/settings/cloud-pat — cloud link status (no secret returned)
// POST   /api/settings/cloud-pat — save ap_pat_... after validating against cloud
// DELETE /api/settings/cloud-pat — remove stored token

import { NextResponse } from 'next/server'
import { withUser } from '@/lib/auth-helpers'
import {
  clearCloudPat,
  getCloudPatStatus,
  getEnvCloudPat,
  saveCloudPat,
} from '@/lib/platform/cloud-pat'
import { validateCloudPat } from '@/lib/platform/cloud-llm'

export const GET = withUser(async (_req, { user }) => {
  const status = await getCloudPatStatus(user.id)
  return NextResponse.json(status)
})

export const POST = withUser(async (req, { user }) => {
  let body: { pat?: string }
  try {
    body = (await req.json()) as { pat?: string }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const pat = (body.pat || '').trim()
  if (!pat) {
    return NextResponse.json({ error: 'pat is required' }, { status: 400 })
  }

  const check = await validateCloudPat(pat)
  if (!check.ok) {
    return NextResponse.json(
      { error: check.error || 'Token validation failed' },
      { status: 400 },
    )
  }

  await saveCloudPat(user.id, pat)
  const status = await getCloudPatStatus(user.id)
  return NextResponse.json(status)
})

export const DELETE = withUser(async (_req, { user }) => {
  if (getEnvCloudPat()) {
    return NextResponse.json(
      {
        error:
          'Token is set via APICAL_PAT in the environment and cannot be removed from the app.',
      },
      { status: 400 },
    )
  }

  await clearCloudPat(user.id)
  const status = await getCloudPatStatus(user.id)
  return NextResponse.json(status)
})
