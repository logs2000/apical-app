/**
 * Desktop bridge CLIENT — runs inside the bundled Next.js server on the user's
 * machine (DESKTOP_LOCAL=true). It is the missing half of the desktop bridge:
 * it connects OUT to the cloud desktop-bridge relay (mini-services/desktop-
 * bridge, port 3005), authenticates with the desktop's `dsk_` session token,
 * and services `desktop:invoke` requests by running tools locally.
 *
 * This dispatcher is the single chokepoint for ALL cloud-originated desktop
 * access. Every invoke is evaluated against the remote-access policy
 * (desktop-policy.ts) BEFORE it touches the machine — default-deny.
 *
 * Intentionally NO Prisma access: the packaged desktop's local DB is
 * unreliable. Everything needed comes from the cloud-link file + settings.
 */

import type { Socket } from 'socket.io-client'
import { invokeLocalDesktopTool } from '@/lib/platform/desktop-local-runtime'
import { currentRemoteCapabilities, evaluateRemoteInvoke } from './desktop-policy'
import type { CloudLink } from './desktop-paths'

export type BridgeStatus =
  | 'disconnected'
  | 'connecting'
  | 'authenticating'
  | 'online'
  | 'error'

interface BridgeState {
  socket: Socket | null
  status: BridgeStatus
  cloudUrl: string | null
  sessionId: string | null
  lastError: string | null
  lastConnectedAt: number | null
}

// Module-level singleton so the client survives across requests in the same
// Node process.
const state: BridgeState = {
  socket: null,
  status: 'disconnected',
  cloudUrl: null,
  sessionId: null,
  lastError: null,
  lastConnectedAt: null,
}

// Throttle blocked-invoke notifications: at most one per capability per hour.
const blockedNotifyAt = new Map<string, number>()
const BLOCKED_NOTIFY_INTERVAL_MS = 60 * 60 * 1000

function log(msg: string) {
  console.log(`[bridge-client] ${msg}`)
}

/** Human label for a denied capability, for the blocked-invoke notification. */
function deniedActionLabel(error: string): string {
  if (error.includes('cli')) return 'run a command'
  if (error.includes('fs')) return 'access files'
  if (error.includes('net')) return 'make a network request'
  if (error.includes('secrets')) return 'read a secret'
  if (error.includes('local_only')) return 'connect remotely'
  return 'access this computer'
}

async function maybeNotifyBlocked(error: string) {
  const cap = error.split(':')[1] ?? 'unknown'
  const now = Date.now()
  const last = blockedNotifyAt.get(cap) ?? 0
  if (now - last < BLOCKED_NOTIFY_INTERVAL_MS) return
  blockedNotifyAt.set(cap, now)
  const platform = process.platform === 'darwin' ? 'Mac' : 'computer'
  // Reuse the local notify path (this is a local action, not a remote one).
  void invokeLocalDesktopTool(
    'desktop.notify',
    {
      title: 'Apical blocked a remote action',
      body: `Apical Cloud tried to ${deniedActionLabel(error)} on this ${platform} — blocked by your Remote Access settings.`,
    },
    5000,
  ).catch(() => {})
}

interface InvokePayload {
  correlationId?: string
  tool?: string
  args?: Record<string, unknown>
  timeoutMs?: number
}

