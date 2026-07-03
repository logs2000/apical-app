import { createHmac, timingSafeEqual } from 'crypto'
import { createServer } from 'http'
import { Server } from 'socket.io'

// Apical run-relay — a generic, stateless real-time relay for workflow run events.
//
// Browser clients connect via Caddy using `io('/?XTransformPort=3003', ...)`.
// The Next.js runtime connects as an internal server-side client to
// `http://localhost:3003` and emits `relay` events to fan them out to rooms.
//
// This service does NO business logic, NO DB access — it is a pure relay.
//
// SECURITY MODEL:
//   - Browsers must present a short-lived HMAC token (minted by the authed
//     Next.js route POST /api/runs/[id]/relay-token) to join a run room.
//   - Publishers (the Next.js server) must present APICAL_RELAY_SECRET in the
//     socket handshake (`auth.publisherSecret`) to emit `relay` events.
//   - Both are signed/checked with APICAL_RELAY_SECRET, which is REQUIRED —
//     the service exits at boot when it's unset (fail closed).

const PORT = 3003

const RELAY_SECRET = (process.env.APICAL_RELAY_SECRET || '').trim()
if (!RELAY_SECRET) {
  console.error(
    '[relay] APICAL_RELAY_SECRET is not set. Set the same random secret here ' +
      'and on the Next.js app, then restart. Exiting.',
  )
  process.exit(1)
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}

/**
 * Verify a room token minted by src/lib/relay-token.ts.
 * Format: base64url(`${runId}.${expiresAtMs}`) + '.' + hex(hmac-sha256).
 * Returns the runId when valid + unexpired, else null.
 */
function verifyRunToken(token: string): string | null {
  if (typeof token !== 'string' || !token) return null
  const dot = token.lastIndexOf('.')
  if (dot <= 0) return null
  const encoded = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  let payload: string
  try {
    payload = Buffer.from(encoded, 'base64url').toString('utf8')
  } catch {
    return null
  }
  const expected = createHmac('sha256', RELAY_SECRET).update(payload).digest('hex')
  if (!safeEqual(sig, expected)) return null
  const sep = payload.lastIndexOf('.')
  if (sep <= 0) return null
  const runId = payload.slice(0, sep)
  const expiresAt = Number(payload.slice(sep + 1))
  if (!runId || !Number.isFinite(expiresAt) || Date.now() > expiresAt) return null
  return runId
}

const httpServer = createServer()
const io = new Server(httpServer, {
  // DO NOT change the path — Caddy uses it to forward to this port.
  path: '/',
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
  pingTimeout: 60000,
  pingInterval: 25000,
})

interface SubscribePayload {
  runId: string
  token?: string
}

interface RelayPayload {
  room: string
  event: string
  data?: unknown
}

const DEBUG = process.env.RELAY_DEBUG === '1'
const debug = (...args: unknown[]) => {
  if (DEBUG) console.log('[debug]', ...args)
}

io.on('connection', (socket) => {
  // Publisher handshake: the Next.js server presents the shared secret in
  // socket.handshake.auth. Browsers never have it — they get room tokens.
  const handshakeAuth = (socket.handshake.auth ?? {}) as Record<string, unknown>
  const isPublisher =
    typeof handshakeAuth.publisherSecret === 'string' &&
    safeEqual(handshakeAuth.publisherSecret, RELAY_SECRET)

  console.log(
    `[relay] socket connected: ${socket.id}${isPublisher ? ' (publisher)' : ''}`,
  )

  // Browser → server: join a run room. Requires a valid signed room token.
  socket.on('run:subscribe', (payload: SubscribePayload) => {
    const runId = payload?.runId
    if (typeof runId !== 'string' || !runId) {
      debug(`[relay] ${socket.id} run:subscribe rejected — missing runId`)
      return
    }
    const tokenRunId = verifyRunToken(payload?.token ?? '')
    if (tokenRunId !== runId) {
      console.warn(
        `[relay] ${socket.id} run:subscribe rejected — invalid token for run ${runId}`,
      )
      socket.emit('run:subscribe:error', { runId, error: 'invalid_token' })
      return
    }
    const room = `run:${runId}`
    socket.join(room)
    console.log(`[relay] ${socket.id} joined room ${room}`)
  })

  // Browser → server: leave a run room.
  socket.on('run:unsubscribe', (payload: SubscribePayload) => {
    const runId = payload?.runId
    if (typeof runId !== 'string' || !runId) {
      return
    }
    const room = `run:${runId}`
    socket.leave(room)
    debug(`[relay] ${socket.id} left room ${room}`)
  })

  // Internal server-side client (Next.js runtime) → server: broadcast to a
  // room. Publisher-authenticated sockets only.
  socket.on('relay', (payload: RelayPayload) => {
    if (!isPublisher) {
      console.warn(`[relay] ${socket.id} relay rejected — not a publisher`)
      return
    }
    if (!payload || typeof payload.room !== 'string' || typeof payload.event !== 'string') {
      debug(`[relay] ${socket.id} relay rejected — malformed payload`)
      return
    }
    const { room, event, data } = payload
    debug(`[relay] ${socket.id} → room=${room} event=${event}`)
    io.to(room).emit(event, data)
  })

  socket.on('disconnect', (reason) => {
    console.log(`[relay] socket disconnected: ${socket.id} (${reason})`)
  })

  socket.on('error', (err) => {
    console.error(`[relay] socket error (${socket.id}):`, err)
  })
})

httpServer.listen(PORT, () => {
  console.log(`Apical run-relay listening on port ${PORT}`)
})

// Graceful shutdown
const shutdown = (signal: string) => {
  console.log(`[relay] received ${signal}, shutting down...`)
  // Stop accepting new connections and close existing ones.
  io.close(() => {
    httpServer.close(() => {
      console.log('[relay] http server closed')
      process.exit(0)
    })
  })
  // Force exit after a short grace period if something hangs.
  setTimeout(() => {
    console.error('[relay] forced exit after shutdown timeout')
    process.exit(1)
  }, 5000).unref()
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
