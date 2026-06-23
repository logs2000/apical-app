// PATCH /api/llm/models/[id]  — update one of the user's CustomModel rows.
// DELETE /api/llm/models/[id] — remove one of the user's CustomModel rows.
//
// PATCH body (any subset): { enabled?, isDefault? }
//   - isDefault=true un-defaults the user's other custom models first.
// 404 if the row doesn't exist OR isn't owned by the caller.
// Registry models (not custom rows) are NOT addressable here — toggling those
// is local-state-only on the client for now.

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withUser } from '@/lib/auth-helpers'

interface PatchBody {
  enabled?: boolean
  isDefault?: boolean
}

export const PATCH = withUser(async (req, { user, params }) => {
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

  let body: PatchBody
  try {
    body = (await req.json()) as PatchBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const data: { enabled?: boolean; isDefault?: boolean } = {}
  if (typeof body.enabled === 'boolean') data.enabled = body.enabled
  if (typeof body.isDefault === 'boolean') {
    data.isDefault = body.isDefault
    if (body.isDefault) {
      // Un-default the user's other custom models first.
      await db.customModel.updateMany({
        where: { userId: user.id, isDefault: true, id: { not: existing.id } },
        data: { isDefault: false },
      })
    }
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json(
      { error: 'Nothing to update — supply enabled and/or isDefault.' },
      { status: 400 },
    )
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