function attachHandlers(socket: Socket, link: CloudLink) {
  socket.on('connect', () => {
    log(`connected to relay (${link.cloudUrl})`)
    state.status = 'authenticating'
  })

  // The relay challenges us immediately on connect.
  socket.on('desktop:whoareyou', () => {
    state.status = 'authenticating'
    socket.emit('desktop:auth', {
      sessionToken: link.sessionToken,
      capabilities: currentRemoteCapabilities(),
    })
  })

  socket.on('desktop:authed', (payload: { sessionId?: string; label?: string }) => {
    state.status = 'online'
    state.sessionId = payload?.sessionId ?? null
    state.lastConnectedAt = Date.now()
    state.lastError = null
    log(`authenticated as desktop ${state.sessionId ?? '?'}`)
  })

  socket.on('desktop:auth_error', (payload: { error?: string }) => {
    state.status = 'error'
    state.lastError = payload?.error ?? 'auth_error'
    log(`auth error: ${state.lastError}`)
    // A bad/expired token won't fix itself by reconnecting — stop trying.
    socket.disconnect()
  })

  socket.on('desktop:kicked', (payload: { reason?: string }) => {
    log(`kicked by relay: ${payload?.reason ?? 'unknown'}`)
  })

  // The core: service a tool invocation from the cloud.
  socket.on('desktop:invoke', async (payload: InvokePayload) => {
    const correlationId = payload?.correlationId
    if (!correlationId || typeof correlationId !== 'string') return
    const tool = typeof payload.tool === 'string' ? payload.tool : ''
    const args =
      payload.args && typeof payload.args === 'object' ? payload.args : {}
    const timeoutMs =
      typeof payload.timeoutMs === 'number' && payload.timeoutMs > 0
        ? Math.min(payload.timeoutMs, 120_000)
        : 30_000

    // POLICY CHOKEPOINT: default-deny remote access.
    const decision = evaluateRemoteInvoke(tool, args)
    if (!decision.allowed) {
      void maybeNotifyBlocked(decision.error ?? 'remote_access_denied:unknown')
      socket.emit('desktop:result', {
        correlationId,
        error: decision.error ?? 'remote_access_denied',
      })
      return
    }

    try {
      const res = await invokeLocalDesktopTool(tool, args, timeoutMs)
      if (res.ok) {
        socket.emit('desktop:result', { correlationId, result: res.result })
      } else {
        socket.emit('desktop:result', { correlationId, error: res.error ?? 'tool_failed' })
      }
    } catch (err) {
      socket.emit('desktop:result', {
        correlationId,
        error: err instanceof Error ? err.message : 'invoke_failed',
      })
    }
  })

  // Long-running LOCAL job: the cloud accepts via this handshake, then the
  // desktop runs it detached and pushes desktop:job_update events (progress +
  // terminal) that the bridge writes to the Job row. Artifacts upload over the
  // authenticated HTTP session. This is how a desktop job outlives the 120s
  // bridge cap.
  socket.on('desktop:invoke', async (payload: InvokePayload) => {
    if (payload?.tool !== 'desktop.job.start') return // handled by the main invoke handler above
    const correlationId = payload.correlationId
    const args = (payload.args && typeof payload.args === 'object' ? payload.args : {}) as {
      jobId?: string
      language?: 'javascript' | 'python' | 'shell'
      source?: string
      packages?: string[]
      args?: string[]
      timeoutMs?: number
    }
    const decision = evaluateRemoteInvoke('desktop.cli.run', args)
    if (!decision.allowed) {
      socket.emit('desktop:result', { correlationId, error: decision.error ?? 'remote_access_denied' })
      return
    }
    if (!args.jobId || !args.source || !args.language) {
      socket.emit('desktop:result', { correlationId, error: 'job.start requires jobId, language, source' })
      return
    }
    // ACK the handshake immediately — the job runs async from here.
    socket.emit('desktop:result', { correlationId, result: { accepted: true } })
    void runLocalJob(socket, link, {
      jobId: args.jobId,
      language: args.language,
      source: args.source,
      packages: Array.isArray(args.packages) ? args.packages : [],
      args: Array.isArray(args.args) ? args.args : [],
      timeoutMs: typeof args.timeoutMs === 'number' ? args.timeoutMs : 30 * 60_000,
    })
  })

  socket.on('desktop:invoke', async (payload: InvokePayload) => {
    if (payload?.tool !== 'desktop.job.cancel') return
    const jobId = (payload.args as { jobId?: string })?.jobId
    if (jobId) cancelLocalJob(jobId)
    socket.emit('desktop:result', { correlationId: payload.correlationId, result: { ok: true } })
  })

  socket.on('disconnect', (reason: string) => {
    if (state.status !== 'error') state.status = 'disconnected'
    log(`disconnected: ${reason}`)
  })

  socket.on('connect_error', (err: Error) => {
    state.lastError = err.message
    log(`connect_error: ${err.message}`)
  })
}

// ---------------- Local job execution ----------------

const localJobHandles = new Map<string, { cancel(): void }>()

function cancelLocalJob(jobId: string): void {
  localJobHandles.get(jobId)?.cancel()
  localJobHandles.delete(jobId)
}

/** Push a job update to the cloud, retrying until the bridge acks (or the job
 *  is terminal and we've tried enough) — socket drops must not lose the result. */
function pushJobUpdate(
  socket: Socket,
  update: { jobId: string; status?: string; progress?: number; note?: string; error?: string; result?: unknown },
  terminal: boolean,
): void {
  let acked = false
  const onAck = (p: { jobId?: string }) => {
    if (p?.jobId === update.jobId) acked = true
  }
  socket.on('desktop:job_update_ack', onAck)
  let attempts = 0
  const send = () => {
    if (acked || attempts > (terminal ? 20 : 1)) {
      socket.off('desktop:job_update_ack', onAck)
      return
    }
    attempts++
    socket.emit('desktop:job_update', update)
    if (terminal) setTimeout(send, 3000)
    else socket.off('desktop:job_update_ack', onAck)
  }
  send()
}

