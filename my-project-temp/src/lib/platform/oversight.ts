// Apical — run oversight.
//
// Two jobs, per the "agent as manager" vision:
//
// 1. runFailureOversight(runId): fired automatically when a production run
//    FAILS. An agent session (one LLM diagnosis pass) inspects the failing
//    step + real error, proposes a concrete patch, posts the diagnosis into
//    the workflow's chat thread (so the owner sees it next time they open
//    the agent), and emails the owner. It NEVER silently applies the patch —
//    the owner (or the agent, on their instruction) applies it via
//    workflow_update, which creates a proper revision.
//
// 2. batchReviewRuns(workflowId, userId, sample): samples the N most recent
//    completed runs and sanity-checks their real step outputs — catching the
//    "runs are green but the output is garbage" failure mode. Exposed via
//    the workflow_monitor tool (review: true).

import { db } from '@/lib/db'
import { simpleComplete } from '@/lib/platform/llm-gateway'
import { notifySchedule } from '@/lib/platform/notifications'

function stripFences(s: string): string {
  let out = s.trim()
  out = out.replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim()
  const first = out.indexOf('{')
  const last = out.lastIndexOf('}')
  if (first !== -1 && last !== -1 && last > first) out = out.slice(first, last + 1)
  return out
}

export interface FailureDiagnosis {
  diagnosis: string
  proposedFix: string
  /** Which step ids the fix touches. */
  affectedStepIds: string[]
}

/**
 * Diagnose a failed run and post the result to the workflow's chat thread +
 * notify the owner. Fire-and-forget safe: never throws.
 */
export async function runFailureOversight(runId: string): Promise<void> {
  try {
    const run = await db.run.findUnique({
      where: { id: runId },
      include: {
        steps: { orderBy: { order: 'asc' } },
        workflow: {
          select: {
            id: true,
            name: true,
            description: true,
            stepsJson: true,
            userId: true,
            modelPreference: true,
          },
        },
      },
    })
    if (!run || run.status !== 'failed' || !run.workflow) return
    const workflow = run.workflow
    if (!workflow.userId) return

    const failedStep = run.steps.find((s) => s.status === 'failed')
    const stepSummary = run.steps
      .map((s) => {
        const out = (s.outputJson ?? '').slice(0, 400)
        return `- [${s.status}] ${s.stepId} "${s.label}" (${s.kind})${out ? ` → ${out}` : ''}`
      })
      .join('\n')

    let parsed: FailureDiagnosis = {
      diagnosis: `Run ${runId} failed at step "${failedStep?.label ?? 'unknown'}".`,
      proposedFix: 'Inspect the failing step and update the workflow.',
      affectedStepIds: failedStep ? [failedStep.stepId] : [],
    }
    try {
      const text = await simpleComplete({
        userId: workflow.userId,
        messages: [
          {
            role: 'system',
            content:
              'You are the oversight manager for a frozen Apical automation. A production run failed. ' +
              'Diagnose the ROOT CAUSE from the real step outputs and propose ONE concrete, minimal fix ' +
              'to the workflow JSON (which step to change and how). Respond with ONLY JSON: ' +
              '{"diagnosis":"...","proposedFix":"...","affectedStepIds":["s2"]}',
          },
          {
            role: 'user',
            content: [
              `Workflow: ${workflow.name} — ${workflow.description}`,
              `Workflow JSON:\n${workflow.stepsJson.slice(0, 4000)}`,
              '',
              `Run ${runId} steps (real results):`,
              stepSummary,
            ].join('\n'),
          },
        ],
      })
      const obj = JSON.parse(stripFences(text)) as Partial<FailureDiagnosis>
      if (obj.diagnosis) {
        parsed = {
          diagnosis: String(obj.diagnosis).slice(0, 2000),
          proposedFix: String(obj.proposedFix ?? '').slice(0, 2000),
          affectedStepIds: Array.isArray(obj.affectedStepIds)
            ? obj.affectedStepIds.map(String).slice(0, 10)
            : [],
        }
      }
    } catch (err) {
      console.error('[oversight] LLM diagnosis failed, using fallback:', err)
    }

    // Post the diagnosis into the agent's chat thread so the owner sees it
    // in context and can say "apply the fix" (→ workflow_update → revision).
    const content = [
      `**Run failed — oversight report** (run \`${runId}\`)`,
      '',
      `**Diagnosis:** ${parsed.diagnosis}`,
      parsed.proposedFix ? `**Proposed fix:** ${parsed.proposedFix}` : '',
      parsed.affectedStepIds.length > 0
        ? `**Affected steps:** ${parsed.affectedStepIds.join(', ')}`
        : '',
      '',
      'Reply "apply the fix" and I will update the workflow (a new revision — you can roll back).',
    ]
      .filter(Boolean)
      .join('\n')
    await db.agentMessage.create({
      data: { agentId: workflow.id, role: 'agent', content },
    })

    await notifySchedule(workflow.userId, {
      workflowName: workflow.name,
      runId,
      status: 'failed',
      summary: parsed.diagnosis,
    })
  } catch (err) {
    console.error('[oversight] runFailureOversight crashed:', err)
  }
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
export async function batchReviewRuns(
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
