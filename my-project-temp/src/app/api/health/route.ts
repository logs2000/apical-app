// GET /api/health — liveness + readiness for load balancers, container
// orchestration, and uptime monitors.
//
// Public and unauthenticated (probes carry no credentials). It therefore
// reports only booleans and an overall status — never secret values, never the
// names of missing env vars. Detailed config lives in the boot log (assertEnv),
// not on this endpoint.
//
//   status: 'ok'       — DB reachable and all hard-required config present
//           'degraded' — DB reachable but config incomplete (up, not fully ready)
//           'down'     — DB unreachable (the one dependency the app can't run without)
//
// HTTP 200 while the process can serve (ok/degraded), 503 when the DB is down,
// so an orchestrator pulls a broken instance from rotation.

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { checkEnv } from '@/lib/env'

// A health probe must never be cached and must run in Node (it touches Postgres).
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  const startedAt = Date.now()

  // Postgres reachability — the app cannot function without it.
  let database = false
  try {
    await db.$queryRaw`SELECT 1`
    database = true
  } catch {
    database = false
  }

  const env = checkEnv()
  const status = !database ? 'down' : env.ok ? 'ok' : 'degraded'

  return NextResponse.json(
    {
      status,
      checks: {
        // The app's hard dependency + whether hard-required config is present.
        database,
        config: env.ok,
      },
      uptimeSeconds: Math.round(process.uptime()),
      tookMs: Date.now() - startedAt,
    },
    {
      status: database ? 200 : 503,
      headers: { 'Cache-Control': 'no-store' },
    },
  )
}
