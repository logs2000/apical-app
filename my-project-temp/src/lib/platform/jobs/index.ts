// Async job layer — dispatch + the worker tick that drives server jobs.

import { db } from '@/lib/db'
import { serverJobBackend } from './server'
import { desktopJobBackend } from './desktop'
import { cloudJobBackend } from './cloud-stub'
import type { JobBackend, JobBackendId } from './types'

export * from './types'

const BACKENDS: Record<JobBackendId, JobBackend> = {
  server: serverJobBackend,
  desktop: desktopJobBackend,
  cloud: cloudJobBackend,
}

export function jobBackend(id: string): JobBackend {
  return BACKENDS[(id as JobBackendId)] ?? serverJobBackend
}

const LEASE_MS = 120_000

/** Cancel a job — routes to its backend, then marks the row cancelled. */
export async function cancelJob(jobId: string): Promise<void> {
  const job = await db.job.findUnique({ where: { id: jobId }, select: { backend: true, status: true } })
  if (!job || ['completed', 'failed', 'cancelled', 'timeout'].includes(job.status)) return
  await jobBackend(job.backend).cancel(jobId).catch(() => {})
  await db.job.updateMany({
    where: { id: jobId, status: { in: ['queued', 'accepted', 'running'] } },
    data: { status: 'cancelled', finishedAt: new Date(), claimedBy: null, leaseUntil: null },
  })
}

/**
 * One job-worker tick. Claims queued jobs (server + desktop backends) up to
 * the budget and dispatches them. Server jobs run in-process here (long-lived
 * promises tracked by the caller); desktop jobs hand off after the handshake.
 * Cloud jobs are claimed only to be failed fast by the stub.
 */
export async function jobWorkerTick(
  workerId: string,
  inFlight: Map<string, Promise<void>>,
  maxConcurrent: number,
): Promise<void> {
  const now = new Date()

  // Reclaim server jobs whose worker crashed mid-run: the subprocess is gone,
  // so they can't resume — fail them rather than leave them stuck 'running'.
  await db.job.updateMany({
    where: { status: 'running', backend: 'server', leaseUntil: { lt: now } },
    data: { status: 'failed', error: 'worker crashed while the job was running', claimedBy: null, leaseUntil: null, finishedAt: now },
  })

  const slots = maxConcurrent - inFlight.size
  if (slots <= 0) return
  const candidates = await db.job.findMany({
    where: {
      OR: [
        { status: 'queued' },
        { status: 'accepted', backend: 'server', leaseUntil: { lt: now } }, // crashed mid-run
      ],
    },
    orderBy: { createdAt: 'asc' },
    take: slots * 3,
    select: { id: true, backend: true },
  })
  let claimed = 0
  for (const c of candidates) {
    if (claimed >= slots) break
    const res = await db.job.updateMany({
      where: { id: c.id, OR: [{ status: 'queued' }, { status: 'accepted', leaseUntil: { lt: now } }] },
      data: { status: 'accepted', claimedBy: workerId, leaseUntil: new Date(Date.now() + LEASE_MS) },
    })
    if (res.count !== 1) continue
    claimed++
    const backend = jobBackend(c.backend)
    const p = backend
      .dispatch(c.id, workerId)
      .catch(async (e) => {
        await db.job
          .updateMany({
            where: { id: c.id, claimedBy: workerId },
            data: { status: 'failed', error: (e as Error).message.slice(0, 1000), claimedBy: null, leaseUntil: null, finishedAt: new Date() },
          })
          .catch(() => {})
      })
      .finally(() => inFlight.delete(c.id))
    inFlight.set(c.id, p)
  }
}
