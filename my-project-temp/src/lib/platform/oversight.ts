// Apical — batch quality audit.
//
// Failed production runs are handled autonomously by the supervisor
// (see run-supervision.ts): it diagnoses the failure, patches the workflow,
// reruns, and verifies — no chat-thread hand-off, no email.
//
// This module keeps one on-demand tool: batchQualityAudit samples the N most
// recent finished runs and sanity-checks their REAL step outputs, catching the
// "runs are green but the output is garbage" failure mode that per-run status
// misses. Exposed via the workflow_monitor tool (review: true).

import { db } from '@/lib/db'
import { simpleComplete } from '@/lib/platform/llm-gateway'

function stripFences(s: string): string {
  let out = s.trim()
  out = out.replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim()
  const first = out.indexOf('{')
  const last = out.lastIndexOf('}')
  if (first !== -1 && last !== -1 && last > first) out = out.slice(first, last + 1)
  return out
}

export interface BatchReviewResult {
  runsReviewed: number
  verdict: 'healthy' | 'issues_found' | 'insufficient_data'
  findings: string[]
}

/**
 * Sample the N most recent completed runs and sanity-check their REAL step
 * outputs. Catches silent quality regressions that per-run status misses.
 */
export async function batchQualityAudit(
  workflowId: string,
  userId: string,
  sample = 5,
): Promise<BatchReviewResult> {
  const workflow = await db.workflow.findUnique({
    where: { id: workflowId },
    select: { name: true, description: true, stepsJson: true, modelPreference: true },
  })
  if (!workflow) {
    return { runsReviewed: 0, verdict: 'insufficient_data', findings: ['Workflow not found.'] }
  }
  const runs = await db.run.findMany({
    where: { workflowId, status: { in: ['completed', 'failed'] } },
    orderBy: { startedAt: 'desc' },
    take: Math.min(10, Math.max(1, sample)),
    include: { steps: { orderBy: { order: 'asc' } } },
  })
  if (runs.length === 0) {
    return { runsReviewed: 0, verdict: 'insufficient_data', findings: ['No finished runs yet.'] }
  }

  const runBlocks = runs.map((r) => {
    const steps = r.steps
      .map((s) => `  [${s.status}] ${s.label}: ${(s.outputJson ?? '').slice(0, 300)}`)
      .join('\n')
    return `Run ${r.id} (${r.status}, ${r.startedAt.toISOString().slice(0, 16)}):\n${steps}`
  })

  try {
    const text = await simpleComplete({
      userId,
      messages: [
        {
          role: 'system',
          content:
            'You are auditing a frozen automation by sampling its recent run outputs. ' +
            'Look for: outputs that are empty/garbage despite "completed" status, the same error recurring, ' +
            'outputs that contradict the workflow\'s purpose, and degradation over time. ' +
            'Respond with ONLY JSON: {"verdict":"healthy"|"issues_found","findings":["..."]} — findings is empty when healthy.',
        },
        {
          role: 'user',
          content: [
            `Workflow: ${workflow.name} — ${workflow.description}`,
            '',
            ...runBlocks,
          ].join('\n\n'),
        },
      ],
    })
    const obj = JSON.parse(stripFences(text)) as {
      verdict?: string
      findings?: unknown[]
    }
    return {
      runsReviewed: runs.length,
      verdict: obj.verdict === 'issues_found' ? 'issues_found' : 'healthy',
      findings: Array.isArray(obj.findings)
        ? obj.findings.map((f) => String(f).slice(0, 500)).slice(0, 10)
        : [],
    }
  } catch (err) {
    return {
      runsReviewed: runs.length,
      verdict: 'insufficient_data',
      findings: [`Review failed: ${err instanceof Error ? err.message : String(err)}`],
    }
  }
}
