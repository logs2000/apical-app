// Desktop job backend — the user's machine runs the job (GPU, local files).
//
// The 120s bridge cap is NOT a job-duration limit here: the bridge call is
// only an ACCEPTANCE HANDSHAKE. We ask the desktop to `desktop.job.start`;
// it ACKs immediately and runs the job locally for as long as it takes,
// pushing `desktop:job_update` events (handled in the desktop-bridge service)
// that write progress + terminal state straight to the Job row. Artifacts are
// uploaded by the desktop over its authenticated HTTP session.

import { db } from '@/lib/db'
import { parseJobPayload, type JobBackend } from './types'

const BRIDGE_URL = process.env.DESKTOP_BRIDGE_URL || 'http://localhost:3005/invoke'

async function onlineSessionId(userId: string, preferred?: string | null): Promise<string | null> {
  if (preferred) {
    const s = await db.desktopSession.findFirst({ where: { id: preferred, userId, status: 'online' }, select: { id: true } })
    if (s) return s.id
  }
  const s = await db.desktopSession.findFirst({
    where: { userId, status: 'online' },
    orderBy: { lastSeenAt: 'desc' },
    select: { id: true },
  })
  return s?.id ?? null
}

export const desktopJobBackend: JobBackend = {
  id: 'desktop',

  async dispatch(jobId, workerId) {
    const job = await db.job.findUnique({ where: { id: jobId } })
    if (!job || job.claimedBy !== workerId || job.status !== 'accepted') return
    const payload = parseJobPayload(job.payloadJson)

    const sessionId = await onlineSessionId(job.userId, job.desktopSessionId)
    if (!sessionId) {
      // No desktop online — release back to queued so it dispatches when the
      // desktop reconnects (don't fail: the user may just be offline briefly).
      await db.job.updateMany({
        where: { id: jobId, claimedBy: workerId },
        data: { status: 'queued', claimedBy: null, leaseUntil: null, progressNote: 'waiting for desktop to come online' },
      })
      return
    }

    // Acceptance handshake — the desktop ACKs fast and runs the job async.
    const res = await fetch(BRIDGE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        tool: 'desktop.job.start',
        args: {
          jobId,
          language: payload.language,
          source: payload.source,
          packages: payload.packages,
          args: payload.args,
          timeoutMs: job.timeoutMs,
        },
        timeoutMs: 30_000,
      }),
    }).catch((e) => ({ ok: false, json: async () => ({ ok: false, error: (e as Error).message }) }) as Response)

    const data = (await res.json().catch(() => ({ ok: false, error: 'bad bridge response' }))) as {
      ok: boolean
      error?: string
    }
    if (!data.ok) {
      await db.job.update({
        where: { id: jobId },
        data: { status: 'failed', error: `desktop rejected job: ${data.error ?? 'unknown'}`, claimedBy: null, leaseUntil: null, finishedAt: new Date() },
      })
      return
    }

    // Accepted — the desktop drives it now. desktop:job_update pushes (handled
    // in the bridge) move the row to running/completed/failed. We only mark it
    // accepted and release the worker lease.
    await db.job.updateMany({
      where: { id: jobId, claimedBy: workerId },
      data: { status: 'accepted', desktopSessionId: sessionId, startedAt: new Date(), claimedBy: null, leaseUntil: null },
    })
  },

  async cancel(jobId) {
    const job = await db.job.findUnique({ where: { id: jobId }, select: { desktopSessionId: true } })
    if (!job?.desktopSessionId) return
    await fetch(BRIDGE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: job.desktopSessionId, tool: 'desktop.job.cancel', args: { jobId }, timeoutMs: 15_000 }),
    }).catch(() => {})
  },
}
