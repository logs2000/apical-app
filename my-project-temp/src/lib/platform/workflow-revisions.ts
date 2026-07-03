// Apical — workflow revisions.
//
// Every change to a workflow's steps goes through `saveWorkflowSteps`, which
// creates an immutable WorkflowRevision, bumps the per-workflow revision
// number, points `Workflow.activeRevisionId` at it, and keeps the
// denormalized `Workflow.stepsJson` in sync. Runs pin the revision they
// executed via `Run.revisionId` (see resolveActiveRevision).

import { db } from '@/lib/db'
import { serializeWorkflowJSON } from '@/lib/apical-server'
import { validateWorkflowJSON } from '@/lib/workflow-schema'
import type { WorkflowJSON } from '@/lib/types'
import type { WorkflowRevision } from '@prisma/client'

export type RevisionAuthor = 'user' | 'agent' | 'import' | 'rollback' | 'system'

export interface SaveStepsOptions {
  author?: RevisionAuthor
  note?: string
}

export class WorkflowValidationError extends Error {
  issues: Array<{ path: string; message: string }>
  constructor(issues: Array<{ path: string; message: string }>) {
    super(
      `Workflow failed schema validation: ${issues
        .slice(0, 5)
        .map((i) => `${i.path}: ${i.message}`)
        .join('; ')}`,
    )
    this.name = 'WorkflowValidationError'
    this.issues = issues
  }
}

/**
 * Persist a new steps snapshot for `workflowId`: creates the next
 * WorkflowRevision, activates it, and syncs `stepsJson`. Returns the revision.
 *
 * SINGLE SAVE PATH: every write validates against the same WorkflowJSON
 * schema + referential checks as POST /v1/workflows — invalid steps never
 * persist, regardless of which surface (agent tool, API route, import,
 * harden) initiated the save. Throws WorkflowValidationError on failure.
 */
export async function saveWorkflowSteps(
  workflowId: string,
  steps: WorkflowJSON,
  opts: SaveStepsOptions = {},
): Promise<WorkflowRevision> {
  const check = validateWorkflowJSON(steps)
  if (!check.ok) {
    throw new WorkflowValidationError(check.issues)
  }
  const stepsJson = serializeWorkflowJSON(steps)
  return db.$transaction(async (tx) => {
    const last = await tx.workflowRevision.findFirst({
      where: { workflowId },
      orderBy: { number: 'desc' },
      select: { number: true },
    })
    const revision = await tx.workflowRevision.create({
      data: {
        workflowId,
        number: (last?.number ?? 0) + 1,
        stepsJson,
        schemaVersion: steps.version ?? 1,
        author: opts.author ?? 'user',
        note: opts.note ?? null,
      },
    })
    await tx.workflow.update({
      where: { id: workflowId },
      data: { stepsJson, activeRevisionId: revision.id },
    })
    return revision
  })
}

/**
 * The workflow's active revision id, creating revision 1 from the current
 * stepsJson for legacy rows that predate the revisions table. Used by run
 * creation to pin `Run.revisionId`.
 */
export async function resolveActiveRevision(
  workflowId: string,
): Promise<string | null> {
  const wf = await db.workflow.findUnique({
    where: { id: workflowId },
    select: { activeRevisionId: true, stepsJson: true },
  })
  if (!wf) return null
  if (wf.activeRevisionId) return wf.activeRevisionId

  // Legacy workflow — backfill revision 1 from the current steps.
  try {
    const revision = await db.workflowRevision.create({
      data: {
        workflowId,
        number: 1,
        stepsJson: wf.stepsJson,
        author: 'system',
        note: 'Backfilled from stepsJson (pre-revisions workflow).',
      },
    })
    await db.workflow.update({
      where: { id: workflowId },
      data: { activeRevisionId: revision.id },
    })
    return revision.id
  } catch {
    // Raced with another backfill — re-read.
    const again = await db.workflow.findUnique({
      where: { id: workflowId },
      select: { activeRevisionId: true },
    })
    return again?.activeRevisionId ?? null
  }
}

/**
 * Roll back: create a NEW revision whose steps are copied from revision
 * `number` and activate it. History is never rewritten. Returns the new
 * revision, or null if the target doesn't exist.
 */
export async function rollbackToRevision(
  workflowId: string,
  number: number,
): Promise<WorkflowRevision | null> {
  const target = await db.workflowRevision.findUnique({
    where: { workflowId_number: { workflowId, number } },
  })
  if (!target) return null

  return db.$transaction(async (tx) => {
    const last = await tx.workflowRevision.findFirst({
      where: { workflowId },
      orderBy: { number: 'desc' },
      select: { number: true },
    })
    const revision = await tx.workflowRevision.create({
      data: {
        workflowId,
        number: (last?.number ?? 0) + 1,
        stepsJson: target.stepsJson,
        schemaVersion: target.schemaVersion,
        author: 'rollback',
        note: `Rollback to revision ${number}.`,
      },
    })
    await tx.workflow.update({
      where: { id: workflowId },
      data: { stepsJson: target.stepsJson, activeRevisionId: revision.id },
    })
    return revision
  })
}

export interface RevisionDto {
  id: string
  number: number
  schemaVersion: number
  author: string
  note: string | null
  active: boolean
  createdAt: string
}

export function mapRevision(
  row: WorkflowRevision,
  activeRevisionId: string | null,
): RevisionDto {
  return {
    id: row.id,
    number: row.number,
    schemaVersion: row.schemaVersion,
    author: row.author,
    note: row.note,
    active: row.id === activeRevisionId,
    createdAt: row.createdAt.toISOString(),
  }
}
