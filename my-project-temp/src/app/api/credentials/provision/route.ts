import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth-helpers'
import { mapCredential } from '@/lib/mappers'

interface ProvisionBody {
  service?: string
  kind?: 'oauth' | 'apikey' | 'payment' | 'mcp_token'
}

const SERVICE_LABELS: Record<string, string> = {
  sendgrid: 'SendGrid (sandbox)',
  docusign: 'DocuSign',
  slack: 'Slack',
  stripe: 'Stripe',
  gmail: 'Gmail',
  quickbooks: 'QuickBooks',
}

// POST /api/credentials/provision — simulate the agent provisioning a
// credential. We create the row already in 'active' state with plausible
// agent-provisioned metadata so the UI can show it immediately.
export async function POST(req: Request) {
  try {
    const user = await getCurrentUser(req)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const body = (await req.json()) as ProvisionBody
    const service = (body.service || '').trim().toLowerCase()
    if (!service) {
      return NextResponse.json(
        { error: 'service is required' },
        { status: 400 },
      )
    }
    const kind = body.kind || 'oauth'
    const label = SERVICE_LABELS[service] || service

    const today = new Date().toISOString().slice(0, 10)
    const meta = {
      provisionedBy: 'agent',
      openedAt: today,
      tier: 'free',
      note: 'Agent opened this account.',
    }

    const created = await db.credential.create({
      data: {
        userId: user.id,
        service,
        label,
        kind,
        status: 'active',
        metaJson: JSON.stringify(meta),
        agentProvisioned: true,
        canPay: kind === 'payment',
      },
    })

    return NextResponse.json(mapCredential(created))
  } catch (err) {
    console.error('[api/credentials/provision] failed:', err)
    return NextResponse.json(
      { error: 'Failed to provision credential' },
      { status: 500 },
    )
  }
}
