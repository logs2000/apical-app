// Apical cloud PAT — lets the local desktop app call hosted models on
// api.apic.al using the user's Personal Access Token (ap_pat_...).
//
// The raw token is stored encrypted (AES-256-GCM) in a Credential row with
// service "apical-cloud". Env fallback: APICAL_PAT.

import { config as loadEnv } from 'dotenv'
import fs from 'fs'
import path from 'path'
import { db } from '@/lib/db'

/** Standalone server cwd is `.next/standalone` — load repo env files at runtime. */
function ensureRuntimeEnvLoaded(): void {
  if (process.env.__APICAL_ENV_LOADED === '1') return
  const roots = [
    process.cwd(),
    path.join(process.cwd(), '..'),
    path.join(process.cwd(), '../..'),
  ]
  for (const root of roots) {
    for (const file of ['.env.local', '.env']) {
      const envPath = path.join(root, file)
      if (fs.existsSync(envPath)) {
        loadEnv({ path: envPath, override: false })
      }
    }
  }
  process.env.__APICAL_ENV_LOADED = '1'
}

ensureRuntimeEnvLoaded()
import { PAT_PREFIX } from '@/lib/auth-helpers'
import { decrypt, encrypt } from '@/lib/platform/vault'

export const CLOUD_PAT_SERVICE = 'apical-cloud'

/** Base URL for the hosted Apical API (Settings → API tokens). */
export function getApicalCloudUrl(): string {
  const raw =
    process.env.APICAL_CLOUD_URL?.trim() ||
    process.env.NEXT_PUBLIC_APICAL_CLOUD_URL?.trim() ||
    'https://api.apic.al'
  return raw.replace(/\/+$/, '')
}

export function looksLikeApicalPat(value: string): boolean {
  const v = value.trim()
  return v.startsWith(PAT_PREFIX) && v.length > PAT_PREFIX.length + 8
}

/** Read the cloud PAT from env (global fallback for dev / CI). */
export function getEnvCloudPat(): string | null {
  const raw = process.env.APICAL_PAT?.trim()
  if (!raw || !looksLikeApicalPat(raw)) return null
  return raw
}

/** Load the user's stored cloud PAT (env wins, then encrypted credential). */
export async function getCloudPat(userId: string): Promise<string | null> {
  ensureRuntimeEnvLoaded()
  const fromEnv = getEnvCloudPat()
  if (fromEnv) return fromEnv

  const row = await db.credential.findFirst({
    where: { userId, service: CLOUD_PAT_SERVICE, status: 'active' },
    orderBy: { updatedAt: 'desc' },
  })
  if (!row) return null

  try {
    const meta = JSON.parse(row.metaJson || '{}') as { key?: string }
    if (!meta.key) return null
    const pat = decrypt(meta.key).trim()
    return looksLikeApicalPat(pat) ? pat : null
  } catch {
    return null
  }
}

export async function isCloudRelayAvailable(userId: string): Promise<boolean> {
  return (await getCloudPat(userId)) !== null
}

/** Masked prefix for UI (e.g. ap_pat_abc1…). */
export async function getCloudPatStatus(userId: string): Promise<{
  configured: boolean
  prefix: string | null
  source: 'env' | 'stored' | null
  cloudUrl: string
}> {
  const cloudUrl = getApicalCloudUrl()
  const fromEnv = getEnvCloudPat()
  if (fromEnv) {
    return {
      configured: true,
      prefix: fromEnv.slice(0, 12) + '…',
      source: 'env',
      cloudUrl,
    }
  }

  const row = await db.credential.findFirst({
    where: { userId, service: CLOUD_PAT_SERVICE, status: 'active' },
    orderBy: { updatedAt: 'desc' },
  })
  if (!row) {
    return { configured: false, prefix: null, source: null, cloudUrl }
  }

  try {
    const meta = JSON.parse(row.metaJson || '{}') as { prefix?: string }
    return {
      configured: true,
      prefix: meta.prefix ?? row.label,
      source: 'stored',
      cloudUrl,
    }
  } catch {
    return { configured: true, prefix: row.label, source: 'stored', cloudUrl }
  }
}

/** Validate, encrypt, and persist the user's cloud PAT. */
export async function saveCloudPat(userId: string, rawPat: string): Promise<void> {
  const pat = rawPat.trim()
  if (!looksLikeApicalPat(pat)) {
    throw new Error('Invalid Apical token — expected ap_pat_...')
  }

  const existing = await db.credential.findFirst({
    where: { userId, service: CLOUD_PAT_SERVICE },
  })

  const meta = JSON.stringify({
    key: encrypt(pat),
    prefix: pat.slice(0, 12) + '…',
  })

  if (existing) {
    await db.credential.update({
      where: { id: existing.id },
      data: {
        label: pat.slice(0, 12) + '…',
        status: 'active',
        metaJson: meta,
      },
    })
    return
  }

  await db.credential.create({
    data: {
      userId,
      service: CLOUD_PAT_SERVICE,
      label: pat.slice(0, 12) + '…',
      kind: 'apikey',
      status: 'active',
      metaJson: meta,
      agentProvisioned: false,
      canPay: false,
    },
  })
}

export async function clearCloudPat(userId: string): Promise<void> {
  await db.credential.deleteMany({
    where: { userId, service: CLOUD_PAT_SERVICE },
  })
}
