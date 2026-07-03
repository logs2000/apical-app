import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth-helpers'
import { isSchedulerRequest } from '@/lib/scheduler-auth'
import { startWorkflowRun, StartRunError } from '@/lib/platform/start-run'

interface RouteCtx {
  params: Promise<{ id: string }>
}

interface RunBody {
  trigger?: 'manual' | 'schedule'
  /** Optional end-customer scope: credential resolution prefers credentials
   *  bound to this ConnectedAccount. Must belong to the caller's workspace. */
  connectedAccountId?: string
}

// POST /api/workflows/[id]/run — kick off a workflow run.
//
// Creates the Run + RunStep rows (pinned to the active revision), broadcasts
// `run:started`, then fires off `executeRun(...)` WITHOUT awaiting it. The
// HTTP response returns `{ runId }` immediately so the frontend can subscribe
// to the socket room and watch.
export async function POST(req: Request, { params }: RouteCtx) {
  try {
    // Two callers: a signed-in user (manual runs from the UI/API) or the
    // scheduler mini-service (X-Scheduler-Secret header; runs execute as the
    // workflow's owner). Scheduler auth fails closed when the env secret is
    // unset — see src/lib/scheduler-auth.ts.
    const fromScheduler = isSchedulerRequest(req)
    const user = fromScheduler ? null : await getCurrentUser(req)
    if (!fromScheduler && !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const { id } = await params
    let body: RunBody = {}
    try {
      body = (await req.json()) as RunBody
    } catch {
      // Body is optional — default to manual trigger.
    }
    const trigger =
      fromScheduler || body.trigger === 'schedule' ? 'schedule' : 'manual'

    const workflow = await db.workflow.findUnique({ where: { id } })
    if (!workflow || (!fromScheduler && workflow.userId !== user!.id)) {
      return NextResponse.json(
        { error: 'Workflow not found' },
        { status: 404 },
      )
    }

    try {
      const { runId } = await startWorkflowRun(workflow, {
        trigger,
        connectedAccountId: body.connectedAccountId?.trim() || null,
        actingUserId: user?.id ?? null,
      })
      return NextResponse.json({ runId })
    } catch (e) {
      if (e instanceof StartRunError) {
        return NextResponse.json({ error: e.message }, { status: e.status })
      }
      throw e
    }
  } catch (err) {
    console.error('[api/workflows/[id]/run] failed:', err)
    return NextResponse.json(
      { error: 'Failed to start run' },
      { status: 500 },
    )
  }
}
