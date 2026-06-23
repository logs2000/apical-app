#!/usr/bin/env bun
// Apical MCP server — stdio transport.
//
// This is the developer-facing surface of the Apical platform: a Cursor /
// Claude Code / Windsurf agent calls these tools to deploy an automation
// (a "vibe-coded" workflow file) and trigger runs on Apical.
//
// It speaks stdio JSON-RPC (the MCP wire format) and proxies to the Apical
// REST API over HTTP. All logging goes to stderr so the JSON-RPC channel on
// stdout stays clean.
//
// Env:
//   APICAL_API_KEY  (required) — the developer's ap_sk_... key (from the
//                                 Apical Developer Console).
//   APICAL_API_URL  (optional) — base URL of the Apical app.
//                                 Default: http://localhost:3000

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'

// ---------------------------------------------------------------------------
// Config + logging
// ---------------------------------------------------------------------------

const API_KEY = process.env.APICAL_API_KEY
const API_URL = (process.env.APICAL_API_URL || 'http://localhost:3000').replace(/\/+$/, '')

/** Write a line to stderr. Never touches stdout — that's the JSON-RPC channel. */
function log(message: string): void {
  process.stderr.write(`[apical-mcp] ${message}\n`)
}

if (!API_KEY) {
  log('ERROR: APICAL_API_KEY is not set.')
  log('Get your key from the Apical Developer Console (Settings → API Keys).')
  log('Then run: APICAL_API_KEY=ap_sk_... apical-mcp')
  process.exit(1)
}

if (!API_KEY.startsWith('ap_sk_')) {
  log(`WARNING: APICAL_API_KEY doesn't look like an Apical key (expected "ap_sk_..." prefix). Got: "${API_KEY.slice(0, 8)}..."`)
}

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

interface ApiError {
  status: number
  message: string
}

/**
 * Call the Apical REST API. Returns either `{ ok: true, data }` or
 * `{ ok: false, error }` where `error` is a user-facing string.
 *
 * - 401 → "Invalid API key"
 * - 402 → "Insufficient balance"
 * - 4xx/5xx → the API's error message (or a generic fallback)
 * - network failure → "Could not reach Apical at {url} — is the app running?"
 */
async function callApi(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Promise<{ ok: true; data: any } | { ok: false; error: string }> {
  const url = `${API_URL}${path}`
  try {
    const res = await fetch(url, {
      method,
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })

    // Try to parse JSON, but tolerate empty/non-JSON bodies.
    let parsed: any = null
    const text = await res.text()
    const ct = res.headers.get('content-type') || ''
    const isJson = ct.includes('application/json') || ct.includes('text/json')
    if (text) {
      try {
        parsed = JSON.parse(text)
      } catch {
        // Non-JSON body — keep `parsed` null, handled below.
      }
    }

    if (!res.ok) {
      // Specific well-known statuses.
      if (res.status === 401) return { ok: false, error: 'Invalid API key' }
      if (res.status === 402) return { ok: false, error: 'Insufficient balance' }

      // Prefer the API's structured error message.
      if (parsed && typeof parsed === 'object') {
        const apiMsg = parsed.error || parsed.message || parsed.errorMsg
        if (apiMsg) return { ok: false, error: String(apiMsg) }
      }

      // Non-JSON body (e.g. an HTML 404 page from a reverse proxy or Next.js
      // dev server when the route doesn't exist yet). Don't dump the HTML —
      // surface a clean hint.
      if (!isJson || !parsed) {
        return {
          ok: false,
          error: `Apical endpoint returned HTTP ${res.status} with a non-JSON body — is the route implemented? (url: ${url})`,
        }
      }

      return { ok: false, error: `HTTP ${res.status}` }
    }

    // 2xx but the body wasn't JSON — almost certainly the wrong URL hit an
    // HTML page (e.g. the SPA shell). Surface it instead of passing `null`
    // back as data.
    if (!isJson || parsed === null) {
      return {
        ok: false,
        error: `Apical endpoint returned a non-JSON response (HTTP ${res.status}) — wrong URL? (url: ${url})`,
      }
    }

    return { ok: true, data: parsed }
  } catch (err: any) {
    // fetch throws on DNS failure, connection refused, network down, etc.
    const reason = err?.name === 'TypeError' ? 'network' : (err?.message || 'unknown')
    log(`fetch failed for ${method} ${url}: ${reason}`)
    return {
      ok: false,
      error: `Could not reach Apical at ${API_URL} — is the app running?`,
    }
  }
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const TOOLS = [
  {
    name: 'apical_deploy',
    description:
      'Deploy an Apical automation from a workflow JSON object. The workflow is an AutomationFile — it has `steps` (the tool/reason/gate pipeline), and may also include inline `integrations`, `credentials`, and `mcpServers`. This turns a vibe-coded workflow file into a running agent on Apical. Returns the new agent id, name, department, and how many integrations were installed.',
    inputSchema: {
      type: 'object',
      properties: {
        workflow: {
          type: 'object',
          description:
            'An Apical AutomationFile. Must have `steps` (array). Optional: name, description, department, title, trigger, integrations, credentials, mcpServers. See https://apical.dev/schemas/automation-file.json.',
        },
        name: {
          type: 'string',
          description: 'Optional: override the workflow.name (the agent\'s first name, e.g. "Pat").',
        },
        department: {
          type: 'string',
          description:
            'Optional: override workflow.department — a free-form label like "Filing", "Inbox", "Billing".',
        },
        title: {
          type: 'string',
          description: 'Optional: override workflow.title — a role label like "Filing Clerk".',
        },
      },
      required: ['workflow'],
    },
  },
  {
    name: 'apical_list_agents',
    description:
      'List the developer\'s deployed Apical agents. Returns one line per agent: name, title, department, status, run count, and id.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'apical_get_agent',
    description:
      'Get one Apical agent\'s full workflow detail — name, title, department, status, schedule, the step list (each: id, kind, label, tool), and run stats.',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: 'The Apical agent (workflow) id.' },
      },
      required: ['agentId'],
    },
  },
  {
    name: 'apical_run_agent',
    description:
      'Trigger a run of an Apical agent. Returns the new run id and a pointer to use apical_get_report for results.',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: 'The Apical agent (workflow) id to run.' },
      },
      required: ['agentId'],
    },
  },
  {
    name: 'apical_get_report',
    description:
      'Get a run\'s report and status — the human-readable summary ("Did 47 documents, 44 automatic, 3 flagged"), the stats (items/auto/flagged/duration), and the list of flagged items if any.',
    inputSchema: {
      type: 'object',
      properties: {
        runId: { type: 'string', description: 'The Apical run id.' },
      },
      required: ['runId'],
    },
  },
] as const

