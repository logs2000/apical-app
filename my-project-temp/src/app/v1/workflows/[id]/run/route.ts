import { z } from 'zod'
import { db } from '@/lib/db'
import { withAuth } from '@/lib/with-auth'
import { ok, apiError, ApiError } from '@/lib/api/respond'
import { codeForStatus } from '@/lib/api/errors'
import { parseBody } from '@/lib/api/validate'
import { startWorkflowRun, waitForRun, StartRunError } from '@/lib/platform/start-run'
import { findScopedWorkflow, mapRunV1 } from '@/lib/v1/mappers'
import { checkRunSpend, chargeRunCost } from '@/lib/platform/run-billing'
import { deriveKeySource } from '@/lib/api-key-auth'

const RunSchema = z.object({
  /** Optional end-customer scope for credential resolution. */
  connectedAccountId: z.string().trim().min(1).optional(),
  /** Idempotency key — retried POSTs with the same key return the same run. */
  idempotencyKey: z.string().trim().min(1).optional(),
})

// POST /v1/workflows/{id}/run — trigger a run. Returns { runId } immediately;
// poll GET /v1/runs/{runId} for status. With ?wait=true the response blocks
// until the run finishes (up to 60s) and returns the full run object.
export const POST = withAuth(
  async (req, ctx) => {
    const workflow = await findScopedWorkflow(ctx.params.id, ctx)
    if (!workflow) throw new ApiError('not_found', 'Workflow not found.')

    const body = await parseBody(req, RunSchema)
    const url = new URL(req.url)
    const wait = url.searchParams.get('wait') === 'true'
    const idempotencyKey = body.idempotencyKey ?? req.headers.get('Idempotency-Key') ?? undefined

    // API-key-driven runs are billed: enforce balance + per-key spend limit.
    const spend = checkRunSpend(ctx.workspace, ctx.apiKey)
    if (!spend.ok) return apiError('payment_required', spend.error ?? 'Spend limit reached.')

    try {
      const { runId, deduplicated } = await startWorkflowRun(workflow, {
        trigger: 'manual',
        connectedAccountId: body.connectedAccountId ?? null,
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
        return ok(
          { runId, status: 'running', deduplicated: deduplicated || undefined },
          { status: deduplicated ? 200 : 202 },
        )
      }

      const { timedOut } = await waitForRun(runId)
      const row = await db.run.findUnique({ where: { id: runId }, include: { steps: true } })
      return ok(
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
        return apiError(codeForStatus(e.status), e.message, { status: e.status })
      }
      throw e
    }
  },
  { scope: 'runs:execute', rateLimit: { limit: 30, windowMs: 60_000 } },
)
