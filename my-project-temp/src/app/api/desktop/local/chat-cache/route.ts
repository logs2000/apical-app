/**
 * LOCAL-ONLY route — persists agent chat threads to the desktop data dir so
 * the Tauri app can restore conversations instantly and survive DB hiccups.
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  isBundledDesktopServer,
  readChatCacheFromDisk,
  sanitizeChatCacheMessages,
  writeChatCacheToDisk,
} from '@/lib/desktop/desktop-paths'
import type { AgentMessage } from '@/lib/types'

export const runtime = 'nodejs'

function notLocal(): NextResponse {
  return NextResponse.json({ error: 'not_found' }, { status: 404 })
}

export async function GET(req: NextRequest) {
  if (!isBundledDesktopServer()) return notLocal()

  try {
    const agentId = req.nextUrl.searchParams.get('agentId')?.trim()
    if (!agentId) {
      return NextResponse.json({ error: 'agentId is required' }, { status: 400 })
    }

    const cached = readChatCacheFromDisk(agentId)
    if (!cached) {
      return NextResponse.json({ agentId, messages: [] })
    }
    return NextResponse.json({
      agentId,
      messages: cached.messages,
      updatedAt: cached.updatedAt,
    })
  } catch (err) {
    console.warn('[chat-cache] GET failed (non-fatal):', err)
    return NextResponse.json({ agentId: '', messages: [] })
  }
}

export async function PUT(req: NextRequest) {
  if (!isBundledDesktopServer()) return notLocal()

  try {
    let body: { agentId?: string; messages?: AgentMessage[] } = {}
    try {
      body = (await req.json()) as typeof body
    } catch {
      return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
    }

    const agentId = body.agentId?.trim()
    if (!agentId) {
      return NextResponse.json({ error: 'agentId is required' }, { status: 400 })
    }
    if (!Array.isArray(body.messages)) {
      return NextResponse.json({ error: 'messages array is required' }, { status: 400 })
    }

    const rows = sanitizeChatCacheMessages(
      body.messages.map((m) => ({
        id: String(m.id),
        role: m.role === 'user' ? 'user' : 'agent',
        content: String(m.content ?? ''),
        createdAt: m.createdAt || new Date().toISOString(),
        events: m.events,
      })),
    )

    const ok = writeChatCacheToDisk(agentId, rows)
    if (!ok) {
      // Best-effort cache — never surface as 500 to the client.
      return NextResponse.json({ ok: false, skipped: 'write_failed', agentId })
    }
    return NextResponse.json({ ok: true, agentId, count: rows.length })
  } catch (err) {
    console.warn('[chat-cache] PUT failed (non-fatal):', err)
    return NextResponse.json({ ok: false, skipped: 'error' })
  }
}
