// Apical desktop-bridge — MCP-style server that lets hosted agents access a
// connected desktop's filesystem, CLI, and network.
//
// The desktop app is BOTH an MCP client (calling Apical) AND an MCP server
// (serving `desktop.fs.*` / `desktop.cli.*` / `desktop.net.*` to hosted agents
// over a secure WebSocket tunnel).
//
// This mini-service is the relay:
//   - Desktop apps (Tauri) connect via socket.io, authenticate with a session
//     token, and join room `desktop:<sessionId>`.
//   - Hosted agents call HTTP `POST /invoke { sessionId, tool, args }` (proxied
//     by the Next.js API route /api/desktop/bridge/invoke). The service emits
//     `desktop:invoke { correlationId, tool, args }` to the desktop's room,
//     awaits the matching `desktop:result { correlationId, result?, error? }`,
//     and returns it (with a 30s default timeout).
//
// Same pattern as `mini-services/run-relay/` but with an HTTP handler on the
// httpServer for `/invoke`, `/tools`, `/` (health).

import { createServer, IncomingMessage, ServerResponse } from 'http'
import { Server, Socket } from 'socket.io'
import { PrismaClient } from '@prisma/client'
import { randomUUID, timingSafeEqual } from 'crypto'

// The desktop-bridge requires Postgres (same as the main app).
if (!process.env.DATABASE_URL?.trim()) {
  console.error(
    '[desktop-bridge] DATABASE_URL is not set. Point it at the same Postgres as the Next.js app.',
  )
  process.exit(1)
}

// POST /invoke is a remote-execution surface (fs/cli on someone's desktop).
// Only the Next.js proxy may call it — it must present APICAL_BRIDGE_SECRET.
// Fail closed: without the secret the service refuses to start, same contract
// as APICAL_RELAY_SECRET on the run-relay.
const BRIDGE_SECRET = (process.env.APICAL_BRIDGE_SECRET || '').trim()
if (!BRIDGE_SECRET) {
  console.error(
    '[desktop-bridge] APICAL_BRIDGE_SECRET is not set. Set the same random secret ' +
      'here and on the Next.js app, then restart. Exiting.',
  )
  process.exit(1)
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}

const db = new PrismaClient()
const PORT = 3005
const startedAt = Date.now()
const HEARTBEAT_INTERVAL_MS = 60_000

// ---------------- MCP tool catalog ----------------
//
// This is the public surface of the desktop bridge. The same list is served
// by `GET /tools` here AND by the Next.js route `GET /api/desktop/bridge/tools`
// (which is what agent builders actually hit). Keep them in sync.

export interface McpTool {
  name: string
  description: string
  args: Record<string, string>
  returns: Record<string, string>
}

const MCP_TOOLS: McpTool[] = [
  {
    name: 'desktop.fs.list',
    description: 'List entries in a directory on the connected desktop.',
    args: { path: 'string (absolute path)' },
    returns: { entries: 'array of { name, type, size }' },
  },
  {
    name: 'desktop.fs.read',
    description: 'Read a file. encoding defaults to utf8; use base64 for binaries.',
    args: { path: 'string', encoding: "'utf8' | 'base64' (optional)" },
    returns: { content: 'string' },
  },
  {
    name: 'desktop.fs.write',
    description: 'Write content to a file (overwrites). encoding defaults to utf8.',
    args: { path: 'string', content: 'string', encoding: "'utf8' | 'base64' (optional)" },
    returns: { ok: 'boolean', bytes: 'number' },
  },
  {
    name: 'desktop.fs.move',
    description: 'Move or rename a file/directory.',
    args: { from: 'string', to: 'string' },
    returns: { ok: 'boolean' },
  },
  {
    name: 'desktop.fs.watch',
    description: 'Start watching a path for changes. Subsequent change events are emitted separately.',
    args: { path: 'string' },
    returns: { ok: 'boolean' },
  },
  {
    name: 'desktop.cli.run',
    description: 'Run a CLI command on the desktop. Bounded by timeoutMs (default 30s).',
    args: { cmd: 'string', args: 'string[] (optional)', cwd: 'string (optional)', timeoutMs: 'number (optional)' },
    returns: { stdout: 'string', stderr: 'string', exitCode: 'number' },
  },
  {
    name: 'desktop.net.fetch',
    description: 'HTTP request from the desktop (reaches the user\'s local network).',
    args: { url: 'string', method: 'string (optional)', headers: 'object (optional)', body: 'any (optional)' },
    returns: { status: 'number', headers: 'object', body: 'string' },
  },
  {
    name: 'desktop.notify',
    description: 'Show a native OS notification on the desktop.',
    args: { title: 'string', body: 'string' },
    returns: { ok: 'boolean' },
  },
  {
    name: 'desktop.secrets.get',
    description: 'Read a value from the OS keychain (service = "apical").',
    args: { key: 'string' },
    returns: { value: 'string | null' },
  },
]

