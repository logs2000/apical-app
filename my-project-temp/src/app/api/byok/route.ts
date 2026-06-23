// GET  /api/byok         — list the current user's BYOK keys (never the key itself)
// POST /api/byok         — add a new BYOK key (encrypted at rest)
//
// Never returns the raw or decrypted key. The list view exposes only:
//   id, provider, label, keyPrefix, baseUrl, defaultModel, status,
//   lastStatus, lastCheckedAt.
//
// POST body: { provider, label, key, baseUrl?, defaultModel? }
// Validates the key shape via `looksLikeKey`, encrypts via `encrypt`,
// stores `maskKey` as keyPrefix.

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withUser } from '@/lib/auth-helpers'
import { encrypt, maskKey, looksLikeKey } from '@/lib/platform/vault'
import type { ProviderId } from '@/lib/platform/models'

interface CreateByokBody {
  provider: string
  label: string
  key: string
  baseUrl?: string
  defaultModel?: string
}

export const GET = withUser(async (_req, { user }) => {
  const rows = await db.byokKey.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
  })
  return NextResponse.json({
    keys: rows.map((k) => ({
      id: k.id,
      provider: k.provider,
      label: k.label,
      keyPrefix: k.keyPrefix,
      baseUrl: k.baseUrl,
      defaultModel: k.defaultModel,
      status: k.status,
      lastStatus: k.lastStatus,
      lastCheckedAt: k.lastCheckedAt,
      createdAt: k.createdAt,
      updatedAt: k.updatedAt,
    })),
  })
})

export const POST = withUser(async (req, { user }) => {
  let body: CreateByokBody
  try {
    body = (await req.json()) as CreateByokBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const provider = (body.provider || '').trim() as ProviderId
  const label = (body.label || 'Default').trim()
  const key = (body.key || '').trim()
  const baseUrl = body.baseUrl?.trim() || null
  const defaultModel = body.defaultModel?.trim() || null

  if (!provider) {
    return NextResponse.json({ error: 'provider is required' }, { status: 400 })
  }
  if (!label) {
    return NextResponse.json({ error: 'label is required' }, { status: 400 })
  }
  if (!key) {
    return NextResponse.json({ error: 'key is required' }, { status: 400 })
  }
  if (!looksLikeKey(provider, key)) {
    return NextResponse.json(
      { error: `Key does not look like a valid ${provider} key` },
      { status: 400 },
    )
  }

  // Enforce the (userId, provider, label) uniqueness.
  const existing = await db.byokKey.findUnique({
    where: { userId_provider_label: { userId: user.id, provider, label } },
  })
  if (existing) {
    return NextResponse.json(
      { error: 'A key with that provider + label already exists' },
      { status: 409 },
    )
  }

  const encryptedKey = encrypt(key)
  const keyPrefix = maskKey(key)

  const row = await db.byokKey.create({
    data: {
      userId: user.id,
      provider,
      label,
      encryptedKey,
      keyPrefix,
      baseUrl,
      defaultModel,
      status: 'active',
    },
  })

  return NextResponse.json({
    id: row.id,
    provider: row.provider,
    label: row.label,
    keyPrefix: row.keyPrefix,
    baseUrl: row.baseUrl,
    defaultModel: row.defaultModel,
    status: row.status,
    lastStatus: row.lastStatus,
    lastCheckedAt: row.lastCheckedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  })
})
