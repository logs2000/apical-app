// Apical — mappers from Prisma rows to the shared API types.
// Keeping these in one place keeps route handlers thin.

import { db } from './db'
import {
  integrationFromRow,
  parseConfig,
  parseWorkflowJSON,
} from './apical-server'
import type {
  Credential,
  ExecutionPattern,
  Integration,
  OAuthProvider,
  Run,
  RunReport,
  RunStep,
  Workflow,
  WorkflowJSON,
} from './types'

export function mapWorkflow(row: {
  id: string
  name: string
  description: string
  stepsJson: string
  trigger: string
  schedule: string | null
  status: string
  department?: string | null
  title?: string | null
  workspaceId?: string | null
  runtime?: string | null
  parentAgentId?: string | null
  runsCount: number
  itemsProcessed: number
  automaticCount: number
  flaggedCount: number
  aiCallsSaved: number
  estCostSavedCents: number
  origin: string
  modelPreference?: string | null
  confidenceThreshold?: number | null
  autoHardenAfter?: number | null
  allowedToolsJson?: string | null
  allowedCredentialsJson?: string | null
  createdAt: Date
  updatedAt: Date
}): Workflow {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    steps: parseWorkflowJSON(row.stepsJson),
    trigger: row.trigger as Workflow['trigger'],
    schedule: row.schedule,
    status: row.status as Workflow['status'],
    origin: row.origin as Workflow['origin'],
    department: (row.department ?? 'General') as Workflow['department'],
    title: row.title ?? null,
    workspaceId: row.workspaceId ?? null,
    runtime: (row.runtime ?? 'hosted') as Workflow['runtime'],
    parentAgentId: row.parentAgentId ?? null,
    runsCount: row.runsCount,
    itemsProcessed: row.itemsProcessed,
    automaticCount: row.automaticCount,
    flaggedCount: row.flaggedCount,
    aiCallsSaved: row.aiCallsSaved,
    estCostSavedCents: row.estCostSavedCents,
    modelPreference: row.modelPreference ?? null,
    confidenceThreshold: row.confidenceThreshold ?? null,
    autoHardenAfter: row.autoHardenAfter ?? null,
    allowedTools: row.allowedToolsJson ? (safeParse(row.allowedToolsJson) as string[]) : null,
    allowedCredentials: row.allowedCredentialsJson ? (safeParse(row.allowedCredentialsJson) as string[]) : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export function mapRunStep(row: {
  id: string
  runId: string
  stepId: string
  kind: string
  label: string
  status: string
  outputJson: string | null
  aiTokens: number
  aiCostCents: number
  startedAt: Date | null
  finishedAt: Date | null
  order: number
}): RunStep {
  return {
    id: row.id,
    stepId: row.stepId,
    kind: row.kind as RunStep['kind'],
    label: row.label,
    status: row.status as RunStep['status'],
    output: row.outputJson ? safeParse(row.outputJson) : undefined,
    aiTokens: row.aiTokens,
    aiCostCents: row.aiCostCents,
    startedAt: row.startedAt ? row.startedAt.toISOString() : null,
    finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
    order: row.order,
  }
}

export function mapRun(
  row: {
    id: string
    workflowId: string
    status: string
    trigger: string
    itemsProcessed: number
    automaticCount: number
    flaggedCount: number
    aiCallsUsed: number
    aiCallsSaved: number
    durationMs: number
    reportJson: string | null
    startedAt: Date
    finishedAt: Date | null
    steps: Array<Parameters<typeof mapRunStep>[0]>
  },
  workflowName: string,
): Run {
  return {
    id: row.id,
    workflowId: row.workflowId,
    workflowName,
    status: row.status as Run['status'],
    trigger: row.trigger as Run['trigger'],
    itemsProcessed: row.itemsProcessed,
    automaticCount: row.automaticCount,
    flaggedCount: row.flaggedCount,
    aiCallsUsed: row.aiCallsUsed,
    aiCallsSaved: row.aiCallsSaved,
    durationMs: row.durationMs,
    report: row.reportJson
      ? (safeParse(row.reportJson) as RunReport | null)
      : null,
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
    steps: [...row.steps]
      .sort((a, b) => a.order - b.order)
      .map(mapRunStep),
  }
}

export function mapExecutionPattern(row: {
  id: string
  workflowId: string
  stepId: string
  signature: string
  outputJson: string
  occurrences: number
  hardened: boolean
  ruleJson: string | null
}): ExecutionPattern {
  return {
    id: row.id,
    workflowId: row.workflowId,
    stepId: row.stepId,
    signature: row.signature,
    output: safeParse(row.outputJson),
    occurrences: row.occurrences,
    hardened: row.hardened,
    rule: row.ruleJson ?? null,
  }
}

export function mapCredential(row: {
  id: string
  service: string
  label: string
  kind: string
  status: string
  metaJson: string
  agentProvisioned: boolean
  canPay: boolean
  oauthProvider?: string | null
  oauthExpiresAt?: Date | null
  createdAt: Date
}): Credential {
  return {
    id: row.id,
    service: row.service,
    label: row.label,
    kind: row.kind as Credential['kind'],
    status: row.status as Credential['status'],
    meta: parseConfig<Record<string, unknown>>(row.metaJson, {}),
    agentProvisioned: row.agentProvisioned,
    canPay: row.canPay,
    oauthProvider: row.oauthProvider ?? null,
    oauthExpiresAt: row.oauthExpiresAt ? row.oauthExpiresAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  }
}

export function mapOAuthProvider(row: {
  id: string
  key: string
  name: string
  icon: string
  category: string
  description: string
  authorizationUrl: string
  tokenUrl: string
  scopes: string
  clientId: string
  supportsCustomCreds: boolean
  demoMode: boolean
  status: string
  createdAt: Date
  updatedAt: Date
}): OAuthProvider {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    icon: row.icon,
    category: row.category,
    description: row.description,
    authorizationUrl: row.authorizationUrl,
    tokenUrl: row.tokenUrl,
    scopes: row.scopes,
    // `hasClientId` is a derived flag — true when Apical has its own OAuth
    // client configured (production). In dev, it's empty so the frontend
    // falls back to either BYO credentials or demo mode.
    hasClientId: Boolean(row.clientId && row.clientId.trim()),
    supportsCustomCreds: row.supportsCustomCreds,
    demoMode: row.demoMode,
    status: row.status as OAuthProvider['status'],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export function mapIntegration(
  row: Parameters<typeof integrationFromRow>[0],
): Integration {
  return integrationFromRow(row)
}

export function mapWorkflowJSONFromString(raw: string): WorkflowJSON {
  return parseWorkflowJSON(raw)
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

/**
 * Convenience: load all integrations with their tools, mapped to the API shape.
 * Used by the agent chat to build the tool catalog.
 */
export async function loadIntegrations(): Promise<Integration[]> {
  const rows = await db.integration.findMany({
    orderBy: [{ category: 'asc' }, { name: 'asc' }],
  })
  return rows.map(mapIntegration)
}
