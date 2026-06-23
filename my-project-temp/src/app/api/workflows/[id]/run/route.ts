import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth-helpers'
import { executeRun, parseSteps } from '@/lib/runtime'
import { broadcastRun } from '@/lib/relay-client'

interface RouteCtx {
  params: Promise<{ id: string }>
}

interface RunBody {
  trigger?: 'manual' | 'schedule'
}

// POST /api/workflows/[id]/run — kick off a workflow run.
//
// Creates the Run + RunStep rows, broadcasts `run:started`, then fires off
// `executeRun(...)` WITHOUT awaiting it. The HTTP response returns `{ runId }`
// immediately so the frontend can subscribe to the socket room and watch.
export async function POST(req: Request, { params }: RouteCtx) {
  try {
    const user = await getCurrentUser(req)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const { id } = await params
    let body: RunBody = {}
    try {
      body = (await req.json()) as RunBody
    } catch {
      // Body is optional — default to manual trigger.
    }
    const trigger = body.trigger === 'schedule' ? 'schedule' : 'manual'

    const workflow = await db.workflow.findUnique({ where: { id } })
    if (!workflow || workflow.userId !== user.id) {
      return NextResponse.json(
        { error: 'Workflow not found' },
        { status: 404 },
      )
    }
    const steps = parseSteps(workflow.stepsJson)
    if (steps.length === 0) {
      return NextResponse.json(
        { error: 'Workflow has no steps to run' },
        { status: 400 },
      )
    }

    // Create the Run record.
    const run = await db.run.create({
      data: {
        workflowId: id,
        status: 'running',
        trigger,
        startedAt: new Date(),
      },
    })

    // Create RunStep rows (one per workflow step), in order.
    await db.runStep.createMany({
      data: steps.map((s, i) => ({
        runId: run.id,
        stepId: s.id,
        kind: s.kind,
        label: s.label,
        status: 'pending',
        order: i,
      })),
    })

    // Make sure the relay is warm — pre-broadcast a no-op so the socket
    // connects before the first real event.
    broadcastRun(run.id, 'run:started', { runId: run.id, workflowId: id })

    // Fire and forget — the runtime streams progress over the relay.
    void executeRun(run.id, workflow, steps, trigger).catch((err) => {
      console.error('[api/workflows/[id]/run] executeRun crashed:', err)
    })

    return NextResponse.json({ runId: run.id })
  } catch (err) {
    console.error('[api/workflows/[id]/run] failed:', err)
    return NextResponse.json(
      { error: 'Failed to start run' },
      { status: 500 },
    )
  }
}
