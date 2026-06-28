import { randomBytes } from 'crypto'
import type { DesktopSession } from '@prisma/client'

export interface DesktopSessionDto {
  id: string
  userId: string
  label: string
  platform: string | null
  arch: string | null
  appVersion: string | null
  status: string
  lastSeenAt: string | null
  capabilities: string[]
  createdAt: string
  updatedAt: string
}

export interface DesktopSessionWithTokenDto extends DesktopSessionDto {
  sessionToken: string
}

/** Map a Prisma DesktopSession row to the public DTO (no sessionToken). */
export function mapSession(row: DesktopSession): DesktopSessionDto {
  let capabilities: string[] = []
  try {
    const parsed = JSON.parse(row.capabilitiesJson) as unknown
    if (Array.isArray(parsed)) {
      capabilities = parsed.filter((v): v is string => typeof v === 'string')
    }
  } catch {
    /* leave empty */
  }
  return {
    id: row.id,
    userId: row.userId,
    label: row.label,
    platform: row.platform,
    arch: row.arch,
    appVersion: row.appVersion,
    status: row.status,
    lastSeenAt: row.lastSeenAt ? row.lastSeenAt.toISOString() : null,
    capabilities,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

/** Mint a fresh `dsk_` + 24 random bytes (hex) session token. */
export function mintSessionToken(): string {
  return 'dsk_' + randomBytes(24).toString('hex')
}
