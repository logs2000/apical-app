import { createHash, randomBytes } from 'crypto'
import { mkdir, writeFile, readFile, unlink } from 'fs/promises'
import path from 'path'
import { db } from '@/lib/db'

const UPLOAD_ROOT = path.join(process.cwd(), 'uploads')

export type AssetKind = 'image' | 'file' | 'folder' | 'code'
export type AssetSource = 'upload' | 'agent' | 'script'

export interface SaveAssetInput {
  userId: string
  name: string
  bytes: Buffer
  mimeType?: string
  kind?: AssetKind
  source?: AssetSource
  agentId?: string | null
  conversationId?: string | null
  messageId?: string | null
  localPath?: string | null
  meta?: Record<string, unknown>
}

export interface AssetRecord {
  id: string
  userId: string
  agentId: string | null
  name: string
  mimeType: string
  sizeBytes: number
  kind: string
  source: string
  localPath: string | null
  url: string
  createdAt: string
  meta?: Record<string, unknown>
}

function inferKind(mimeType: string, name: string): AssetKind {
  if (mimeType.startsWith('image/')) return 'image'
  if (/\.(js|ts|py|sh|bash|json|csv|md)$/i.test(name)) return 'code'
  return 'file'
}

function storagePath(userId: string, assetId: string, name: string): string {
  const safe = name.replace(/[^\w.\-()+ ]/g, '_').slice(0, 120)
  return path.join(UPLOAD_ROOT, userId, assetId, safe)
}

export function assetDownloadUrl(assetId: string): string {
  return `/api/assets/${assetId}/download`
}

export function toAssetRecord(row: {
  id: string
  userId: string
  agentId: string | null
  name: string
  mimeType: string
  sizeBytes: number
  kind: string
  source: string
  localPath: string | null
  metaJson: string | null
  createdAt: Date
}): AssetRecord {
  return {
    id: row.id,
    userId: row.userId,
    agentId: row.agentId,
    name: row.name,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    kind: row.kind,
    source: row.source,
    localPath: row.localPath,
    url: assetDownloadUrl(row.id),
    createdAt: row.createdAt.toISOString(),
    meta: row.metaJson ? (JSON.parse(row.metaJson) as Record<string, unknown>) : undefined,
  }
}

export async function saveAsset(input: SaveAssetInput): Promise<AssetRecord> {
  const id = `asset_${randomBytes(8).toString('hex')}`
  const mimeType = input.mimeType || 'application/octet-stream'
  const kind = input.kind || inferKind(mimeType, input.name)
  const absPath = storagePath(input.userId, id, input.name)
  await mkdir(path.dirname(absPath), { recursive: true })
  await writeFile(absPath, input.bytes)

  const row = await db.userAsset.create({
    data: {
      id,
      userId: input.userId,
      agentId: input.agentId ?? null,
      conversationId: input.conversationId ?? null,
      messageId: input.messageId ?? null,
      name: input.name,
      mimeType,
      sizeBytes: input.bytes.length,
      storageKey: path.relative(UPLOAD_ROOT, absPath),
      kind,
      source: input.source ?? 'upload',
      localPath: input.localPath ?? null,
      metaJson: input.meta ? JSON.stringify(input.meta) : null,
    },
  })

  return toAssetRecord(row)
}

/** Register a folder path reference without uploading bytes (desktop). */
export async function saveFolderRef(input: {
  userId: string
  name: string
  localPath: string
  agentId?: string | null
}): Promise<AssetRecord> {
  const id = `asset_${randomBytes(8).toString('hex')}`
  const row = await db.userAsset.create({
    data: {
      id,
      userId: input.userId,
      agentId: input.agentId ?? null,
      name: input.name,
      mimeType: 'inode/directory',
      sizeBytes: 0,
      storageKey: `ref/${id}`,
      kind: 'folder',
      source: 'upload',
      localPath: input.localPath,
    },
  })
  return toAssetRecord(row)
}

export async function listUserAssets(
  userId: string,
  opts?: { agentId?: string; kind?: string; limit?: number },
): Promise<AssetRecord[]> {
  const rows = await db.userAsset.findMany({
    where: {
      userId,
      ...(opts?.agentId ? { agentId: opts.agentId } : {}),
      ...(opts?.kind ? { kind: opts.kind } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: opts?.limit ?? 100,
  })
  return rows.map(toAssetRecord)
}

export async function getUserAsset(userId: string, assetId: string) {
  return db.userAsset.findFirst({ where: { id: assetId, userId } })
}

export async function readAssetBytes(userId: string, assetId: string): Promise<Buffer | null> {
  const row = await getUserAsset(userId, assetId)
  if (!row || row.kind === 'folder') return null
  const absPath = path.join(UPLOAD_ROOT, row.storageKey)
  try {
    return await readFile(absPath)
  } catch {
    return null
  }
}

export async function deleteUserAsset(userId: string, assetId: string): Promise<boolean> {
  const row = await getUserAsset(userId, assetId)
  if (!row) return false
  if (row.kind !== 'folder') {
    try {
      await unlink(path.join(UPLOAD_ROOT, row.storageKey))
    } catch {
      // file may already be gone
    }
  }
  await db.userAsset.delete({ where: { id: assetId } })
  return true
}

export function hashBuffer(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex').slice(0, 16)
}
