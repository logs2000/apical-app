import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withAuth } from '@/lib/with-auth'
import {
  startWorkflowRun,
  waitForRun,
  StartRunError,
} from '@/lib/platform/start-run'
import { findScopedWorkflow, mapRunV1 } from '@/lib/v1/mappers'
import { checkRunSpend, chargeRunCost } from '@/lib/platform/run-billing'
import { deriveKeySource } from '@/lib/api-key-auth'

interface RunBody {
  /** Optional end-customer scope for credential resolution. */
  connectedAccountId?: string
  /** Idempotency key — retried POSTs with the same key return the same run. */
  idempotencyKey?: string
}

// POST /v1/workflows/{id}/run — trigger a run. Returns { runId } immediately;
// poll GET /v1/runs/{runId} for status. With ?wait=true the response blocks
// until the run finishes (up to 60s) and returns the full run object.
export const POST = withAuth(
  async (req, ctx) => {
    const workflow = await findScopedWorkflow(ctx.params.id, ctx)
    if (!workflow) {
      return NextResponse.json({ error: 'Workflow not found.' }, { status: 404 })
    }
    const body = (await req.json().catch(() => ({}))) as RunBody
    const url = new URL(req.url)
    const wait = url.searchParams.get('wait') === 'true'
    const idempotencyKey =
      typeof body.idempotencyKey === 'string'
        ? body.idempotencyKey
        : req.headers.get('Idempotency-Key')

    // API-key-driven runs are billed: enforce balance + per-key spend limit.
    const spend = checkRunSpend(ctx.workspace, ctx.apiKey)
    if (!spend.ok) {
      return NextResponse.json({ error: spend.error }, { status: 402 })
    }

    try {
      const { runId, deduplicated } = await startWorkflowRun(workflow, {
        trigger: 'manual',
        connectedAccountId:
          typeof body.connectedAccountId === 'string'
            ? body.connectedAccountId.trim() || null
            : null,
        actingUserId: ctx.user?.id ?? null,
        idempotencyKey,
      })

      if (!deduplicated) {
        await chargeRunCost({
          workspace: ctx.workspace,
          apiKey: ctx.apiKey,
          runId,
          workflowName: workflow.name,
          source: deriveKeySource(req),
        })
      }

      if (!wait) {
        return NextResponse.json(
          { runId, status: 'running', deduplicated: deduplicated || undefined },
          { status: deduplicated ? 200 : 202 },
        )
      }

      const { timedOut } = await waitForRun(runId)
      const row = await db.run.findUnique({
        where: { id: runId },
        include: { steps: true },
      })
      return NextResponse.json(
        {
          runId,
          timedOut: timedOut || undefined,
          deduplicated: deduplicated || undefined,
          run: row ? mapRunV1(row, { includeSteps: true }) : null,
        },
        { status: timedOut ? 202 : 200 },
      )
    } catch (e) {
      if (e instanceof StartRunError) {
        return NextResponse.json({ error: e.message }, { status: e.status })
      }
      throw e
    }
  },
  { scope: 'runs:execute' },
)
