// Apical /v1 — DTO mappers. The /v1 surface exposes the RAW WorkflowJSON
// document (the public contract) plus metadata, unlike the first-party /api
// mappers which return UI-shaped objects.

import { db } from '@/lib/db'
import { tryParseWorkflowJSON } from '@/lib/apical-server'
import type { Run, RunStep, Workflow } from '@prisma/client'
import type { WorkflowJSON } from '@/lib/types'

export interface WorkflowV1 {
  id: string
  name: string
  description: string
  status: string
  trigger: string
  schedule: string | null
  origin: string
  runtime: string
  workspaceId: string | null
  parentAgentId: string | null
  activeRevisionId: string | null
  /** The raw WorkflowJSON document (see /schemas/workflow/v2.json). */
  workflow: WorkflowJSON
  /** Aggregate run counters. */
  stats: {
    runsCount: number
    itemsProcessed: number
    automaticCount: number
    flaggedCount: number
    aiCallsSaved: number
    estCostSavedCents: number
  }
  /** Execution configuration. */
  config: {
    modelPreference: string | null
    confidenceThreshold: number | null
    autoHardenAfter: number | null
    allowedTools: string[] | null
    allowedCredentials: string[] | null
  }
  createdAt: string
  updatedAt: string
}

export function mapWorkflowV1(row: Workflow): WorkflowV1 {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status,
    trigger: row.trigger,
    schedule: row.schedule,
    origin: row.origin,
    runtime: row.runtime ?? 'hosted',
    workspaceId: row.workspaceId,
    parentAgentId: row.parentAgentId,
    activeRevisionId: row.activeRevisionId,
    workflow: tryParseWorkflowJSON(row.stepsJson),
    stats: {
      runsCount: row.runsCount,
      itemsProcessed: row.itemsProcessed,
      automaticCount: row.automaticCount,
      flaggedCount: row.flaggedCount,
      aiCallsSaved: row.aiCallsSaved,
      estCostSavedCents: row.estCostSavedCents,
    },
    config: {
      modelPreference: row.modelPreference,
      confidenceThreshold: row.confidenceThreshold,
      autoHardenAfter: row.autoHardenAfter,
      allowedTools: safeParseArray(row.allowedToolsJson),
      allowedCredentials: safeParseArray(row.allowedCredentialsJson),
    },
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

function safeParseArray(raw: string | null): string[] | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed)
      ? parsed.filter((s): s is string => typeof s === 'string')
      : null
  } catch {
    return null
  }
}

export interface RunV1 {
  id: string
  workflowId: string
  revisionId: string | null
  status: string
  trigger: string
  connectedAccountId: string | null
  itemsProcessed: number
  automaticCount: number
  flaggedCount: number
  durationMs: number
  report: unknown
  startedAt: string
  finishedAt: string | null
  steps?: Array<{
    stepId: string
    kind: string
    label: string
    status: string
    output: unknown
    startedAt: string | null
    finishedAt: string | null
    order: number
  }>
}

export function mapRunV1(
  row: Run & { steps?: RunStep[] },
  opts: { includeSteps?: boolean } = {},
): RunV1 {
  const base: RunV1 = {
    id: row.id,
    workflowId: row.workflowId,
    revisionId: row.revisionId,
    status: row.status,
    trigger: row.trigger,
    connectedAccountId: row.connectedAccountId,
    itemsProcessed: row.itemsProcessed,
    automaticCount: row.automaticCount,
    flaggedCount: row.flaggedCount,
    durationMs: row.durationMs,
    report: safeParse(row.reportJson),
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
  }
  if (opts.includeSteps && row.steps) {
    base.steps = [...row.steps]
      .sort((a, b) => a.order - b.order)
      .map((s) => ({
        stepId: s.stepId,
        kind: s.kind,
        label: s.label,
        status: s.status,
        output: safeParse(s.outputJson),
        startedAt: s.startedAt ? s.startedAt.toISOString() : null,
        finishedAt: s.finishedAt ? s.finishedAt.toISOString() : null,
        order: s.order,
      }))
  }
  return base
}

function safeParse(raw: string | null): unknown {
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

/** Where-clause for workflows the auth context may touch. */
export function workflowScopeWhere(workspaceId: string, userId: string | null) {
  return {
    OR: [
      { workspaceId },
      // Legacy rows created before workspace backfill.
      ...(userId ? [{ userId, workspaceId: null }] : []),
    ],
  }
}

/** Load a workflow the auth context may touch, or null. */
export async function findScopedWorkflow(
  id: string,
  ctx: { workspace: { id: string }; user: { id: string } | null },
): Promise<Workflow | null> {
  return db.workflow.findFirst({
    where: { id, ...workflowScopeWhere(ctx.workspace.id, ctx.user?.id ?? null) },
  })
}