// ---------------------------------------------------------------------------
// Tool dispatch
// ---------------------------------------------------------------------------

type ToolName = (typeof TOOLS)[number]['name']

/** Render the deploy result as a one-line text summary for the LLM. */
function renderDeploy(data: any): string {
  // The /api/dev/deploy endpoint returns the shape defined by MCP-2.
  // We tolerate a few reasonable variants.
  const agent = data?.agent ?? data?.workflow ?? data
  const name = agent?.name ?? '(unnamed)'
  const title = agent?.title ?? '—'
  const department = agent?.department ?? '—'
  const id = agent?.id ?? data?.agentId ?? data?.id ?? '(unknown)'
  const integrationsCreated =
    data?.integrationsCreated ?? data?.integrations ?? agent?.integrationsCreated ?? 0
  const credentialsCreated =
    data?.credentialsCreated ?? data?.credentials ?? 0

  const credNote = credentialsCreated > 0 ? ` ${credentialsCreated} credentials installed.` : ''
  return `Deployed ${name} (${title}) into ${department}. ${integrationsCreated} integrations installed.${credNote} Agent ID: ${id}`
}

/** Render the agent list as a text block, one agent per line. */
function renderAgentList(agents: any[]): string {
  if (!Array.isArray(agents) || agents.length === 0) {
    return 'No agents deployed yet. Use apical_deploy to create your first one.'
  }
  const lines = agents.map((a) => {
    const name = a?.name ?? '(unnamed)'
    const title = a?.title ?? '—'
    const department = a?.department ?? '—'
    const status = a?.status ?? '—'
    const runsCount = a?.runsCount ?? a?.runs ?? 0
    const id = a?.id ?? '?'
    return `${name} (${title}) — ${department} — ${status} — ${runsCount} runs — id: ${id}`
  })
  return lines.join('\n')
}

/** Render a single agent's workflow detail. */
function renderAgentDetail(agent: any): string {
  if (!agent) return 'Agent not found.'
  const name = agent?.name ?? '(unnamed)'
  const title = agent?.title ?? '—'
  const department = agent?.department ?? '—'
  const status = agent?.status ?? '—'
  const schedule =
    agent?.schedule ?? agent?.trigger?.label ?? (agent?.trigger === 'schedule' ? 'schedule' : 'manual')
  const runsCount = agent?.runsCount ?? 0
  const itemsProcessed = agent?.itemsProcessed ?? 0

  // Steps live in workflow.steps (WorkflowJSON shape) OR a flat `steps` array.
  const steps: any[] =
    (agent?.workflow?.steps as any[]) ?? (agent?.steps as any[]) ?? []

  const header = [
    `${name} (${title})`,
    `Department: ${department}`,
    `Status: ${status}`,
    `Schedule: ${schedule}`,
    `Runs: ${runsCount}`,
    `Items processed: ${itemsProcessed}`,
    '',
    'Steps:',
  ].join('\n')

  if (steps.length === 0) {
    return `${header}\n  (no steps)`
  }

  const stepLines = steps.map((s) => {
    const id = s?.id ?? '?'
    const kind = s?.kind ?? '?'
    const label = s?.label ?? ''
    const tool = s?.tool ?? (s?.http ? `http ${s.http.method ?? ''}`.trim() : '')
    const arrow = tool ? ` → ${tool}` : ''
    return `  ${id} [${kind}] ${label}${arrow}`
  })

  return `${header}\n${stepLines.join('\n')}`
}

