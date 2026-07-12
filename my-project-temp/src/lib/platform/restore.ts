// Restore / undo (Protection 2). Before the agent mutates a file, we capture a
// before-image into a RestoreCheckpoint anchored to the chat turn. "Revert to
// this message" replays those images in reverse: write prior bytes back, or
// remove a file the agent created. Server-side artifacts are un-soft-deleted.
//
// Snapshot bytes live in the object store under snapshots/<checkpointId>/…; the
// FileSnapshot rows are the ledger. Checkpoints expire (default 30 days) and are
// pruned by size cap — a long-but-bounded safety net, not permanent history.

import { createHash } from 'crypto'
import { readFile, writeFile, rename, mkdir, rm, stat } from 'fs/promises'
import path from 'path'
import { db } from '@/lib/db'
import { putObject, getObject } from './storage'

export const CHECKPOINT_TTL_DAYS = 30
/** Skip capturing a single file larger than this (undo would be too costly). */
export const MAX_SNAPSHOT_BYTES = 64 * 1024 * 1024

/** Open a checkpoint for a turn. Returns its id (anchor for later restore). */
export async function openCheckpoint(params: {
  userId: string
  agentId?: string | null
  runId?: string | null
  messageId?: string | null
  label?: string
  now: number
}): Promise<string> {
  const cp = await db.restoreCheckpoint.create({
    data: {
      userId: params.userId,
      agentId: params.agentId ?? null,
      runId: params.runId ?? null,
      messageId: params.messageId ?? null,
      label: params.label ?? '',
      expiresAt: new Date(params.now + CHECKPOINT_TTL_DAYS * 86_400_000),
    },
  })
  return cp.id
}

async function fileBytes(p: string): Promise<Buffer | null> {
  try {
    const st = await stat(p)
    if (!st.isFile() || st.size > MAX_SNAPSHOT_BYTES) return null
    return await readFile(p)
  } catch {
    return null
  }
}

async function snapshotPriorBytes(checkpointId: string, absPath: string): Promise<{ key: string | null; size: number; existed: boolean }> {
  const bytes = await fileBytes(absPath)
  if (bytes === null) {
    // Either the file doesn't exist (existed=false) or it's too big to snapshot.
    let existed = false
    try {
      existed = (await stat(absPath)).isFile()
    } catch {
      /* not there */
    }
    return { key: null, size: 0, existed }
  }
  const hash = createHash('sha1').update(absPath).digest('hex').slice(0, 16)
  const key = await putObject(`snapshots/${checkpointId}/${hash}-${bytes.length}`, bytes)
  return { key, size: bytes.length, existed: true }
}

/** Capture the state of `absPath` just before an overwrite/create. */
export async function captureBeforeWrite(checkpointId: string, absPath: string): Promise<void> {
  const snap = await snapshotPriorBytes(checkpointId, absPath)
  await db.fileSnapshot.create({
    data: { checkpointId, op: 'write', path: absPath, existedBefore: snap.existed, priorStorageKey: snap.key, sizeBytes: snap.size },
  })
}

/** Capture a move: record from→to, plus any bytes at `to` we're about to clobber. */
export async function captureBeforeMove(checkpointId: string, fromPath: string, toPath: string): Promise<void> {
  const clobber = await snapshotPriorBytes(checkpointId, toPath)
  await db.fileSnapshot.create({
    data: {
      checkpointId,
      op: 'move',
      path: toPath,
      fromPath,
      existedBefore: clobber.existed,
      priorStorageKey: clobber.key,
      sizeBytes: clobber.size,
    },
  })
}

/** Snapshot every file under a directory subtree (for approved destructive shell,
 *  the "gate + snapshot" choice). Bounded by a total size budget. Returns false
 *  if the budget was exceeded (undo for this op is then unavailable). */
