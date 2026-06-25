import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth-helpers'
import { encrypt } from '@/lib/platform/vault'

interface SaveKeyBody {
  service?: string
  label?: string
  /** The raw secret the user typed in the inline chat box. */
  value?: string
  /** How the secret is injected when the agent later calls the API. */
  headerName?: string
  headerPrefix?: string
}

// POST /api/credentials/save-key
//
// Saves an API key / token the agent requested via `credential_request`. The
// secret is encrypted at rest (AES-256-GCM) and stored in metaJson.key — the
// agent only ever references it by credentialId; the value is never returned to
// the LLM. This backs the inline "credential box" rendered in the chat.
export async function POST(req: Request) {
  try {
    const user = await getCurrentUser(req)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const body = (await req.json().catch(() => ({}))) as SaveKeyBody
    const service = (body.service || '').trim()
    const value = (body.value || '').trim()
    if (!service) {
      return NextResponse.json({ error: 'service is required' }, { status: 400 })
    }
    if (!value) {
      return NextResponse.json({ error: 'value is required' }, { status: 400 })
    }
    const label =
      typeof body.label === 'string' && body.label.trim()
        ? body.label.trim()
        : service

    const meta: Record<string, unknown> = { key: encrypt(value) }
    if (typeof body.headerName === 'string' && body.headerName.trim()) {
      meta.headerName = body.headerName.trim()
    }
    if (typeof body.headerPrefix === 'string') {
      meta.headerPrefix = body.headerPrefix
    }

    const created = await db.credential.create({
      data: {
        userId: user.id,
        service,
        label,
        kind: 'apikey',
        status: 'active',
        metaJson: JSON.stringify(meta),
        agentProvisioned: false,
        canPay: false,
      },
    })
    // Return only non-secret identifiers (never the encrypted blob).
    return NextResponse.json({
      id: created.id,
      service: created.service,
      label: created.label,
      kind: created.kind,
      status: created.status,
    })
  } catch (err) {
    console.error('[api/credentials/save-key] POST failed:', err)
    return NextResponse.json(
      { error: 'Failed to save credential' },
      { status: 500 },
    )
  }
}
