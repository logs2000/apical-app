// Apical — server-side workflow validation (schema + referential + DB checks).
//
// Layers on top of the pure Zod validation in src/lib/workflow-schema.ts:
//   - integration refs (step.integrationId, step.mcp.integrationId) must be
//     visible to the workspace (own instance or global registry row)
//   - credential refs (http.auth.ref, {{cred:service.field}}) should resolve
//     to a credential in the workspace — reported as warnings, since imports
//     legitimately create the workflow first and prompt for keys after.
//
// Used by POST /v1/workflows, PATCH /v1/workflows/{id}, and
// POST /v1/workflows/validate.

import { db } from '@/lib/db'
import { integrationVisibleWhere } from '@/lib/integration-scope'
import {
  validateWorkflowJSON,
  type WorkflowValidationIssue,
} from '@/lib/workflow-schema'
import type { WorkflowJSON } from '@/lib/types'

export interface ServerValidationResult {
  ok: boolean
  workflow: WorkflowJSON | null
  issues: WorkflowValidationIssue[]
  warnings: WorkflowValidationIssue[]
}

function collectStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value)
  else if (Array.isArray(value)) value.forEach((v) => collectStrings(v, out))
  else if (value && typeof value === 'object')
    Object.values(value).forEach((v) => collectStrings(v, out))
  return out
}

/** All {{cred:service.field}} service keys referenced anywhere in the doc. */
function referencedCredServices(wf: WorkflowJSON): Set<string> {
  const services = new Set<string>()
  for (const s of collectStrings(wf.steps)) {
    for (const m of s.matchAll(/\{\{\s*cred:([\w-]+)[^}]*\}\}/g)) {
      services.add(m[1])
    }
  }
  return services
}

export async function validateWorkflowForWorkspace(
  data: unknown,
  workspaceId: string,
): Promise<ServerValidationResult> {
  const base = validateWorkflowJSON(data)
  if (!base.ok) {
    return { ok: false, workflow: null, issues: base.issues, warnings: base.warnings }
  }

  const wf = base.workflow as WorkflowJSON
  const issues: WorkflowValidationIssue[] = []
  const warnings: WorkflowValidationIssue[] = [...base.warnings]

  // ---- Integration refs must exist and be visible to the workspace ----
  const integrationIds = new Set<string>()
  wf.steps.forEach((step) => {
    if (step.integrationId) integrationIds.add(step.integrationId)
    if (step.mcp?.integrationId) integrationIds.add(step.mcp.integrationId)
  })
  if (integrationIds.size > 0) {
    const found = await db.integration.findMany({
      where: {
        id: { in: [...integrationIds] },
        ...integrationVisibleWhere(workspaceId),
      },
      select: { id: true },
    })
    const foundIds = new Set(found.map((r) => r.id))
    wf.steps.forEach((step, idx) => {
      for (const ref of [step.integrationId, step.mcp?.integrationId]) {
        if (ref && !foundIds.has(ref)) {
          issues.push({
            path: `steps.${idx}`,
            message: `Integration "${ref}" not found in this workspace or the registry.`,
          })
        }
      }
    })
  }

  // ---- Credential refs should resolve (warnings, not hard failures) ----
  const credRefs = new Set<string>()
  wf.steps.forEach((step) => {
    if (step.http?.auth?.ref) credRefs.add(step.http.auth.ref)
  })
  const credServices = referencedCredServices(wf)

  if (credRefs.size > 0 || credServices.size > 0) {
    const creds = await db.credential.findMany({
      where: { workspaceId, status: { not: 'revoked' } },
      select: { id: true, service: true },
    })
    const byId = new Set(creds.map((c) => c.id))
    const byService = new Set(creds.map((c) => c.service))
    for (const ref of credRefs) {
      if (!byId.has(ref) && !byService.has(ref)) {
        warnings.push({
          path: '(credentials)',
          message: `Credential ref "${ref}" doesn't resolve to a credential in this workspace yet. Runs will fail on that step until it's added.`,
        })
      }
    }
    for (const service of credServices) {
      if (!byService.has(service)) {
        warnings.push({
          path: '(credentials)',
          message: `{{cred:${service}.*}} references service "${service}" which has no credential in this workspace yet.`,
        })
      }
    }
  }

  if (issues.length > 0) return { ok: false, workflow: wf, issues, warnings }
  return { ok: true, workflow: wf, issues: [], warnings }
}
