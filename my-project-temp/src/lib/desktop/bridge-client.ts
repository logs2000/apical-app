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

  socket.on('disconnect', (reason: string) => {
    if (state.status !== 'error') state.status = 'disconnected'
    log(`disconnected: ${reason}`)
  })

  socket.on('connect_error', (err: Error) => {
    state.lastError = err.message
    log(`connect_error: ${err.message}`)
  })
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
