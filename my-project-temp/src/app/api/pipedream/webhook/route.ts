import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { workspaceIdForUser } from '@/lib/integration-scope'
import { materializePipedreamConnection } from '@/lib/pipedream/sync'
import { getPipedreamConfig } from '@/lib/pipedream/config'

// POST /api/pipedream/webhook?token=<PIPEDREAM_WEBHOOK_SECRET>
//
// Pipedream Connect CONNECTION_SUCCESS / CONNECTION_ERROR events. This is the
// tertiary reliability layer (the browser onSuccess callback and account
// polling are primary/secondary) — it catches connections completed while the
// user's tab was closed. Payloads are unsigned, so auth is the shared token
// in the URL; without PIPEDREAM_WEBHOOK_SECRET set, the endpoint is disabled.
// Idempotent with connect/complete via materializePipedreamConnection.

interface WebhookPayload {
  event?: string
  environment?: string
  account?: {
    id?: string
    external_user_id?: string
    app?: { name_slug?: string } | string
  }
}

export async function POST(req: Request) {
  const cfg = getPipedreamConfig()
  if (!cfg) {
    return NextResponse.json({ error: 'Pipedream is not configured' }, { status: 503 })
  }
  if (!cfg.webhookSecret) {
    return NextResponse.json({ error: 'Webhook is not enabled' }, { status: 403 })
  }
  const url = new URL(req.url)
  if (url.searchParams.get('token') !== cfg.webhookSecret) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const payload = (await req.json().catch(() => ({}))) as WebhookPayload
    const event = payload.event || ''
    if (event !== 'CONNECTION_SUCCESS') {
      // CONNECTION_ERROR and unknown events are acknowledged and dropped —
      // there is nothing durable to record for a failed auth attempt.
      return NextResponse.json({ ok: true, skipped: event || 'unknown' })
    }
    // Ignore events from the other environment (dev vs prod stores differ).
    if (payload.environment && payload.environment !== cfg.environment) {
      return NextResponse.json({ ok: true, skipped: 'environment-mismatch' })
    }

    const accountId = payload.account?.id?.trim()
    const externalUserId = payload.account?.external_user_id?.trim()
    const app =
      typeof payload.account?.app === 'string'
        ? payload.account.app
        : payload.account?.app?.name_slug
    if (!accountId || !externalUserId || !app) {
      return NextResponse.json({ ok: true, skipped: 'incomplete-payload' })
    }

    // external_user_id is the Apical userId by construction.
    const user = await db.user.findUnique({ where: { id: externalUserId } })
    if (!user) {
      return NextResponse.json({ ok: true, skipped: 'unknown-user' })
    }
    const wsId = await workspaceIdForUser(user)
    await materializePipedreamConnection(user.id, wsId, accountId, app)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[api/pipedream/webhook] failed:', err)
    // 200 anyway — Pipedream retries on 5xx and the polling path will recover.
    return NextResponse.json({ ok: false })
  }
}