/** Render the run-started acknowledgement. */
function renderRunStarted(data: any, agentId: string): string {
  const runId = data?.runId ?? data?.run?.id ?? data?.id ?? '(unknown)'
  const status = data?.status ?? data?.run?.status ?? 'running'
  return `Started run ${runId} for ${agentId}. Status: ${status}. Use apical_get_report to see results.`
}

/** Render a run report (summary + stats + flags). */
function renderReport(data: any): string {
  const run = data?.run ?? data
  const report = run?.report ?? data?.report
  const status = run?.status ?? data?.status ?? '—'

  const summary = report?.summary ?? data?.summary ?? '(no summary)'
  const itemsProcessed = run?.itemsProcessed ?? data?.itemsProcessed ?? 0
  const automaticCount = run?.automaticCount ?? data?.automaticCount ?? 0
  const flaggedCount = run?.flaggedCount ?? data?.flaggedCount ?? 0
  const durationMs = run?.durationMs ?? data?.durationMs ?? 0

  const lines: string[] = [
    `Status: ${status}`,
    `Summary: ${summary}`,
    `Stats: ${itemsProcessed} items, ${automaticCount} automatic, ${flaggedCount} flagged, ${(durationMs / 1000).toFixed(1)}s`,
  ]

  const flags = report?.flags ?? data?.flags
  if (Array.isArray(flags) && flags.length > 0) {
    lines.push('', 'Flagged items:')
    for (const f of flags) {
      const stepId = f?.stepId ?? '?'
      const reason = f?.reason ?? '(no reason)'
      const item = f?.item ?? ''
      lines.push(`  • [${stepId}] ${item} — ${reason}`.trim())
    }
  }

  return lines.join('\n')
}

async function handleToolCall(name: ToolName, args: any): Promise<string> {
  log(`→ ${name}`)

  switch (name) {
    case 'apical_deploy': {
      const workflow = args?.workflow
      if (!workflow || typeof workflow !== 'object' || Array.isArray(workflow)) {
        return 'Invalid input: `workflow` must be an object (an Apical AutomationFile with at least a `steps` array).'
      }
      // Merge top-level overrides onto the workflow before posting.
      const body: any = { ...workflow }
      if (typeof args.name === 'string' && args.name) body.name = args.name
      if (typeof args.department === 'string' && args.department) body.department = args.department
      if (typeof args.title === 'string' && args.title) body.title = args.title

      const res = await callApi('POST', '/api/dev/deploy', body)
      if (!res.ok) return res.error
      return renderDeploy(res.data)
    }

    case 'apical_list_agents': {
      const res = await callApi('GET', '/api/dev/agents')
      if (!res.ok) return res.error
      const agents = res.data?.agents ?? res.data ?? []
      return renderAgentList(agents)
    }

    case 'apical_get_agent': {
      const agentId = args?.agentId
      if (typeof agentId !== 'string' || !agentId) {
        return 'Invalid input: `agentId` is required.'
      }
      const res = await callApi('GET', `/api/dev/agents/${encodeURIComponent(agentId)}`)
      if (!res.ok) return res.error
      const agent = res.data?.agent ?? res.data
      return renderAgentDetail(agent)
    }

    case 'apical_run_agent': {
      const agentId = args?.agentId
      if (typeof agentId !== 'string' || !agentId) {
        return 'Invalid input: `agentId` is required.'
      }
      const res = await callApi('POST', '/api/dev/run', { agentId })
      if (!res.ok) return res.error
      return renderRunStarted(res.data, agentId)
    }

    case 'apical_get_report': {
      const runId = args?.runId
      if (typeof runId !== 'string' || !runId) {
        return 'Invalid input: `runId` is required.'
      }
      const res = await callApi('GET', `/api/dev/reports/${encodeURIComponent(runId)}`)
      if (!res.ok) return res.error
      return renderReport(res.data)
    }

    default:
      return `Unknown tool: ${name}`
  }
}

// ---------------------------------------------------------------------------
// Server wiring
// ---------------------------------------------------------------------------

const server = new Server(
  { name: 'apical-mcp', version: '0.1.0' },
  {
    capabilities: {
      tools: {},
    },
  },
)

// List tools — return the static tool definitions.
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema as any,
    })),
  }
})

// Call tool — dispatch by name, always return text content (so the LLM sees
// both successes and error messages as plain text).
server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const name = req.params.name as ToolName
  const args = req.params.arguments ?? {}

  try {
    const text = await handleToolCall(name, args)
    return {
      content: [{ type: 'text', text }],
    }
  } catch (err: any) {
    const message = err?.message || String(err)
    log(`error in ${name}: ${message}`)
    return {
      isError: true,
      content: [{ type: 'text', text: `apical-mcp error: ${message}` }],
    }
  }
})

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  log(`listening on stdio, API: ${API_URL}`)
}

main().catch((err) => {
  log(`fatal: ${err?.stack || err}`)
  process.exit(1)
})