// ---------------- Pending invoke requests ----------------

interface PendingRequest {
  resolve: (result: unknown) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

const pending = new Map<string, PendingRequest>()

// ---------------- HTTP server ----------------

const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  // Health
  if (req.method === 'GET' && (req.url === '/' || req.url === '/health')) {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(
      JSON.stringify({
        status: 'ok',
        onlineDesktops: countOnlineDesktops(),
        uptime: Math.floor((Date.now() - startedAt) / 1000),
      }),
    )
    return
  }

  // Tool catalog
  if (req.method === 'GET' && req.url === '/tools') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ tools: MCP_TOOLS }))
    return
  }

  // Invoke a tool on a connected desktop.
  if (req.method === 'POST' && req.url === '/invoke') {
    // Only the Next.js proxy holds the bridge secret. Timing-safe compare;
    // missing or wrong → 401 before reading the body.
    const presented = typeof req.headers['x-bridge-secret'] === 'string' ? req.headers['x-bridge-secret'] : ''
    if (!presented || !safeEqual(presented, BRIDGE_SECRET)) {
      res.writeHead(401, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: 'unauthorized' }))
      return
    }
    try {
      const body = await readJson(req)
      const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : ''
      const tool = typeof body?.tool === 'string' ? body.tool : ''
      const args = body?.args && typeof body.args === 'object' ? body.args : {}
      const timeoutMs = typeof body?.timeoutMs === 'number' && body.timeoutMs > 0
        ? Math.min(body.timeoutMs, 120_000)
        : 30_000

      if (!sessionId || !tool) {
        res.writeHead(400, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: 'sessionId and tool are required' }))
        return
      }

      // Confirm the session exists in the DB.
      const session = await db.desktopSession.findUnique({ where: { id: sessionId } })
      if (!session) {
        res.writeHead(404, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: 'session_not_found' }))
        return
      }

      // Make sure a desktop is actually connected to the room.
      const room = `desktop:${sessionId}`
      const socketsInRoom = await io.in(room).fetchSockets()
      if (socketsInRoom.length === 0) {
        res.writeHead(503, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: 'desktop_offline' }))
        return
      }

      // Validate tool name against the catalog (defense in depth).
      if (!MCP_TOOLS.some((t) => t.name === tool)) {
        res.writeHead(400, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: `unknown_tool: ${tool}` }))
        return
      }

      // Emit and await the result.
      const correlationId = randomUUID()
      const result = await new Promise<{ ok: boolean; result?: unknown; error?: string }>(
        (resolve) => {
          const timer = setTimeout(() => {
            pending.delete(correlationId)
            resolve({ ok: false, error: 'timeout' })
          }, timeoutMs)

          pending.set(correlationId, {
            resolve: (v) => {
              clearTimeout(timer)
              pending.delete(correlationId)
              resolve({ ok: true, result: v })
            },
            reject: (err) => {
              clearTimeout(timer)
              pending.delete(correlationId)
              resolve({ ok: false, error: err.message || 'invoke_failed' })
            },
            timer,
          })

          io.to(room).emit('desktop:invoke', { correlationId, tool, args })
        },
      )

      // 504 on timeout, otherwise 200 (the body's `ok` flag tells the caller).
      const status = result.error === 'timeout' ? 504 : 200
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(result))
    } catch (err) {
      console.error('[desktop-bridge] /invoke failed:', err)
      res.writeHead(500, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: 'internal_error' }))
    }
    return
  }

  // 404 for anything else.
  res.writeHead(404, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ error: 'not_found' }))
})

// ---------------- Socket.io ----------------

