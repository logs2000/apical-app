// Server job backend — runs jobs as detached subprocesses inside the
// agent-worker. Progress is polled from the job's progress.json; on finish,
// files under out/ are uploaded as UserAssets (source: "job").

import { basename, extname } from 'path'
import { readFile } from 'fs/promises'
import { db } from '@/lib/db'
import { saveAsset } from '@/lib/platform/assets'
import { startScriptJob, readJobProgress, cleanupJobDir, type JobHandle } from '@/lib/platform/script-runner'
import { parseJobPayload, type JobBackend } from './types'

const PROGRESS_POLL_MS = 5_000

// Live handles for jobs this worker process is running (for cancellation).
const handles = new Map<string, JobHandle>()

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.csv': 'text/csv',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.obj': 'text/plain',
  '.ply': 'application/octet-stream',
  '.mp4': 'video/mp4',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
}

function mimeForFile(name: string): string {
  return MIME_BY_EXT[extname(name).toLowerCase()] || 'application/octet-stream'
}

export const serverJobBackend: JobBackend = {
  id: 'server',

  async dispatch(jobId, workerId) {
    const job = await db.job.findUnique({ where: { id: jobId } })
    if (!job || job.claimedBy !== workerId || job.status !== 'accepted') return
    const payload = parseJobPayload(job.payloadJson)

    await db.job.update({
      where: { id: jobId },
      data: { status: 'running', startedAt: new Date(), progress: 0, leaseUntil: new Date(Date.now() + 120_000) },
    })

    const handle = await startScriptJob({
      jobId,
      language: payload.language,
      source: payload.source,
      packages: payload.packages,
      data: payload.args && payload.args.length ? JSON.stringify(payload.args) : undefined,
      args: payload.args,
      timeoutMs: job.timeoutMs,
    })
    handles.set(jobId, handle)

    // Poll progress.json into the row + renew the lease while the job runs
    // (so the tick's stale-running reclaim doesn't kill a healthy long job).
    const poll = setInterval(() => {
      void (async () => {
        const p = await readJobProgress(jobId)
        await db.job
          .updateMany({
            where: { id: jobId, status: 'running' },
            data: {
              ...(p?.progress != null ? { progress: p.progress } : {}),
              ...(p?.note ? { progressNote: p.note } : {}),
              leaseUntil: new Date(Date.now() + 120_000),
            },
          })
          .catch(() => {})
      })()
    }, PROGRESS_POLL_MS)

    try {
      const result = await handle.done
      clearInterval(poll)
      handles.delete(jobId)

      // Upload artifacts (best-effort — a failed upload doesn't fail the job).
      const artifactIds: string[] = []
      for (const filePath of result.artifactPaths) {
        try {
          const bytes = await readFile(filePath)
          const name = basename(filePath)
          const asset = await saveAsset({
            userId: job.userId,
            agentId: job.agentId ?? null,
            name,
            bytes,
            mimeType: mimeForFile(name),
            source: 'agent',
            meta: { jobId },
          })
          artifactIds.push(asset.id)
        } catch (e) {
          console.error(`[jobs/server] artifact upload failed (${jobId}):`, (e as Error).message)
        }
      }

      const finalStatus = result.timedOut ? 'timeout' : result.ok ? 'completed' : 'failed'
      await db.job.update({
        where: { id: jobId },
        data: {
          status: finalStatus,
          progress: result.ok ? 1 : undefined,
          resultJson: JSON.stringify({
            stdoutTail: result.stdoutTail,
            stderrTail: result.stderrTail,
            exitCode: result.exitCode,
          }),
          error: result.error ?? null,
          artifactIdsJson: artifactIds.length ? JSON.stringify(artifactIds) : null,
          claimedBy: null,
          leaseUntil: null,
          finishedAt: new Date(),
        },
      })
      await cleanupJobDir(jobId)
    } catch (e) {
      clearInterval(poll)
      handles.delete(jobId)
      await db.job
        .update({
          where: { id: jobId },
          data: { status: 'failed', error: (e as Error).message.slice(0, 1000), claimedBy: null, leaseUntil: null, finishedAt: new Date() },
        })
        .catch(() => {})
      await cleanupJobDir(jobId)
    }
  },

  async cancel(jobId) {
    handles.get(jobId)?.cancel()
    handles.delete(jobId)
  },
}