async function runLocalJob(
  socket: Socket,
  link: CloudLink,
  job: { jobId: string; language: 'javascript' | 'python' | 'shell'; source: string; packages: string[]; args: string[]; timeoutMs: number },
): Promise<void> {
  const { startScriptJob, readJobProgress, jobScratchDir, cleanupJobDir } = await import('@/lib/platform/script-runner')
  const { readdir, readFile } = await import('fs/promises')
  const path = await import('path')

  pushJobUpdate(socket, { jobId: job.jobId, status: 'running', progress: 0 }, false)
  const handle = await startScriptJob({
    jobId: job.jobId,
    language: job.language,
    source: job.source,
    packages: job.packages,
    data: job.args.length ? JSON.stringify(job.args) : undefined,
    args: job.args,
    timeoutMs: job.timeoutMs,
  })
  localJobHandles.set(job.jobId, handle)

  const poll = setInterval(() => {
    void readJobProgress(job.jobId).then((p) => {
      if (p) pushJobUpdate(socket, { jobId: job.jobId, status: 'running', progress: p.progress, note: p.note }, false)
    })
  }, 5000)

  try {
    const result = await handle.done
    clearInterval(poll)
    localJobHandles.delete(job.jobId)

    // Upload artifacts over the authenticated HTTP session.
    try {
      const outDir = path.join(jobScratchDir(job.jobId), 'out')
      const names = await readdir(outDir).catch(() => [] as string[])
      if (names.length > 0) {
        const form = new FormData()
        for (const name of names) {
          const bytes = await readFile(path.join(outDir, name))
          form.append('files', new Blob([new Uint8Array(bytes)]), name)
        }
        await fetch(`${link.cloudUrl}/api/jobs/${job.jobId}/artifacts`, {
          method: 'POST',
          headers: { 'X-Desktop-Session': link.sessionToken },
          body: form,
        }).catch((e) => log(`artifact upload failed: ${(e as Error).message}`))
      }
    } catch (e) {
      log(`artifact stage failed: ${(e as Error).message}`)
    }

    const status = result.timedOut ? 'timeout' : result.ok ? 'completed' : 'failed'
    pushJobUpdate(
      socket,
      { jobId: job.jobId, status, progress: result.ok ? 1 : undefined, error: result.error, result: { stdoutTail: result.stdoutTail, exitCode: result.exitCode } },
      true,
    )
    await cleanupJobDir(job.jobId)
  } catch (e) {
    clearInterval(poll)
    localJobHandles.delete(job.jobId)
    pushJobUpdate(socket, { jobId: job.jobId, status: 'failed', error: (e as Error).message }, true)
  }
}

/**
 * Start (or restart) the bridge client with the given cloud link. Safe to call
 * repeatedly — it tears down any existing connection first.
 */
export async function startBridgeClient(link: CloudLink): Promise<void> {
  await stopBridgeClient()
  state.cloudUrl = link.cloudUrl
  state.status = 'connecting'
  state.lastError = null

  const { io } = await import('socket.io-client')
  // Connect out to the relay. The XTransformPort query tells the cloud gateway
  // (Caddy) to route this socket to the desktop-bridge service on port 3005.
  const socket = io(link.cloudUrl, {
    query: { XTransformPort: 3005 },
    path: '/socket.io/',
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 2000,
    reconnectionDelayMax: 30_000,
  })
  state.socket = socket
  attachHandlers(socket, link)
}

/** Stop the bridge client and disconnect. */
export async function stopBridgeClient(): Promise<void> {
  if (state.socket) {
    try {
      state.socket.removeAllListeners()
      state.socket.disconnect()
    } catch {
      /* ignore */
    }
  }
  state.socket = null
  state.status = 'disconnected'
  state.sessionId = null
}

/**
 * Re-advertise the current capabilities to the relay (called after the user
 * changes the remote-access policy). Re-emitting desktop:auth on the same
 * socket updates capabilitiesJson without kicking ourselves.
 */
export function refreshBridgeCapabilities(sessionToken: string): void {
  if (state.socket && state.status === 'online') {
    state.socket.emit('desktop:auth', {
      sessionToken,
      capabilities: currentRemoteCapabilities(),
    })
  }
}

export interface BridgeClientStatus {
  status: BridgeStatus
  cloudUrl: string | null
  sessionId: string | null
  lastError: string | null
  lastConnectedAt: number | null
}

export function getBridgeClientStatus(): BridgeClientStatus {
  return {
    status: state.status,
    cloudUrl: state.cloudUrl,
    sessionId: state.sessionId,
    lastError: state.lastError,
    lastConnectedAt: state.lastConnectedAt,
  }
}