// Socket.io is mounted at the default path `/socket.io/` so the HTTP routes
// (`GET /`, `GET /tools`, `POST /invoke`) on the same httpServer still work.
// (With `path: '/'` engine.io would intercept every URL starting with `/` —
// including `/tools` and `/invoke` — and return "Transport unknown" for the
// non-socket.io requests. The browser client uses `io('/?XTransformPort=3005')`
// — Caddy forwards based on the query param, the path is irrelevant to the
// gateway, and socket.io-client's default `path` option is `/socket.io/` so
// the request URLs line up.)
// CORS: the legitimate socket clients are the Tauri desktop app (webview
// origins below; the Node-side socket.io-client sends no Origin header, which
// passes an origin-list check) and, in dev, the web app itself. Production
// deployments append their public origin via APICAL_BRIDGE_CORS_ORIGINS
// (comma-separated). Never '*' — /invoke aside, an open origin would let any
// website drive the socket surface from a logged-in browser.
const BRIDGE_CORS_ORIGINS = [
  'tauri://localhost',
  'http://tauri.localhost',
  'https://tauri.localhost',
  'http://localhost:3000',
  ...(process.env.APICAL_BRIDGE_CORS_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
]

const io = new Server(httpServer, {
  cors: {
    origin: BRIDGE_CORS_ORIGINS,
    methods: ['GET', 'POST'],
  },
  pingTimeout: 60000,
  pingInterval: 25000,
})

interface DesktopAuthPayload {
  sessionToken?: string
  capabilities?: string[]
}

interface DesktopResultPayload {
  correlationId?: string
  result?: unknown
  error?: string
}

io.on('connection', (socket: Socket) => {
  console.log(`[desktop-bridge] socket connected: ${socket.id}`)

  // Challenge the desktop immediately.
  socket.emit('desktop:whoareyou')

  // Desktop → server: present a session token.
  socket.on('desktop:auth', async (payload: DesktopAuthPayload) => {
    const token = payload?.sessionToken
    if (typeof token !== 'string' || !token) {
      console.warn(`[desktop-bridge] ${socket.id} desktop:auth missing token`)
      socket.emit('desktop:auth_error', { error: 'missing_token' })
      socket.disconnect(true)
      return
    }

    try {
      const session = await db.desktopSession.findUnique({ where: { sessionToken: token } })
      if (!session) {
        console.warn(`[desktop-bridge] ${socket.id} desktop:auth invalid token`)
        socket.emit('desktop:auth_error', { error: 'invalid_token' })
        socket.disconnect(true)
        return
      }

      // Kick any existing socket for the same session (one desktop per session).
      const existing = await io.in(`desktop:${session.id}`).fetchSockets()
      for (const s of existing) {
        if (s.id !== socket.id) {
          s.emit('desktop:kicked', { reason: 'replaced' })
          s.disconnect(true)
        }
      }

      socket.data = { sessionId: session.id, userId: session.userId }
      socket.join(`desktop:${session.id}`)
      const caps =
        Array.isArray(payload?.capabilities) && payload.capabilities.every((c) => typeof c === 'string')
          ? payload.capabilities
          : []
      await db.desktopSession.update({
        where: { id: session.id },
        data: {
          status: 'online',
          lastSeenAt: new Date(),
          capabilitiesJson: JSON.stringify(caps),
        },
      })
      console.log(`[desktop-bridge] ${socket.id} authed as desktop ${session.id} (${session.label})`)
      socket.emit('desktop:authed', { sessionId: session.id, label: session.label })
    } catch (err) {
      console.error('[desktop-bridge] desktop:auth DB error:', err)
      socket.emit('desktop:auth_error', { error: 'internal_error' })
      socket.disconnect(true)
    }
  })

  // Desktop → server: result of a previous desktop:invoke.
  socket.on('desktop:result', (payload: DesktopResultPayload) => {
    const correlationId = payload?.correlationId
    if (typeof correlationId !== 'string' || !correlationId) return
    const entry = pending.get(correlationId)
    if (!entry) {
      // Late or duplicate result — ignore.
      return
    }
    if (typeof payload.error === 'string' && payload.error) {
      entry.reject(new Error(payload.error))
    } else {
      entry.resolve(payload.result)
    }
  })

  // Desktop → server: UNSOLICITED job progress/completion push. Long-running
  // desktop jobs (accepted via desktop.job.start) report back here, outside
  // the request/response invoke cycle. Validated against the socket's session
  // (a desktop can only update jobs it owns) and written straight to the row.
  socket.on('desktop:job_update', async (payload: {
    jobId?: string
    status?: string
    progress?: number
    note?: string
    error?: string
    result?: { stdoutTail?: string; exitCode?: number | null }
  }) => {
    try {
      const sessionId = socket.data?.sessionId as string | undefined
      const userId = socket.data?.userId as string | undefined
      const jobId = payload?.jobId
      if (!sessionId || !userId || typeof jobId !== 'string' || !jobId) return
      const job = await db.job.findFirst({
        where: { id: jobId, userId, desktopSessionId: sessionId },
        select: { id: true, status: true },
      })
      if (!job) return
      if (['completed', 'failed', 'cancelled', 'timeout'].includes(job.status)) return // already terminal

      // Validate against the states a desktop may legitimately report — the
      // raw string went straight into the row before, so a compromised desktop
      // could write garbage or roll a job back to 'queued' for a re-run.
      const DESKTOP_REPORTABLE = ['accepted', 'running', 'completed', 'failed', 'timeout', 'cancelled']
      const status = payload.status
      if (status !== undefined && !DESKTOP_REPORTABLE.includes(status)) {
        console.warn(`[desktop-bridge] job_update with invalid status "${String(status)}" ignored (job ${jobId})`)
        return
      }
      const terminal = status && ['completed', 'failed', 'timeout', 'cancelled'].includes(status)
      await db.job.update({
        where: { id: jobId },
        data: {
          ...(status ? { status } : { status: 'running' }),
          ...(typeof payload.progress === 'number' ? { progress: Math.max(0, Math.min(1, payload.progress)) } : {}),
          ...(payload.note ? { progressNote: payload.note.slice(0, 500) } : {}),
          ...(payload.error ? { error: payload.error.slice(0, 1000) } : {}),
          ...(payload.result ? { resultJson: JSON.stringify(payload.result) } : {}),
          ...(terminal ? { finishedAt: new Date() } : {}),
        },
      })
      // Ack so the desktop can stop retrying this update.
      socket.emit('desktop:job_update_ack', { jobId, status: status ?? 'running' })
    } catch (err) {
      console.error('[desktop-bridge] desktop:job_update failed:', err)
    }
  })

  socket.on('disconnect', async (reason) => {
    console.log(`[desktop-bridge] socket disconnected: ${socket.id} (${reason})`)
    const sessionId = socket.data?.sessionId as string | undefined
    if (sessionId) {
      try {
        // Only mark offline if no other socket is still in the room
        // (defensive — the replacement flow already kicked the old socket).
        const remaining = await io.in(`desktop:${sessionId}`).fetchSockets()
        if (remaining.length === 0) {
          await db.desktopSession.update({
            where: { id: sessionId },
            data: { status: 'offline', lastSeenAt: new Date() },
          })
        }
      } catch (err) {
        console.error('[desktop-bridge] disconnect DB update failed:', err)
      }
    }
  })

  socket.on('error', (err: unknown) => {
    console.error(`[desktop-bridge] socket error (${socket.id}):`, err)
  })
})

// ---------------- helpers ----------------

function countOnlineDesktops(): number {
  // io.sockets.adapter.rooms has all rooms. Count desktop:* rooms.
  let n = 0
  for (const room of io.sockets.adapter.rooms.keys()) {
    if (room.startsWith('desktop:')) n++
  }
  return n
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8')
        resolve(raw ? JSON.parse(raw) : {})
      } catch (err) {
        reject(err)
      }
    })
    req.on('error', reject)
  })
}

