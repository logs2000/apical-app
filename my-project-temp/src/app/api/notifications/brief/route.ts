// API routes for /api/notifications/brief.
//
//   GET   /api/notifications/brief
//         → render (preview) the user's daily brief. Returns
//           { subject, body, html } but does NOT send anything.
//
//   POST  /api/notifications/brief
//         → render + send the daily brief to the user. Returns the EmailLog
//           row (status='sent' in dev log-only mode, 'skipped' if the user
//           has daily_brief disabled in their notification prefs).

import { NextResponse } from 'next/server'
import { withUser } from '@/lib/auth-helpers'
import {
  renderDailyBrief,
  sendDailyBrief,
} from '@/lib/platform/notifications'
import type { EmailLog } from '@prisma/client'

// GET /api/notifications/brief — preview the daily brief.
export const GET = withUser(async (_req, { user }) => {
  const brief = await renderDailyBrief(user.id)
  return NextResponse.json(brief)
})

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

// POST /api/notifications/brief — render + send the daily brief.
export const POST = withUser(async (_req, { user }) => {
  const row = await sendDailyBrief(user.id)
  return NextResponse.json(mapEmailLog(row), { status: 201 })
})
