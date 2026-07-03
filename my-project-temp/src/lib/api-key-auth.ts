// Apical — unified API key authentication.
//
// ONE key system for everything that isn't a browser session: the REST API
// (/v1 + legacy /api/dev), the apical-mcp mini-service, CI, scripts. Keys are
// workspace-scoped rows in the ApiKey table ("WorkspaceApiKey"), SHA-256
// hashed, and carry scopes + optional per-key spend limits.
//
// Legacy tokens keep working: both `ap_pat_...` (old PersonalAccessToken) and
// `ap_sk_...` (old DeveloperAccount key) hashes were migrated into this table
// by prisma/backfill-workspaces.ts. Their scopesJson is "[]" which means ALL
// scopes (legacy behavior).

import { createHash, randomBytes } from 'crypto'
import { cookies } from 'next/headers'
import { db } from './db'
import type { ApiKey, User, Workspace } from '@prisma/client'

// ---------------- Scopes ----------------

export const API_KEY_SCOPES = [
  'workflows:read',
  'workflows:write',
  'runs:execute',
  'runs:read',
  'credentials:manage',
  'registry:read',
  'usage:read',
  'billing:manage',
  'webhooks:manage',
] as const

export type ApiKeyScope = (typeof API_KEY_SCOPES)[number]

// ---------------- Key generation + hashing ----------------

