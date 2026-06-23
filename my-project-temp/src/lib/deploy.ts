// Apical — shared Automation File deployment logic.
//
// Used by both:
//   - POST /api/employees/import  (the in-app "hire from JSON" flow)
//   - POST /api/dev/deploy        (the authenticated MCP/REST deploy endpoint)
//
// Both accept an AutomationFile and install its inline integrations + credentials
// + create the workflow. The dev/deploy variant additionally scopes the workflow
// to a developer's workspaceId.

import { db } from './db'
import { serializeWorkflowJSON } from './apical-server'
import { mapWorkflow } from './mappers'
import type {
  AutomationFile,
  HttpCallSpec,
  IntegrationKind,
  IntegrationVisibility,
  ToolDef,
  Workflow,
  WorkflowStep,
} from './types'

// ---------------- Coercion helpers ----------------

export function coerceDepartment(raw: unknown): string {
  if (typeof raw === 'string' && raw.trim()) return raw.trim()
  return 'General'
}

function coerceKind(raw: unknown): IntegrationKind {
  if (raw === 'mcp' || raw === 'api' || raw === 'http') return raw
  return 'http'
}

function coerceVisibility(raw: unknown): IntegrationVisibility {
  return raw === 'public' ? 'public' : 'private'
}

function coerceCredentialKind(raw: unknown): 'oauth' | 'apikey' | 'payment' | 'mcp_token' {
  if (raw === 'oauth' || raw === 'apikey' || raw === 'payment' || raw === 'mcp_token') return raw
  return 'apikey'
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 16)
}

function autoTools(integrationId: string, name: string): ToolDef[] {
  const slug = slugify(name) || 'tool'
  return [
    {
      id: `${slug}.action`,
      name: 'Run action',
      description: `Run an action on ${name}.`,
      integrationId,
    },
    {
      id: `${slug}.query`,
      name: 'Query',
      description: `Query ${name} for records.`,
      integrationId,
    },
  ]
}

export function validateAutomationFile(file: Partial<AutomationFile>): string | null {
  if (typeof file.name !== 'string' || !file.name.trim()) {
    return 'Automation file is missing a "name".'
  }
  if (!Array.isArray(file.steps) || file.steps.length === 0) {
    return 'Automation file must include at least one step in "steps".'
  }
  return null
}

// ---------------- Step normalization ----------------

/** Normalize a parsed AutomationFile's steps into well-formed WorkflowSteps.
 *  Same logic as /api/employees/import — accepts inline `http` specs on tool steps. */
export function normalizeSteps(raw: unknown[]): WorkflowStep[] {
  return raw
    .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
    .map((s, i) => {
      const kind = s.kind === 'reason' || s.kind === 'gate' ? s.kind : 'tool'
      const id = typeof s.id === 'string' && s.id ? s.id : `s${i + 1}`
      const label =
        typeof s.label === 'string' && s.label
          ? s.label
          : kind === 'reason'
            ? 'Reason'
            : kind === 'gate'
              ? 'Approve'
              : 'Run tool'
      const out: WorkflowStep = { id, kind, label }
      if (kind === 'tool') {
        if (typeof s.tool === 'string') out.tool = s.tool
        if (s.inputs && typeof s.inputs === 'object') {
          out.inputs = s.inputs as Record<string, unknown>
        }
        if (s.http && typeof s.http === 'object') {
          const h = s.http as Record<string, unknown>
          const method =
            typeof h.method === 'string' &&
            ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(String(h.method).toUpperCase())
              ? (String(h.method).toUpperCase() as
                  | 'GET'
                  | 'POST'
                  | 'PUT'
                  | 'PATCH'
                  | 'DELETE')
              : 'GET'
          const url = typeof h.url === 'string' ? h.url : ''
          if (url) {
            const httpSpec: HttpCallSpec = {
              method,
              url,
              ...(h.headers && typeof h.headers === 'object' && !Array.isArray(h.headers)
                ? {
                    headers: Object.fromEntries(
                      Object.entries(h.headers as Record<string, unknown>)
                        .filter(([, v]) => typeof v === 'string' || typeof v === 'number')
                        .map(([k, v]) => [k, String(v)]),
                    ),
                  }
                : {}),
              ...('body' in h ? { body: h.body } : {}),
              ...(h.auth && typeof h.auth === 'object' && !Array.isArray(h.auth)
                ? { auth: h.auth as HttpCallSpec['auth'] }
                : {}),
              ...(typeof h.description === 'string' && h.description
                ? { description: h.description }
                : {}),
            }
            out.http = httpSpec
          }
        }
      } else if (kind === 'reason') {
        if (typeof s.prompt === 'string') out.prompt = s.prompt
        if (Array.isArray(s.allowedTools)) {
          out.allowedTools = s.allowedTools.filter(
            (t) => typeof t === 'string',
          ) as string[]
        }
        if (s.outputShape && typeof s.outputShape === 'object') {
          out.outputShape = s.outputShape as Record<string, string>
        }
        if (typeof s.confidenceThreshold === 'number') {
          out.confidenceThreshold = s.confidenceThreshold
        }
      } else if (kind === 'gate') {
        if (typeof s.gateMessage === 'string') out.gateMessage = s.gateMessage
      }
      if (typeof s.note === 'string') out.note = s.note
      return out
    })
}

// ---------------- Main deploy function ----------------

export interface DeployOptions {
  /** Scope the workflow to this workspace (the developer's). */
  workspaceId?: string | null
  /** 'agent' (default — the agent builder created this) or 'manual'. */
  origin?: 'agent' | 'manual'
}

export interface DeployResult {
  agent: Workflow
  integrationsCreated: number
  credentialsCreated: number
}

