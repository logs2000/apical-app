import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withUser } from '@/lib/auth-helpers'
import { encrypt } from '@/lib/platform/vault'
import { getPlugin } from '@/lib/platform/data-plugins'
import { mapConnection } from '@/lib/data-connections/connection-dto'

// API routes for /api/data-connections/[id].
//
//   PATCH   — update the connection's name + config. Re-validates + re-
//             encrypts. (Useful for rotating an API key.)
//   DELETE  — remove the connection.

interface RouteCtx {
  params: Promise<{ id: string }>
}

interface PatchBody {
  name?: string
  config?: Record<string, unknown>
}

// PATCH /api/data-connections/[id]
export const PATCH = withUser(async (req, { user, params }) => {
  const { id } = params
  const existing = await db.dataConnection.findUnique({ where: { id } })
  if (!existing || existing.userId !== user.id) {
    return NextResponse.json(
      { error: 'Connection not found' },
      { status: 404 },
    )
  }

  let body: PatchBody = {}
  try {
    body = (await req.json()) as PatchBody
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  const data: { name?: string; encryptedConfig?: string; metaJson?: string } = {}

  if (typeof body.name === 'string') {
    const name = body.name.trim()
    if (!name) {
      return NextResponse.json(
        { error: 'name cannot be empty' },
        { status: 400 },
      )
    }
    if (name.length > 200) {
      return NextResponse.json(
        { error: 'name is too long (200 chars max)' },
        { status: 400 },
      )
    }
    data.name = name
  }

  if (body.config && typeof body.config === 'object') {
    const plugin = getPlugin(existing.kind)
    if (!plugin) {
      return NextResponse.json(
        { error: `plugin for kind ${existing.kind} no longer registered` },
        { status: 400 },
      )
    }
    const err = plugin.validate(body.config)
    if (err) {
      return NextResponse.json({ error: err }, { status: 400 })
    }
    data.encryptedConfig = encrypt(JSON.stringify(body.config))
    if (plugin.buildMeta) {
      data.metaJson = JSON.stringify(plugin.buildMeta(body.config))
    }
  }

  const updated = await db.dataConnection.update({ where: { id }, data })
  return NextResponse.json(mapConnection(updated))
})

// DELETE /api/data-connections/[id]
export const DELETE = withUser(async (_req, { user, params }) => {
  const { id } = params
  const existing = await db.dataConnection.findUnique({ where: { id } })
  if (!existing || existing.userId !== user.id) {
    return NextResponse.json(
      { error: 'Connection not found' },
      { status: 404 },
    )
  }
  await db.dataConnection.delete({ where: { id } })
  return NextResponse.json({ ok: true })
})
