import { NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { db } from '@/lib/db'
import { startWorkflowRun, StartRunError } from '@/lib/platform/start-run'

interface RouteCtx {
  params: Promise<{ id: string; secret: string }>
}

function secretsMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB)
}

// POST /v1/hooks/w/{id}/{secret} — inbound trigger URL. The URL secret IS the
// auth (like GitHub webhook URLs); no session or API key needed. The JSON
// body is exposed to workflow steps as {{trigger.*}}. Supports the
// Idempotency-Key header for at-most-once processing of retried deliveries.
export async function POST(req: Request, { params }: RouteCtx) {
  const { id, secret } = await params

  const workflow = await db.workflow.findUnique({ where: { id } })
  if (!workflow?.triggerSecret || !secretsMatch(workflow.triggerSecret, secret)) {
    // Same response for unknown workflow and bad secret — no oracle.
    return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  }
  if (workflow.status === 'paused') {
    return NextResponse.json({ error: 'Workflow is paused.' }, { status: 409 })
  }

  let payload: Record<string, unknown> = {}
  try {
    const raw = (await req.json()) as unknown
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      payload = raw as Record<string, unknown>
    } else if (raw !== undefined) {
      payload = { body: raw }
    }
  } catch {
    // Non-JSON or empty body is fine — trigger data is optional.
  }

  try {
    const { runId, deduplicated } = await startWorkflowRun(workflow, {
      trigger: 'hook',
      idempotencyKey: req.headers.get('Idempotency-Key'),
      triggerPayload: payload,
    })
    return NextResponse.json(
      { runId, status: 'running', deduplicated: deduplicated || undefined },
      { status: deduplicated ? 200 : 202 },
    )
  } catch (e) {
    if (e instanceof StartRunError) {
      return NextResponse.json({ error: e.message }, { status: e.status })
    }
    console.error('[v1/hooks] failed to start run:', e)
    return NextResponse.json({ error: 'Failed to start run.' }, { status: 500 })
  }
}
