// GET  /api/llm/models — list every model available to the current user.
// POST /api/llm/models — create a CustomModel row for the current user.
//
// GET returns MODEL_REGISTRY filtered by the user's BYOK providers + plan's
// local-model allowance, plus the user's CustomModel rows. Each entry has
// `configured: boolean` (BYOK models show false if no key set; local models
// always true since the endpoint may or may not be up at runtime) and
// `custom: boolean` for user-defined entries.
//
// POST body: { name, type, provider, modelId, baseUrl?, byokKeyId?, isDefault? }
//   - type ∈ {"online","offline","hosted"}
//   - provider must be a known ProviderId
//   - if isDefault, the user's other CustomModels are un-defaulted first.
// Returns the masked CustomModel row (201) or 400 on bad input.

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withUser } from '@/lib/auth-helpers'
import { listAvailableModels } from '@/lib/platform/llm-gateway'
import { PROVIDER_META } from '@/lib/platform/models'

export const GET = withUser(async (_req, { user }) => {
  const { models } = await listAvailableModels(user.id)
  return NextResponse.json({ models })
})

interface CreateCustomBody {
  name: string
  type: string
  provider: string
  modelId: string
  baseUrl?: string
  byokKeyId?: string
  isDefault?: boolean
  contextWindow?: number
  inputCostCentsPer1M?: number
  outputCostCentsPer1M?: number
}

const VALID_TYPES = new Set(['online', 'offline', 'hosted'])

export const POST = withUser(async (req, { user }) => {
  let body: CreateCustomBody
  try {
    body = (await req.json()) as CreateCustomBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const name = (body.name || '').trim()
  const type = (body.type || '').trim()
  const provider = (body.provider || '').trim()
  const modelId = (body.modelId || '').trim()
  const baseUrl = body.baseUrl?.trim() || null
  const byokKeyId = body.byokKeyId?.trim() || null
  const isDefault = !!body.isDefault
  const contextWindow =
    typeof body.contextWindow === 'number' && body.contextWindow > 0
      ? Math.floor(body.contextWindow)
      : 128_000
  const inputCostCentsPer1M =
    typeof body.inputCostCentsPer1M === 'number' && body.inputCostCentsPer1M >= 0
      ? Math.floor(body.inputCostCentsPer1M)
      : 0
  const outputCostCentsPer1M =
    typeof body.outputCostCentsPer1M === 'number' && body.outputCostCentsPer1M >= 0
      ? Math.floor(body.outputCostCentsPer1M)
      : 0

  if (!name) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }
  if (!VALID_TYPES.has(type)) {
    return NextResponse.json(
      { error: 'type must be one of: online, offline, hosted' },
      { status: 400 },
    )
  }
  if (!provider || !(provider in PROVIDER_META)) {
    return NextResponse.json(
      { error: 'provider is required and must be a known provider' },
      { status: 400 },
    )
  }
  if (!modelId) {
    return NextResponse.json({ error: 'modelId is required' }, { status: 400 })
  }

  // If a byokKeyId is supplied for an online custom model, verify it belongs to
  // the user + matches the provider (so users can't silently link another
  // user's key id).
  if (byokKeyId && type === 'online') {
    const key = await db.byokKey.findFirst({
      where: { id: byokKeyId, userId: user.id },
      select: { id: true, provider: true },
    })
    if (!key) {
      return NextResponse.json(
        { error: 'The selected API key was not found.' },
        { status: 400 },
      )
    }
    if (key.provider !== provider) {
      return NextResponse.json(
        {
          error: `The selected API key is for "${key.provider}", not "${provider}".`,
        },
        { status: 400 },
      )
    }
  } else if (byokKeyId && type !== 'online') {
    // Only online models can use a BYOK key.
    return NextResponse.json(
      { error: 'Only online models can be linked to an API key.' },
      { status: 400 },
    )
  }

  // If isDefault, un-default the user's other custom models first.
  if (isDefault) {
    await db.customModel.updateMany({
      where: { userId: user.id, isDefault: true },
      data: { isDefault: false },
    })
  }

  const row = await db.customModel.create({
    data: {
      userId: user.id,
      name,
      type,
      provider,
      modelId,
      baseUrl,
      byokKeyId,
      isDefault,
      enabled: true,
      contextWindow,
      inputCostCentsPer1M,
      outputCostCentsPer1M,
    },
  })

  return NextResponse.json(
    {
      id: row.id,
      name: row.name,
      type: row.type,
      provider: row.provider,
      modelId: row.modelId,
      baseUrl: row.baseUrl,
      byokKeyId: row.byokKeyId,
      isDefault: row.isDefault,
      enabled: row.enabled,
      contextWindow: row.contextWindow,
      inputCostCentsPer1M: row.inputCostCentsPer1M,
      outputCostCentsPer1M: row.outputCostCentsPer1M,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    },
    { status: 201 },
  )
})
