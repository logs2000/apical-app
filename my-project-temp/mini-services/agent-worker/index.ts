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

import { randomBytes } from 'crypto'
import { createServer } from 'http'
import { agentRunWorkerTick } from '../../src/lib/platform/agent-run-worker'

const PORT = Number(process.env.PORT || 3006)
const TICK_INTERVAL_MS = 5_000
const MAX_CONCURRENT = Math.max(1, Number(process.env.WORKER_MAX_CONCURRENT_RUNS || 4))

if (!process.env.DATABASE_URL) {
  console.error('[agent-worker] DATABASE_URL is required')
  process.exit(1)
}

const workerId = `worker_${randomBytes(6).toString('hex')}`
const inFlight = new Map<string, Promise<void>>()

let ticking = false
async function tick(): Promise<void> {
  if (ticking) return
  ticking = true
  try {
    await agentRunWorkerTick(workerId, inFlight, MAX_CONCURRENT)
  } catch (err) {
    console.error('[agent-worker] tick failed:', err)
  } finally {
    ticking = false
  }
}

// Health endpoint (Caddy XTransformPort=3006).
const server = createServer((req, res) => {
  if (req.url === '/health' || req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(
      JSON.stringify({
        ok: true,
        service: 'agent-worker',
        workerId,
        inFlight: inFlight.size,
        maxConcurrent: MAX_CONCURRENT,
      }),
    )
    return
  }
  res.writeHead(404)
  res.end()
})

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
