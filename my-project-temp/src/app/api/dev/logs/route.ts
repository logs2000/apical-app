import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withDevAuth } from '@/lib/dev-auth'

// GET /api/dev/logs?limit=50 — audit log list (newest first).
// Each item: { id, action, target, success, costCents, detail, source, apiKeyLabel, createdAt }.
export const GET = withDevAuth(async (req, { developer }) => {
  try {
    const url = new URL(req.url)
    const limitRaw = Number.parseInt(url.searchParams.get('limit') || '50', 10)
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 500) : 50

    const logs = await db.mcpAuditLog.findMany({
      where: { developerId: developer.id },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { apiKey: { select: { label: true } } },
    })

    return NextResponse.json(
      logs.map((l) => ({
        id: l.id,
        action: l.action,
        target: l.target,
        success: l.success,
        costCents: l.costCents,
        detail: l.detail,
        source: l.source,
        apiKeyLabel: l.apiKey?.label ?? null,
        createdAt: l.createdAt.toISOString(),
      })),
    )
  } catch (err) {
    console.error('[api/dev/logs] GET failed:', err)
    return NextResponse.json(
      { error: 'Failed to load audit logs.' },
      { status: 500 },
    )
  }
})