// ---------------- listen + shutdown ----------------

/** Mark stale sessions offline when no socket is in their room (relay crash recovery). */
async function sweepStaleSessions() {
  try {
    const online = await db.desktopSession.findMany({
      where: { status: 'online' },
      select: { id: true },
    })
    for (const session of online) {
      const room = `desktop:${session.id}`
      const socketsInRoom = await io.in(room).fetchSockets()
      if (socketsInRoom.length === 0) {
        await db.desktopSession.update({
          where: { id: session.id },
          data: { status: 'offline', lastSeenAt: new Date() },
        })
      }
    }
  } catch (err) {
    console.error('[desktop-bridge] stale session sweep failed:', err)
  }
}

/** Heartbeat: refresh lastSeenAt for connected desktop sessions. */
async function heartbeatTick() {
  try {
    for (const room of io.sockets.adapter.rooms.keys()) {
      if (!room.startsWith('desktop:')) continue
      const sessionId = room.slice('desktop:'.length)
      const socketsInRoom = await io.in(room).fetchSockets()
      if (socketsInRoom.length === 0) continue
      await db.desktopSession.update({
        where: { id: sessionId },
        data: { lastSeenAt: new Date(), status: 'online' },
      })
    }
  } catch (err) {
    console.error('[desktop-bridge] heartbeat failed:', err)
  }
}

httpServer.listen(PORT, () => {
  console.log(`Apical desktop-bridge listening on port ${PORT}`)
  void sweepStaleSessions()
  setInterval(() => void heartbeatTick(), HEARTBEAT_INTERVAL_MS)
})

const shutdown = (signal: string) => {
  console.log(`[desktop-bridge] received ${signal}, shutting down...`)
  // Reject all pending invokes so callers don't hang.
  for (const [id, entry] of pending) {
    clearTimeout(entry.timer)
    entry.reject(new Error('server_shutdown'))
    pending.delete(id)
  }
  io.close(() => {
    httpServer.close(() => {
      void db.$disconnect().finally(() => {
        console.log('[desktop-bridge] http server closed')
        process.exit(0)
      })
    })
  })
  // Force exit after a short grace period if something hangs.
  setTimeout(() => {
    console.error('[desktop-bridge] forced exit after shutdown timeout')
    process.exit(1)
  }, 5000).unref()
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
