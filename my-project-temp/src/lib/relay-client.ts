// Apical — internal server-side client for the run-relay service.
//
// The Next.js runtime imports this file to broadcast run/step events through
// the relay (mini-services/run-relay on port 3003). The browser separately
// connects to the same relay via `io('/?XTransformPort=3003')`.
//
// This module is server-only — it must never be imported from a Client
// Component. The runtime (inside route handlers / server utilities) is the
// only consumer.

import { io, type Socket } from 'socket.io-client'

const RELAY_URL = 'http://localhost:3003'

type RelayGlobal = {
  __apicalRelay?: Socket
}

function getGlobal(): RelayGlobal {
  return globalThis as unknown as RelayGlobal
}

/**
 * Returns the lazily-initialized singleton socket connected to the run-relay.
 * Reuses the same connection across HMR cycles in dev. Reconnects on drop.
 */
export function getRelayClient(): Socket {
  const g = getGlobal()
  if (g.__apicalRelay && g.__apicalRelay.connected) {
    return g.__apicalRelay
  }
  if (g.__apicalRelay) {
    // Exists but disconnected — try to reconnect, then reuse.
    try {
      g.__apicalRelay.connect()
    } catch {
      // Ignore — emit() will queue or no-op; the next successful reconnect
      // resumes delivery.
    }
    return g.__apicalRelay
  }

  const sock = io(RELAY_URL, {
    path: '/',
    transports: ['websocket'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 500,
    reconnectionDelayMax: 5000,
    timeout: 4000,
    autoConnect: true,
  })

  sock.on('connect', () => {
    console.log('[apical-relay] connected to relay:', sock.id)
  })
  sock.on('disconnect', (reason) => {
    console.warn('[apical-relay] disconnected:', reason)
  })
  sock.on('connect_error', (err) => {
    console.warn('[apical-relay] connect_error:', err.message)
  })

  g.__apicalRelay = sock
  return sock
}

/**
 * Broadcast a run-lifecycle event to every browser subscribed to `run:<runId>`.
 * The relay service does `io.to(room).emit(event, data)` when we emit `relay`.
 */
export function broadcastRun(
  runId: string,
  event: string,
  data: unknown,
): void {
  try {
    const sock = getRelayClient()
    sock.emit('relay', {
      room: `run:${runId}`,
      event,
      data,
    })
  } catch (err) {
    // Never let a broadcast failure crash a run.
    console.error('[apical-relay] broadcast failed:', err)
  }
}
