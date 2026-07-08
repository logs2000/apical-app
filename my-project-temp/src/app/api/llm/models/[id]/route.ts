// PATCH /api/llm/models/[id]  — update a model's per-user settings.
// DELETE /api/llm/models/[id] — remove one of the user's CustomModel rows.
//
// PATCH body (any subset): { enabled?, isDefault? }
//   - isDefault=true un-defaults every other model (custom AND registry) first,
//     so the user has exactly one default across both stores.
// The id is either a CustomModel row id, or a MODEL_REGISTRY id (e.g.
// "openai:gpt-4o" — clients must encodeURIComponent it). Registry settings are
// persisted per-user in UserModelPref.
// 404 if a custom row doesn't exist OR isn't owned by the caller.

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withUser } from '@/lib/auth-helpers'
import { getModel } from '@/lib/platform/models'

interface PatchBody {
  enabled?: boolean
  isDefault?: boolean
}

export const PATCH = withUser(async (req, { user, params }) => {
  const id = params.id
  if (!id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 })
  }

  let body: PatchBody
  try {
    body = (await req.json()) as PatchBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const data: { enabled?: boolean; isDefault?: boolean } = {}
  if (typeof body.enabled === 'boolean') data.enabled = body.enabled
  if (typeof body.isDefault === 'boolean') data.isDefault = body.isDefault

  if (Object.keys(data).length === 0) {
    return NextResponse.json(
      { error: 'Nothing to update — supply enabled and/or isDefault.' },
      { status: 400 },
    )
  }

  // Registry (built-in) model → persist per-user prefs in UserModelPref.
  if (getModel(id)) {
    if (data.isDefault) {
      await Promise.all([
        db.userModelPref.updateMany({
          where: { userId: user.id, isDefault: true, modelId: { not: id } },
          data: { isDefault: false },
        }),
        db.customModel.updateMany({
          where: { userId: user.id, isDefault: true },
          data: { isDefault: false },
        }),
      ])
    }
    const pref = await db.userModelPref.upsert({
      where: { userId_modelId: { userId: user.id, modelId: id } },
      create: { userId: user.id, modelId: id, ...data },
      update: data,
    })
    return NextResponse.json({
      id,
      registry: true,
      enabled: pref.enabled,
      isDefault: pref.isDefault,
    })
  }

  const existing = await db.customModel.findFirst({
    where: { id, userId: user.id },
    select: { id: true },
  })
  if (!existing) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  if (data.isDefault) {
    // Un-default everything else — other customs and any registry pref.
    await Promise.all([
      db.customModel.updateMany({
        where: { userId: user.id, isDefault: true, id: { not: existing.id } },
        data: { isDefault: false },
      }),
      db.userModelPref.updateMany({
        where: { userId: user.id, isDefault: true },
        data: { isDefault: false },
      }),
    ])
  }

  const row = await db.customModel.update({
    where: { id: existing.id },
    data,
  })

  return NextResponse.json({
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
  })
})

export const DELETE = withUser(async (_req, { user, params }) => {
  const id = params.id
  if (!id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 })
  }

  const existing = await db.customModel.findFirst({
    where: { id, userId: user.id },
    select: { id: true },
  })
  if (!existing) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  await db.customModel.delete({ where: { id: existing.id } })

  return NextResponse.json({ ok: true, id: existing.id })
})
