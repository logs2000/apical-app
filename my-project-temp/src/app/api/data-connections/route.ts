import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withUser } from '@/lib/auth-helpers'
import { encrypt, decrypt } from '@/lib/platform/vault'
import {
  DATA_PLUGINS,
  getPlugin,
  maskConfig,
  type DataPluginKind,
} from '@/lib/platform/data-plugins'
import type { DataConnection } from '@prisma/client'

// API routes for /api/data-connections.
//
//   GET   — list the user's DataConnections. Secrets are masked; non-secret
//           fields (host, baseName, …) are returned in `config`.
//   POST  — create a new connection. Validates config against the plugin's
//           schema, encrypts the whole config object at rest, persists.
//
// The plaintext config is NEVER returned by the API after creation — only
// the masked view. The only way to recover the full config is to decrypt it
// server-side (e.g. inside a workflow runner).

export interface DataConnectionDto {
  id: string
  userId: string
  kind: string
  name: string
  config: Record<string, unknown> // masked
  meta: Record<string, unknown>
  status: string
  lastStatus: string | null
  lastCheckedAt: string | null
  createdAt: string
  updatedAt: string
}

export function mapConnection(row: DataConnection): DataConnectionDto {
  let config: Record<string, unknown> = {}
  try {
    const parsed = JSON.parse(
      decryptSafe(row.encryptedConfig),
    ) as Record<string, unknown>
    if (parsed && typeof parsed === 'object') {
      config = parsed
    }
  } catch {
    /* leave empty */
  }
  let meta: Record<string, unknown> = {}
  try {
    const parsed = JSON.parse(row.metaJson) as Record<string, unknown>
    if (parsed && typeof parsed === 'object') meta = parsed
  } catch {
    /* ignore */
  }
  return {
    id: row.id,
    userId: row.userId,
    kind: row.kind,
    name: row.name,
    config: maskConfig(row.kind, config),
    meta,
    status: row.status,
    lastStatus: row.lastStatus,
    lastCheckedAt: row.lastCheckedAt ? row.lastCheckedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

/** Decrypt + return {} on failure (best-effort; never throws). */
function decryptSafe(encrypted: string): string {
  try {
    return decrypt(encrypted)
  } catch {
    return '{}'
  }
}

// GET /api/data-connections — list + the catalog of available plugins.
export const GET = withUser(async (_req, { user }) => {
  const rows = await db.dataConnection.findMany({
    where: { userId: user.id },
    orderBy: { updatedAt: 'desc' },
  })
  return NextResponse.json({
    connections: rows.map(mapConnection),
    plugins: DATA_PLUGINS.map((p) => ({
      kind: p.kind,
      name: p.name,
      icon: p.icon,
      description: p.description,
      category: p.category,
      configFields: p.configFields.map((f) => ({
        key: f.key,
        label: f.label,
        type: f.type,
        placeholder: f.placeholder,
        required: f.required ?? false,
        secret: f.secret ?? false,
        help: f.help,
        defaultValue: f.defaultValue,
      })),
    })),
  })
})

interface CreateBody {
  kind?: string
  name?: string
  config?: Record<string, unknown>
}

// POST /api/data-connections
export const POST = withUser(async (req, { user }) => {
  let body: CreateBody = {}
  try {
    body = (await req.json()) as CreateBody
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  const kind = (body.kind || '').trim()
  if (!kind) {
    return NextResponse.json({ error: 'kind is required' }, { status: 400 })
  }
  const plugin = getPlugin(kind)
  if (!plugin) {
    return NextResponse.json(
      {
        error: `unknown kind: ${kind}. Supported: ${DATA_PLUGINS.map(
          (p) => p.kind,
        ).join(', ')}`,
      },
      { status: 400 },
    )
  }

  const name = (body.name || '').trim()
  if (!name) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }
  if (name.length > 200) {
    return NextResponse.json(
      { error: 'name is too long (200 chars max)' },
      { status: 400 },
    )
  }

  const config = body.config && typeof body.config === 'object' ? body.config : {}
  const validationError = plugin.validate(config)
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 })
  }

  // Encrypt the WHOLE config blob at rest.
  const encryptedConfig = encrypt(JSON.stringify(config))
  const meta = plugin.buildMeta ? plugin.buildMeta(config) : {}

  const created = await db.dataConnection.create({
    data: {
      userId: user.id,
      kind: kind as DataPluginKind,
      name,
      encryptedConfig,
      metaJson: JSON.stringify(meta),
      status: 'active',
    },
  })

  return NextResponse.json(mapConnection(created), { status: 201 })
})
