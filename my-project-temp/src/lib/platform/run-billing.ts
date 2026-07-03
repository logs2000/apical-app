// Apical — per-run billing for API-key-driven runs: flat cost, workspace
// balance, per-key spend limits. Shared by /v1/workflows/{id}/run and the
// legacy /api/dev/run. (Stripe subscription billing lives in billing.ts.)

import { db } from '@/lib/db'
import { logKeyAudit } from '@/lib/api-key-auth'
import type { ApiKey, Workspace } from '@prisma/client'

/** Flat per-run cost charged to workspace balances (API-key-driven runs). */
export const RUN_COST_CENTS = 3

export interface SpendCheck {
  ok: boolean
  /** User-facing refusal reason (maps to HTTP 402). */
  error?: string
}

/**
 * Pre-flight spend check for an API-key-driven run. Session-driven (first
 * party UI) runs are not charged and skip this.
 */
export function checkRunSpend(
  workspace: Workspace,
  apiKey: ApiKey | null,
): SpendCheck {
  if (!apiKey) return { ok: true }
  if (
    apiKey.spendLimitCents > 0 &&
    apiKey.spentCents + RUN_COST_CENTS > apiKey.spendLimitCents
  ) {
    return {
      ok: false,
      error: `API key spend limit reached (${apiKey.spentCents}/${apiKey.spendLimitCents}¢)`,
    }
  }
  if (workspace.balanceCents < 0) {
    return {
      ok: false,
      error: `Insufficient balance (${workspace.balanceCents}¢)`,
    }
  }
  return { ok: true }
}

/**
 * Charge a started run: decrement workspace balance, increment the key's
 * spent counter, append an audit row. Call only AFTER the run was created.
 */
export async function chargeRunCost(opts: {
  workspace: Workspace
  apiKey: ApiKey | null
  runId: string
  workflowName: string
  source?: 'mcp' | 'rest'
}): Promise<void> {
  if (!opts.apiKey) return
  await db.workspace.update({
    where: { id: opts.workspace.id },
    data: { balanceCents: { decrement: RUN_COST_CENTS } },
  })
  await db.apiKey.update({
    where: { id: opts.apiKey.id },
    data: { spentCents: { increment: RUN_COST_CENTS } },
  })
  void logKeyAudit({
    workspaceId: opts.workspace.id,
    apiKeyId: opts.apiKey.id,
    action: 'run:start',
    target: opts.runId,
    success: true,
    costCents: RUN_COST_CENTS,
    detail: `Triggered run on "${opts.workflowName}".`,
    source: opts.source ?? 'rest',
  })
}