/**
 * Deploy an AutomationFile: install inline integrations + credentials, then
 * create the workflow (agent) scoped to the given workspace. Returns the
 * mapped Workflow + counts.
 */
export async function deployAutomationFile(
  file: Partial<AutomationFile>,
  options: DeployOptions = {},
): Promise<DeployResult> {
  const err = validateAutomationFile(file)
  if (err) throw new DeployError(err, 400)

  const name = (file.name as string).trim()
  const description = typeof file.description === 'string' ? file.description : ''
  const department = coerceDepartment(file.department)
  const title =
    typeof file.title === 'string' && file.title.trim() ? file.title.trim() : null
  const steps = normalizeSteps((file.steps as unknown[]) || [])
  const origin = options.origin ?? 'agent'

  let integrationsCreated = 0

  // mcpServers shorthand: each becomes an Integration with kind='mcp'.
  const mcpServers = Array.isArray(file.mcpServers) ? file.mcpServers : []
  for (const mcp of mcpServers) {
    if (!mcp || typeof mcp !== 'object' || !mcp.name) continue
    const transport = mcp.transport === 'http' ? 'http' : 'stdio'
    const mcpConfig = {
      transport,
      ...(transport === 'stdio'
        ? {
            command: mcp.command,
            args: Array.isArray(mcp.args) ? mcp.args : undefined,
            env: mcp.env && typeof mcp.env === 'object' ? mcp.env : undefined,
          }
        : { url: mcp.url }),
    }
    const created = await db.integration.create({
      data: {
        name: mcp.name,
        kind: 'mcp',
        description: `MCP server (${transport}) declared in automation file.`,
        category: 'general',
        color: 'violet',
        status: 'connected',
        config: JSON.stringify({ mcp: mcpConfig }),
        tools: '[]',
        source: 'private',
        visibility: 'private',
        authorLabel: null,
        installs: 0,
      },
    })
    const slug = (mcp.name || 'tool').toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 16)
    const tools: ToolDef[] = [
      { id: `${slug}.action`, name: 'Run action', description: `Run an action on ${mcp.name}.`, integrationId: created.id },
      { id: `${slug}.query`, name: 'Query', description: `Query ${mcp.name} for records.`, integrationId: created.id },
    ]
    await db.integration.update({ where: { id: created.id }, data: { tools: JSON.stringify(tools) } })
    integrationsCreated += 1
  }

  if (Array.isArray(file.integrations)) {
    for (const it of file.integrations) {
      if (!it || typeof it !== 'object' || !it.name) continue
      const created = await db.integration.create({
        data: {
          name: it.name,
          kind: coerceKind(it.kind),
          description: it.description || `Imported from automation file: ${it.name}`,
          category: it.category || 'general',
          color: 'violet',
          status: 'connected',
          config: JSON.stringify({
            url: it.url,
            specUrl: it.specUrl,
            auth: it.auth ?? { type: 'apikey' },
          }),
          tools: '[]',
          source: 'private',
          visibility: coerceVisibility(it.visibility),
          authorLabel: null,
          installs: 0,
        },
      })

      const tools: ToolDef[] = Array.isArray(it.tools)
        ? it.tools
            .filter((t) => t && typeof t.id === 'string')
            .map((t) => ({
              id: t.id,
              name: t.name || t.id,
              description: t.description || '',
              integrationId: created.id,
            }))
        : autoTools(created.id, it.name)

      await db.integration.update({
        where: { id: created.id },
        data: { tools: JSON.stringify(tools) },
      })
      integrationsCreated += 1
    }
  }

  // Inline credentials.
  let credentialsCreated = 0
  if (Array.isArray(file.credentials)) {
    for (const c of file.credentials) {
      if (!c || typeof c !== 'object' || !c.service) continue
      const meta = (c.meta && typeof c.meta === 'object' ? c.meta : {}) as Record<
        string,
        unknown
      >
      const status =
        typeof meta.status === 'string' && meta.status === 'provisioning'
          ? 'provisioning'
          : 'active'
      await db.credential.create({
        data: {
          service: c.service,
          label: c.label || c.service,
          kind: coerceCredentialKind(c.kind),
          status,
          metaJson: JSON.stringify(meta),
          agentProvisioned: false,
          canPay: coerceCredentialKind(c.kind) === 'payment',
        },
      })
      credentialsCreated += 1
    }
  }

  const triggerType = file.trigger?.type === 'schedule' ? 'schedule' : 'manual'
  const schedule = file.trigger?.label ?? file.trigger?.cron ?? null

  const created = await db.workflow.create({
    data: {
      name,
      description,
      stepsJson: serializeWorkflowJSON({ version: 1, steps }),
      trigger: triggerType,
      schedule: schedule ?? null,
      status: 'active',
      origin,
      department,
      title,
      workspaceId: options.workspaceId ?? null,
    },
  })

  return {
    agent: mapWorkflow(created),
    integrationsCreated,
    credentialsCreated,
  }
}

/** Throw with an attached HTTP status — the route handler catches + returns it. */
export class DeployError extends Error {
  status: number
  constructor(message: string, status = 400) {
    super(message)
    this.status = status
  }
}

/** Parse the request body, accepting either { json: "<raw>" } or the parsed object. */
export async function parseAutomationFileBody(req: Request): Promise<Partial<AutomationFile>> {
  const body = (await req.json()) as { json?: string } | Partial<AutomationFile>
  if (typeof body === 'object' && body !== null && typeof body.json === 'string') {
    try {
      return JSON.parse(body.json) as Partial<AutomationFile>
    } catch {
      throw new DeployError('The `json` field was not valid JSON.', 400)
    }
  }
  return body as Partial<AutomationFile>
}
