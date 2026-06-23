import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth-helpers'
import { mapCredential } from '@/lib/mappers'

// GET /api/credentials — list the current user's credentials in the AI-auth vault.
export async function GET(req: Request) {
  try {
    const user = await getCurrentUser(req)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const rows = await db.credential.findMany({
      where: { userId: user.id },
      orderBy: [{ createdAt: 'desc' }],
    })
    return NextResponse.json(rows.map(mapCredential))
  } catch (err) {
    console.error('[api/credentials] GET failed:', err)
    return NextResponse.json(
      { error: 'Failed to load credentials' },
      { status: 500 },
    )
  }
}

interface CreateBody {
  service?: string
  label?: string
  kind?: 'oauth' | 'apikey' | 'payment' | 'mcp_token'
  metaJson?: string
  agentProvisioned?: boolean
  canPay?: boolean
}

// POST /api/credentials — save a credential (typically from the chat's
// API-discovery credential input fields). The frontend calls this when the
// user fills in the fields the agent requested and hits "save".
export async function POST(req: Request) {
  try {
    const user = await getCurrentUser(req)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const body = (await req.json().catch(() => ({}))) as CreateBody
    const service = (body.service || '').trim()
    if (!service) {
      return NextResponse.json(
        { error: 'service is required' },
        { status: 400 },
      )
    }
    const kind: 'oauth' | 'apikey' | 'payment' | 'mcp_token' =
      body.kind === 'oauth' ||
      body.kind === 'apikey' ||
      body.kind === 'payment' ||
      body.kind === 'mcp_token'
        ? body.kind
        : 'apikey'
    const label =
      typeof body.label === 'string' && body.label.trim()
        ? body.label.trim()
        : service
    // metaJson: accept either a JSON string or an object; we store as a string.
    let metaJson = '{}'
    if (typeof body.metaJson === 'string') {
      // Validate it parses; otherwise default to {}.
      try {
        JSON.parse(body.metaJson)
        metaJson = body.metaJson
      } catch {
        metaJson = '{}'
      }
    } else if (body.metaJson && typeof body.metaJson === 'object') {
      metaJson = JSON.stringify(body.metaJson)
    }
    const agentProvisioned = body.agentProvisioned === true
    const canPay = body.canPay === true || kind === 'payment'

    const created = await db.credential.create({
      data: {
        userId: user.id,
        service,
        label,
        kind,
        status: 'active',
        metaJson,
        agentProvisioned,
        canPay,
      },
    })
    return NextResponse.json(mapCredential(created))
  } catch (err) {
    console.error('[api/credentials] POST failed:', err)
    return NextResponse.json(
      { error: 'Failed to create credential' },
      { status: 500 },
    )
  }
}
