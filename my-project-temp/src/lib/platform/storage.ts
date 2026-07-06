// Apical object storage — durable bytes for assets and job artifacts.
//
// Two backends behind one storageKey convention:
//   - Supabase Storage (hosted deploys): keys are prefixed "sb:" and live in
//     the SUPABASE_STORAGE_BUCKET bucket. The Next.js app on Vercel has an
//     ephemeral filesystem, so anything that must outlive a request (uploads,
//     job artifacts, screenshots) belongs here.
//   - Local filesystem (desktop / dev fallback): bare relative keys under
//     <cwd>/uploads, the pre-existing convention. Desktop runs a persistent
//     local server with a real disk, so local stays the default there.
//
// Callers never branch on backend — put/get/delete accept and return
// storageKeys and route on the prefix.

import { mkdir, writeFile, readFile, unlink } from 'fs/promises'
import path from 'path'
import { getSupabaseAdmin } from '@/lib/supabase'

const UPLOAD_ROOT = path.join(process.cwd(), 'uploads')
const SB_PREFIX = 'sb:'

function bucketName(): string {
  return process.env.SUPABASE_STORAGE_BUCKET || 'apical-assets'
}

/** Object storage is used for new writes when Supabase is configured and we
 *  are not running as the desktop's bundled local server. */
export function objectStoreEnabled(): boolean {
  if (process.env.DESKTOP_LOCAL === 'true') return false
  return !!getSupabaseAdmin()
}

let bucketReady: Promise<void> | null = null

/** Create the bucket if it doesn't exist yet (idempotent, raced-safe enough
 *  for our use — Supabase returns an "already exists" error we swallow). */
async function ensureBucket(): Promise<void> {
  if (!bucketReady) {
    bucketReady = (async () => {
      const admin = getSupabaseAdmin()
      if (!admin) return
      const { error } = await admin.storage.createBucket(bucketName(), { public: false })
      if (error && !/already exists/i.test(error.message)) {
        // Bucket may exist with different options, or creation is forbidden —
        // uploads will surface the real error; don't fail here.
        console.warn(`[storage] createBucket: ${error.message}`)
      }
    })().catch(() => {
      bucketReady = null
    }) as Promise<void>
  }
  return bucketReady
}

function localAbsPath(storageKey: string): string {
  const rel = storageKey.startsWith(SB_PREFIX) ? storageKey.slice(SB_PREFIX.length) : storageKey
  const abs = path.resolve(UPLOAD_ROOT, rel)
  if (!abs.startsWith(UPLOAD_ROOT + path.sep) && abs !== UPLOAD_ROOT) {
    throw new Error('storage key escapes upload root')
  }
  return abs
}

/** Write bytes under a caller-chosen relative key (e.g. "userId/assetId/name").
 *  Returns the storageKey to persist ("sb:<key>" or the bare local key). */
export async function putObject(
  key: string,
  bytes: Buffer,
  mimeType = 'application/octet-stream',
): Promise<string> {
  const clean = key.replace(/^\/+/, '')
  const admin = objectStoreEnabled() ? getSupabaseAdmin() : null
  if (admin) {
    await ensureBucket()
    const { error } = await admin.storage
      .from(bucketName())
      .upload(clean, bytes, { contentType: mimeType, upsert: true })
    if (error) throw new Error(`storage upload failed: ${error.message}`)
    return `${SB_PREFIX}${clean}`
  }
  const abs = localAbsPath(clean)
  await mkdir(path.dirname(abs), { recursive: true })
  await writeFile(abs, bytes)
  return path.relative(UPLOAD_ROOT, abs)
}

/** Read bytes for a persisted storageKey (either backend). Null when missing. */
export async function getObject(storageKey: string): Promise<Buffer | null> {
  if (storageKey.startsWith(SB_PREFIX)) {
    const admin = getSupabaseAdmin()
    if (!admin) return null
    const { data, error } = await admin.storage
      .from(bucketName())
      .download(storageKey.slice(SB_PREFIX.length))
    if (error || !data) return null
    return Buffer.from(await data.arrayBuffer())
  }
  try {
    return await readFile(localAbsPath(storageKey))
  } catch {
    return null
  }
}

/** Short-lived signed URL for direct download. Null for local keys (serve
 *  bytes through the API route instead). */
export async function getSignedUrl(storageKey: string, ttlSeconds = 3600): Promise<string | null> {
  if (!storageKey.startsWith(SB_PREFIX)) return null
  const admin = getSupabaseAdmin()
  if (!admin) return null
  const { data, error } = await admin.storage
    .from(bucketName())
    .createSignedUrl(storageKey.slice(SB_PREFIX.length), ttlSeconds)
  if (error || !data?.signedUrl) return null
  return data.signedUrl
}

export async function deleteObject(storageKey: string): Promise<void> {
  if (storageKey.startsWith(SB_PREFIX)) {
    const admin = getSupabaseAdmin()
    if (!admin) return
    await admin.storage.from(bucketName()).remove([storageKey.slice(SB_PREFIX.length)])
    return
  }
  try {
    await unlink(localAbsPath(storageKey))
  } catch {
    // already gone
  }
}
