import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { generateApiKey, withDevAuth } from '@/lib/dev-auth'

// GET /api/dev/keys — list the developer's API keys.
// NEVER returns the raw key or the hash. Just enough to identify + manage them.
export const GET = withDevAuth(async (_req, { developer }) => {
  try {
    const keys = await db.apiKey.findMany({
      where: { developerId: developer.id },
      orderBy: { createdAt: 'desc' },
    })
    return NextResponse.json(
      keys.map((k) => ({
        id: k.id,
        label: k.label,
        prefix: k.keyPrefix,
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
// Body: { label: string }. Returns the raw key ONCE — after this it's gone forever.
export const POST = withDevAuth(async (req, { developer }) => {
  try {
    const body = (await req.json().catch(() => ({}))) as { label?: string }
    const label =
      typeof body.label === 'string' && body.label.trim()
        ? body.label.trim().slice(0, 60)
        : 'Untitled'

    const { raw, hash, prefix } = generateApiKey()
    const apiKey = await db.apiKey.create({
      data: {
        developerId: developer.id,
        label,
        keyHash: hash,
        keyPrefix: prefix,
        status: 'active',
      },
    })

    // Audit log.
    await db.mcpAuditLog.create({
      data: {
        developerId: developer.id,
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