/** SHA-256 hex of the raw key. What we store in ApiKey.keyHash. */
export function hashApiKey(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

/**
 * Generate a new API key. Default prefix `ap_sk_`; pass `ap_pat_` for
 * personal tokens created from Settings (identical semantics, different
 * display prefix). Returns the raw key (shown ONCE), hash, and display prefix.
 */
export function generateApiKey(prefix: 'ap_sk_' | 'ap_pat_' = 'ap_sk_'): {
  raw: string
  hash: string
  prefix: string
} {
  const raw = prefix + randomBytes(16).toString('hex')
  return { raw, hash: hashApiKey(raw), prefix: raw.slice(0, 12) }
}

// ---------------- Authentication ----------------

/** The cookie the developer console uses to keep the raw key. */
export const DEV_KEY_COOKIE = 'apical_dev_key'

export interface ApiKeyAuthResult {
  workspace: Workspace
  apiKey: ApiKey
  /** Parsed scopes. Empty array = ALL scopes (legacy keys). */
  scopes: string[]
  /** The acting user, when resolvable (key creator or workspace owner). */
  user: User | null
}

/**
 * Tolerantly read the raw API key from a request:
 *   1. `Authorization: Bearer ap_...` header
 *   2. `x-apical-key: ap_...` header
 *   3. `apical_dev_key` cookie (developer console)
 */
export async function readRawApiKey(req: Request): Promise<string | null> {
  const auth = req.headers.get('authorization') || req.headers.get('Authorization')
  if (auth) {
    const trimmed = auth.trim()
    const raw = trimmed.startsWith('Bearer ')
      ? trimmed.slice('Bearer '.length).trim()
      : trimmed
    if (raw) return raw
  }
  const xKey = req.headers.get('x-apical-key')
  if (xKey) {
    const trimmed = xKey.trim()
    const raw = trimmed.startsWith('Bearer ')
      ? trimmed.slice('Bearer '.length).trim()
      : trimmed
    if (raw) return raw
  }
  try {
    const c = await cookies()
    const cookieKey = c.get(DEV_KEY_COOKIE)?.value
    if (cookieKey) return cookieKey
  } catch {
    // cookies() can throw outside a request scope — fall through.
  }
  return null
}

/** Derive 'mcp' | 'rest' from `?source=` query param or `x-apical-source` header. */
export function deriveKeySource(req: Request): 'mcp' | 'rest' {
  try {
    const url = new URL(req.url)
    const q = url.searchParams.get('source')
    if (q === 'mcp' || q === 'rest') return q
  } catch {
    // ignore
  }
  const h = req.headers.get('x-apical-source')
  if (h === 'mcp' || h === 'rest') return h
  return 'rest'
}

function parseScopes(scopesJson: string): string[] {
  try {
    const parsed = JSON.parse(scopesJson) as unknown
    if (Array.isArray(parsed)) return parsed.filter((s): s is string => typeof s === 'string')
  } catch {
    // fall through
  }
  return []
}

/**
 * Authenticate a request via unified API key. Returns null on any failure
 * (no/invalid key, revoked key, suspended workspace) — never throws.
 */
export async function authenticateApiKey(
  req: Request,
): Promise<ApiKeyAuthResult | null> {
  try {
    const raw = await readRawApiKey(req)
    if (!raw) return null
    // All Apical keys are prefixed; skip lookups for foreign bearer tokens
    // (e.g. Supabase JWTs on the same header).
    if (!raw.startsWith('ap_')) return null

    const apiKey = await db.apiKey.findUnique({
      where: { keyHash: hashApiKey(raw) },
      include: { workspace: true },
    })
    if (!apiKey) return null
    if (apiKey.status !== 'active') return null
    if (apiKey.workspace.status !== 'active') return null

    // Touch last-used metadata (best-effort; never blocks the request).
    const source = deriveKeySource(req)
    void db.apiKey
      .update({
        where: { id: apiKey.id },
        data: { lastUsedAt: new Date(), lastUsedFrom: source },
      })
      .catch((e) => {
        console.error('[api-key-auth] lastUsedAt update failed:', e)
      })

    // Resolve the acting user: key creator → legacy workspace owner → first
    // owner member. Null when none resolve (pure machine workspace).
    let user: User | null = null
    if (apiKey.createdById) {
      user = await db.user.findUnique({ where: { id: apiKey.createdById } })
    }
    if (!user && apiKey.workspace.userId) {
      user = await db.user.findUnique({ where: { id: apiKey.workspace.userId } })
    }
    if (!user) {
      const member = await db.workspaceMember.findFirst({
        where: { workspaceId: apiKey.workspaceId, role: 'owner' },
        include: { user: true },
      })
      user = member?.user ?? null
    }

    const { workspace, ...key } = apiKey
    return {
      workspace,
      apiKey: key as ApiKey,
      scopes: parseScopes(apiKey.scopesJson),
      user,
    }
  } catch (err) {
    console.error('[api-key-auth] authenticateApiKey failed:', err)
    return null
  }
}

/** True when the key grants the scope. Empty scopes = all (legacy keys). */
export function keyHasScope(result: Pick<ApiKeyAuthResult, 'scopes'>, scope: ApiKeyScope): boolean {
  return result.scopes.length === 0 || result.scopes.includes(scope)
}

// ---------------- Audit log ----------------

/** Append an audit-log row (best-effort — callers usually don't await). */
export async function logKeyAudit(opts: {
  workspaceId: string
  apiKeyId?: string | null
  action: string
  target?: string | null
  success?: boolean
  costCents?: number
  detail?: string
  source?: 'mcp' | 'rest' | 'web'
}): Promise<void> {
  try {
    await db.mcpAuditLog.create({
      data: {
        workspaceId: opts.workspaceId,
        apiKeyId: opts.apiKeyId ?? null,
        action: opts.action,
        target: opts.target ?? null,
        success: opts.success ?? true,
        costCents: opts.costCents ?? 0,
        detail: opts.detail ?? null,
        source: opts.source ?? 'rest',
      },
    })
  } catch (err) {
    console.error('[api-key-auth] audit log write failed:', err)
  }
}

// ---------------- Workspace resolution for session users ----------------

/**
 * The user's primary workspace: first membership → legacy-owned workspace →
 * created on the fly (personal workspace + owner membership). This is THE
 * bridge from user-scoped session auth to workspace tenancy.
 */
export async function getWorkspaceForUser(user: User): Promise<Workspace> {
  const member = await db.workspaceMember.findFirst({
    where: { userId: user.id },
    orderBy: { createdAt: 'asc' },
    include: { workspace: true },
  })
  if (member) return member.workspace

  const legacy = await db.workspace.findFirst({
    where: { userId: user.id },
    orderBy: { createdAt: 'asc' },
  })
  const ws =
    legacy ??
    (await db.workspace.create({
      data: {
        userId: user.id,
        name: user.name ? `${user.name}'s Workspace` : 'Personal',
        description: 'Personal workspace',
      },
    }))
  await db.workspaceMember.upsert({
    where: { workspaceId_userId: { workspaceId: ws.id, userId: user.id } },
    update: {},
    create: { workspaceId: ws.id, userId: user.id, role: 'owner' },
  })
  return ws
}
