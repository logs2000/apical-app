// Apical agent-worker — a standalone bun mini-service that executes durable
// agent runs (AgentRun rows) off the HTTP request lifecycle.
//
// Loop: every 5s, claim queued runs (and expired-lease runs from crashed
// workers — those RESUME from their checkpoint) up to the concurrency budget
// and execute them with the same engine the interactive chat uses. Events
// stream to the run-relay (room `run:agentrun:<id>`) and persist to
// AgentRunEvent rows; the final answer persists as an AgentMessage, so a
// closed laptop no longer loses the run.
//
// The heavy lifting lives in src/lib/platform/agent-run-worker.ts (imported
// directly — bun compiles the app's TS; `@/*` aliases resolve via this
// service's tsconfig.json).

import { randomBytes, timingSafeEqual } from 'crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'http'
import { agentRunWorkerTick } from '../../src/lib/platform/agent-run-worker'
import { jobWorkerTick } from '../../src/lib/platform/jobs'
import { createSession, closeSession, act, sessionCount, type ActParams } from './browser'

const PORT = Number(process.env.PORT || 3006)
const TICK_INTERVAL_MS = 5_000
const MAX_CONCURRENT = Math.max(1, Number(process.env.WORKER_MAX_CONCURRENT_RUNS || 4))
const MAX_JOBS = Math.max(1, Number(process.env.WORKER_MAX_CONCURRENT_JOBS || 2))
const WORKER_SECRET = (process.env.AGENT_WORKER_SECRET || '').trim()

if (!process.env.DATABASE_URL) {
  console.error('[agent-worker] DATABASE_URL is required')
  process.exit(1)
}

const workerId = `worker_${randomBytes(6).toString('hex')}`
const inFlight = new Map<string, Promise<void>>()
const jobsInFlight = new Map<string, Promise<void>>()

let ticking = false
async function tick(): Promise<void> {
  if (ticking) return
  ticking = true
  try {
    await agentRunWorkerTick(workerId, inFlight, MAX_CONCURRENT)
    await jobWorkerTick(workerId, jobsInFlight, MAX_JOBS)
  } catch (err) {
    console.error('[agent-worker] tick failed:', err)
  } finally {
    ticking = false
  }
}

function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      try {
        resolve(body ? (JSON.parse(body) as Record<string, unknown>) : {})
      } catch {
        resolve({})
      }
    })
    req.on('error', () => resolve({}))
  })
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

// HTTP surface: health + secret-guarded browser control (Caddy XTransformPort=3006).
const server = createServer((req, res) => {
  const url = req.url || ''
  if (url === '/health' || url === '/') {
    sendJson(res, 200, {
      ok: true,
      service: 'agent-worker',
      workerId,
      inFlight: inFlight.size,
      jobsInFlight: jobsInFlight.size,
      browserSessions: sessionCount(),
      maxConcurrent: MAX_CONCURRENT,
    })
    return
  }

  if (url.startsWith('/browser/')) {
    // All browser endpoints require the shared secret (the Next app presents
    // it). Constant-time compare — `!==` leaks a byte-position timing oracle.
    const presented = typeof req.headers['x-worker-secret'] === 'string' ? req.headers['x-worker-secret'] : ''
    const a = Buffer.from(presented)
    const b = Buffer.from(WORKER_SECRET)
    if (!WORKER_SECRET || a.length !== b.length || !timingSafeEqual(a, b)) {
      sendJson(res, 401, { error: 'unauthorized' })
      return
    }
    void handleBrowser(req, res, url)
    return
  }

  res.writeHead(404)
  res.end()
})

async function handleBrowser(req: IncomingMessage, res: ServerResponse, url: string): Promise<void> {
  try {
    // POST /browser/session  { userId }
    if (url === '/browser/session' && req.method === 'POST') {
      const body = await readJsonBody(req)
      const userId = String(body.userId || '')
      if (!userId) return sendJson(res, 400, { error: 'userId required' })
      const { sessionId } = await createSession(userId)
      return sendJson(res, 200, { sessionId })
    }
    // POST /browser/:id/act  { ...ActParams }
    const actMatch = url.match(/^\/browser\/([^/]+)\/act$/)
    if (actMatch && req.method === 'POST') {
      const body = (await readJsonBody(req)) as unknown as ActParams
      const result = await act(actMatch[1], body)
      return sendJson(res, 200, result)
    }
    // DELETE /browser/:id
    const delMatch = url.match(/^\/browser\/([^/]+)$/)
    if (delMatch && req.method === 'DELETE') {
      await closeSession(delMatch[1])
      return sendJson(res, 200, { ok: true })
    }
    sendJson(res, 404, { error: 'not found' })
  } catch (e) {
    sendJson(res, 500, { error: (e as Error).message })
  }
}

server.listen(PORT, () => {
  console.log(`[agent-worker] ${workerId} listening on :${PORT}, max ${MAX_CONCURRENT} concurrent runs`)
})

void tick()
setInterval(() => void tick(), TICK_INTERVAL_MS)

process.on('SIGTERM', () => {
  console.log('[agent-worker] SIGTERM — draining (leases expire, another worker resumes)')
  server.close()
  // In-flight runs keep checkpointing; exiting lets leases lapse so a
  // replacement worker resumes them. Give writes a moment to flush.
  setTimeout(() => process.exit(0), 2000)
})
