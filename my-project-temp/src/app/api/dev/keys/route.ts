import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { generateApiKey, withDevAuth } from '@/lib/dev-auth'
import { API_KEY_SCOPES } from '@/lib/api-key-auth'

// GET /api/dev/keys — list the workspace's API keys.
// NEVER returns the raw key or the hash. Just enough to identify + manage them.
export const GET = withDevAuth(async (_req, { workspace }) => {
  try {
    const keys = await db.apiKey.findMany({
      where: { workspaceId: workspace.id },
      orderBy: { createdAt: 'desc' },
    })
    return NextResponse.json(
      keys.map((k) => ({
        id: k.id,
        label: k.label,
        prefix: k.keyPrefix,
        scopes: JSON.parse(k.scopesJson || '[]') as string[],
        spendLimitCents: k.spendLimitCents,
        spentCents: k.spentCents,
        lastUsedAt: k.lastUsedAt ? k.lastUsedAt.toISOString() : null,
        lastUsedFrom: k.lastUsedFrom,
        status: k.status,
        createdAt: k.createdAt.toISOString(),
      })),
    )
  } catch (err) {
    console.error('[api/dev/keys] GET failed:', err)
    return NextResponse.json(
      { error: 'Failed to load API keys.' },
      { status: 500 },
    )
  }
})

// POST /api/dev/keys — create a new API key.
// Body: { label: string, scopes?: string[], spendLimitCents?: number }.
// Returns the raw key ONCE — after this it's gone forever.
// Empty scopes = all scopes.
export const POST = withDevAuth(async (req, { workspace }) => {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      label?: string
      scopes?: string[]
      spendLimitCents?: number
    }
    const label =
      typeof body.label === 'string' && body.label.trim()
        ? body.label.trim().slice(0, 60)
        : 'Untitled'
    const scopes = Array.isArray(body.scopes)
      ? body.scopes.filter((s) => (API_KEY_SCOPES as readonly string[]).includes(s))
      : []
    const spendLimitCents =
      typeof body.spendLimitCents === 'number' && body.spendLimitCents > 0
        ? Math.floor(body.spendLimitCents)
        : undefined

    const { raw, hash, prefix } = generateApiKey()
    const apiKey = await db.apiKey.create({
      data: {
        workspaceId: workspace.id,
        label,
        keyHash: hash,
        keyPrefix: prefix,
        scopesJson: JSON.stringify(scopes),
        spendLimitCents,
        status: 'active',
      },
    })

    // Audit log.
    await db.mcpAuditLog.create({
      data: {
        workspaceId: workspace.id,
        apiKeyId: apiKey.id,
        action: 'key:create',
        target: apiKey.id,
        success: true,
        costCents: 0,
        detail: `Created API key "${label}" (${prefix}…).`,
        source: 'web',
      },
    })

    return NextResponse.json({
      id: apiKey.id,
      label: apiKey.label,
      prefix: apiKey.keyPrefix,
      scopes,
      spendLimitCents,
      raw, // shown ONLY here, once
      createdAt: apiKey.createdAt.toISOString(),
    })
  } catch (err) {
    console.error('[api/dev/keys] POST failed:', err)
    return NextResponse.json(
      { error: 'Failed to create API key.' },
      { status: 500 },
    )
  }
})
