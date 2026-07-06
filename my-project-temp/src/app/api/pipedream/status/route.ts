import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth-helpers'
import { getPipedreamConfig } from '@/lib/pipedream/config'

// GET /api/pipedream/status — is the managed connection path available?
// Gates every Pipedream affordance in the UI. Never leaks key material.
export async function GET(req: Request) {
  const user = await getCurrentUser(req)
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const cfg = getPipedreamConfig()
  return NextResponse.json({
    configured: cfg !== null,
    environment: cfg?.environment ?? null,
  })
}
