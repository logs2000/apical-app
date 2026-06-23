import { createServer } from 'http'
import { Server } from 'socket.io'

// Apical run-relay — a generic, stateless real-time relay for workflow run events.
//
// Browser clients connect via Caddy using `io('/?XTransformPort=3003', ...)`.
// The Next.js runtime connects as an internal server-side client to
// `http://localhost:3003` and emits `relay` events to fan them out to rooms.
//
// This service does NO business logic, NO DB access — it is a pure relay.

const PORT = 3003

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
  console.log(`[relay] socket connected: ${socket.id}`)

  // Browser → server: join a run room.
  socket.on('run:subscribe', (payload: SubscribePayload) => {
    const runId = payload?.runId
    if (typeof runId !== 'string' || !runId) {
      debug(`[relay] ${socket.id} run:subscribe rejected — missing runId`)
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

  // Internal server-side client (Next.js runtime) → server: broadcast to a room.
  socket.on('relay', (payload: RelayPayload) => {
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