export async function captureDirectory(
  checkpointId: string,
  root: string,
  budgetBytes = 256 * 1024 * 1024,
): Promise<boolean> {
  const { readdir } = await import('fs/promises')
  let spent = 0
  const walk = async (dir: string): Promise<boolean> => {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return true
    }
    for (const e of entries) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) {
        if (!(await walk(full))) return false
      } else if (e.isFile()) {
        const bytes = await fileBytes(full)
        if (bytes) {
          spent += bytes.length
          if (spent > budgetBytes) return false
          const hash = createHash('sha1').update(full).digest('hex').slice(0, 16)
          const key = await putObject(`snapshots/${checkpointId}/${hash}-${bytes.length}`, bytes)
          await db.fileSnapshot.create({
            data: { checkpointId, op: 'root', path: full, existedBefore: true, priorStorageKey: key, sizeBytes: bytes.length },
          })
        }
      }
    }
    return true
  }
  return walk(root)
}

export interface RestoreResult {
  filesRestored: number
  filesRemoved: number
  assetsRecovered: number
  errors: string[]
}

/**
 * Undo every mutation captured in a checkpoint (reverse order). Also
 * un-soft-deletes UserAssets deleted after the checkpoint opened.
 */
export async function restoreCheckpoint(checkpointId: string): Promise<RestoreResult> {
  const cp = await db.restoreCheckpoint.findUnique({ where: { id: checkpointId } })
  if (!cp) throw new Error('checkpoint not found')
  const snaps = await db.fileSnapshot.findMany({ where: { checkpointId }, orderBy: { createdAt: 'desc' } })
  const res: RestoreResult = { filesRestored: 0, filesRemoved: 0, assetsRecovered: 0, errors: [] }

  for (const s of snaps) {
    try {
      if (s.op === 'move') {
        // Move the file back to its original location.
        if (s.fromPath) {
          await mkdir(path.dirname(s.fromPath), { recursive: true })
          try {
            await rename(s.path, s.fromPath)
          } catch {
            /* destination may have been changed since; fall through to bytes */
          }
        }
        // Restore anything we clobbered at the destination.
        if (s.existedBefore && s.priorStorageKey) await writeBack(s.path, s.priorStorageKey)
      } else {
        // write / root
        if (s.existedBefore && s.priorStorageKey) {
          await writeBack(s.path, s.priorStorageKey)
          res.filesRestored++
        } else if (!s.existedBefore) {
          // The agent created this file — undo means remove it.
          await rm(s.path, { force: true })
          res.filesRemoved++
        }
      }
    } catch (e) {
      res.errors.push(`${s.path}: ${(e as Error).message}`)
    }
  }

  // Un-soft-delete assets removed since this checkpoint opened.
  const recovered = await db.userAsset.updateMany({
    where: { userId: cp.userId, deletedAt: { gte: cp.createdAt } },
    data: { deletedAt: null },
  })
  res.assetsRecovered = recovered.count

  await db.restoreCheckpoint.update({ where: { id: checkpointId }, data: { status: 'restored' } })
  return res
}

async function writeBack(absPath: string, storageKey: string): Promise<void> {
  const bytes = await getObject(storageKey)
  if (!bytes) throw new Error(`snapshot bytes missing (${storageKey})`)
  await mkdir(path.dirname(absPath), { recursive: true })
  await writeFile(absPath, bytes)
}

/** Prune expired checkpoints and their snapshot blobs. Returns count pruned. */
export async function pruneExpiredCheckpoints(now: number): Promise<number> {
  const expired = await db.restoreCheckpoint.findMany({
    where: { expiresAt: { lt: new Date(now) }, status: { in: ['active', 'restored'] } },
    select: { id: true },
    take: 200,
  })
  for (const cp of expired) {
    const snaps = await db.fileSnapshot.findMany({ where: { checkpointId: cp.id }, select: { priorStorageKey: true } })
    for (const s of snaps) {
      if (s.priorStorageKey) {
        try {
          const { deleteObject } = await import('./storage')
          await deleteObject(s.priorStorageKey)
        } catch {
          /* best effort */
        }
      }
    }
    await db.restoreCheckpoint.update({ where: { id: cp.id }, data: { status: 'pruned' } })
    await db.fileSnapshot.deleteMany({ where: { checkpointId: cp.id } })
  }
  return expired.length
}
