import { decrypt } from '@/lib/platform/vault'
import { maskConfig } from '@/lib/platform/data-plugins'
import type { DataConnection } from '@prisma/client'

export interface DataConnectionDto {
  id: string
  userId: string
  kind: string
  name: string
  config: Record<string, unknown>
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

function decryptSafe(encrypted: string): string {
  try {
    return decrypt(encrypted)
  } catch {
    return '{}'
  }
}
