// API routes for /api/notifications.
//
//   GET   /api/notifications?limit=50&offset=0
//         → list the user's EmailLog rows (newest first), paginated.
//
//   POST  /api/notifications  { to?, subject, body, kind }
//         → send a test / system email. `to` defaults to the user's email.
//           Respects notification prefs: if `kind` is disabled, returns
//           status='skipped'. In dev (no SMTP_URI) the row is marked 'sent'
//           but no real send happens (log-only).

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withUser } from '@/lib/auth-helpers'
import { sendEmail } from '@/lib/platform/notifications'
import type { EmailLog } from '@prisma/client'

function mapEmailLog(row: EmailLog) {
  return {
    id: row.id,
    userId: row.userId,
    toAddress: row.toAddress,
    subject: row.subject,
    body: row.body,
    kind: row.kind,
    status: row.status,
    refId: row.refId,
    errorMessage: row.errorMessage,
    sentAt: row.sentAt ? row.sentAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  }
}

// GET /api/notifications — list the user's email log (newest first).
export const GET = withUser(async (req, { user }) => {
  const url = new URL(req.url)
  const limitRaw = url.searchParams.get('limit')
  const offsetRaw = url.searchParams.get('offset')
  const limit = Math.min(200, Math.max(1, Number(limitRaw) || 50))
  const offset = Math.max(0, Number(offsetRaw) || 0)

  const rows = await db.emailLog.findMany({
    where: { userId: user.id },
    take: limit,
    skip: offset,
    orderBy: { createdAt: 'desc' },
  })

  return NextResponse.json(rows.map(mapEmailLog))
})

interface SendBody {
  to?: string
  subject?: string
  body?: string
  kind?: string
  refId?: string | null
}

const ALLOWED_KINDS: ReadonlyArray<EmailLog['kind']> = [
  'gate',
  'flagged',
  'daily_brief',
  'weekly_brief',
  'schedule',
  'billing',
  'system',
]

// POST /api/notifications — send a test / system email.
export const POST = withUser(async (req, { user }) => {
  let body: SendBody = {}
  try {
    body = (await req.json()) as SendBody
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  const subject = (body.subject || '').trim()
  if (!subject) {
    return NextResponse.json({ error: 'subject is required' }, { status: 400 })
  }
  const text = typeof body.body === 'string' ? body.body : ''
  const kindRaw = (body.kind || 'system').trim()
  const kind: EmailLog['kind'] = ALLOWED_KINDS.includes(kindRaw as EmailLog['kind'])
    ? (kindRaw as EmailLog['kind'])
    : 'system'
  const to = (body.to || '').trim() || user.email
  const refId =
    typeof body.refId === 'string' && body.refId.trim() ? body.refId.trim() : null

  const row = await sendEmail({
    userId: user.id,
    to,
    subject,
    body: text,
    kind,
    refId,
  })

  return NextResponse.json(mapEmailLog(row), { status: 201 })
})
