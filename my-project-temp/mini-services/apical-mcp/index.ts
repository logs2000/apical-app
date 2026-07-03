#!/usr/bin/env bun
// Apical MCP server — stdio transport.
//
// The developer-facing surface of the Apical platform: a Cursor / Claude
// Code / Windsurf agent calls these tools to design, validate, deploy, run,
// and oversee automations on Apical. Covers the full loop:
//
//   search registry → fetch schema → validate → deploy → run (+wait) →
//   tail status → fetch report → rerun-from-step → usage/spend
//
// It speaks stdio JSON-RPC (the MCP wire format) and proxies to the Apical
// /v1 REST API over HTTP. All logging goes to stderr so the JSON-RPC channel
// on stdout stays clean.
//
// Env:
//   APICAL_API_KEY  (required) — a workspace API key (ap_sk_... / ap_pat_...)
//                                 from Settings → API Keys.
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
  log('Get your key from Apical (Settings → API Keys).')
  log('Then run: APICAL_API_KEY=ap_sk_... apical-mcp')
  process.exit(1)
}

if (!API_KEY.startsWith('ap_')) {
  log(`WARNING: APICAL_API_KEY doesn't look like an Apical key (expected "ap_sk_..." or "ap_pat_..." prefix). Got: "${API_KEY.slice(0, 8)}..."`)
}

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

/**
 * Call the Apical REST API. Returns either `{ ok: true, data }` or
 * `{ ok: false, error }` where `error` is a user-facing string.
 */
async function callApi(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<{ ok: true; data: any; status: number } | { ok: false; error: string }> {
  const url = `${API_URL}${path}`
  try {
    const res = await fetch(url, {
      method,
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
        'x-apical-source': 'mcp',
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })

    let parsed: any = null
    const text = await res.text()
    const ct = res.headers.get('content-type') || ''
    const isJson = ct.includes('application/json') || ct.includes('text/json')
    if (text) {
      try {
        parsed = JSON.parse(text)
      } catch {
        // Non-JSON body — handled below.
      }
    }

    if (!res.ok) {
      if (res.status === 401) return { ok: false, error: 'Invalid API key' }
      if (res.status === 402)
        return { ok: false, error: parsed?.error || 'Insufficient balance or spend limit reached' }
      if (res.status === 403)
        return { ok: false, error: parsed?.error || 'Missing scope on this API key' }
      if (parsed && typeof parsed === 'object') {
        const apiMsg = parsed.error || parsed.message
        // 422 validation failures include the issue list — surface it whole.
        if (apiMsg && Array.isArray(parsed.issues) && parsed.issues.length > 0) {
          const issueLines = parsed.issues
            .slice(0, 15)
            .map((i: any) => `  • ${i.path ?? ''}: ${i.message ?? JSON.stringify(i)}`)
            .join('\n')
          return { ok: false, error: `${apiMsg}\n${issueLines}` }
        }
        if (apiMsg) return { ok: false, error: String(apiMsg) }
      }
      if (!isJson || !parsed) {
        return {
          ok: false,
          error: `Apical endpoint returned HTTP ${res.status} with a non-JSON body — is the route implemented? (url: ${url})`,
        }
      }
      return { ok: false, error: `HTTP ${res.status}` }
    }

    if (!isJson || parsed === null) {
      return {
        ok: false,
        error: `Apical endpoint returned a non-JSON response (HTTP ${res.status}) — wrong URL? (url: ${url})`,
      }
    }

    return { ok: true, data: parsed, status: res.status }
  } catch (err: any) {
    const reason = err?.name === 'TypeError' ? 'network' : (err?.message || 'unknown')
    log(`fetch failed for ${method} ${url}: ${reason}`)
    return {
      ok: false,
      error: `Could not reach Apical at ${API_URL} — is the app running?`,
    }
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const TOOLS = [
  {
    name: 'apical_search_registry',
    description:
      'Search the Apical connector registry (MCP servers, OpenAPI integrations, curated catalog) plus the workspace\'s installed integrations. Use this FIRST to find integration ids to reference in workflow steps. Returns id, name, kind, and tool names per integration.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Free-text search, e.g. "slack", "sheets", "stripe". Omit to list everything.' },
      },
    },
  },
  {
    name: 'apical_get_schema',
    description:
      'Fetch the WorkflowJSON v2 JSON Schema — the contract every workflow document must satisfy. Read this before writing a workflow by hand. Also see the examples index at /schemas/workflow/examples/.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'apical_validate',
    description:
      'Validate a WorkflowJSON document WITHOUT saving anything: JSON Schema, unique step ids, {{stepId.field}} references, integration refs exist in the workspace, credential refs resolve (warnings). Always validate before apical_deploy.',
    inputSchema: {
      type: 'object',
      properties: {
        workflow: { type: 'object', description: 'The WorkflowJSON v2 document ({"version":2,"steps":[...]}).' },
      },
      required: ['workflow'],
    },
  },
  {
    name: 'apical_deploy',
    description:
      'Deploy an automation: create an Apical workflow from a WorkflowJSON v2 document. The document is validated first — deploy fails with the issue list if invalid. Returns the new workflow id.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'The workflow\'s display name.' },
        workflow: { type: 'object', description: 'The WorkflowJSON v2 document ({"version":2,"steps":[...]}).' },
        description: { type: 'string', description: 'Optional description.' },
      },
      required: ['name', 'workflow'],
    },
  },
  {
    name: 'apical_generate',
    description:
      'Generate a workflow from a natural-language spec: Apical designs the WorkflowJSON, validates it, and saves it as a draft. Blocks until the job finishes (up to ~90s). Returns the new workflow id or the failure reason.',
    inputSchema: {
      type: 'object',
      properties: {
        spec: { type: 'string', description: 'What the automation should do, in plain language. Be specific about sources, destinations, and conditions.' },
        name: { type: 'string', description: 'Optional workflow display name.' },
      },
      required: ['spec'],
    },
  },
  {
    name: 'apical_list_workflows',
    description:
      'List the workspace\'s workflows. Returns one line per workflow: name, status, run count, and id.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'apical_get_workflow',
    description:
      'Get one workflow\'s detail — name, status, schedule, the step list (each: id, kind, label), and run stats.',
    inputSchema: {
      type: 'object',
      properties: {
        workflowId: { type: 'string', description: 'The Apical workflow id.' },
      },
      required: ['workflowId'],
    },
  },
  {
    name: 'apical_run',
    description:
      'Trigger a run of a workflow. With wait=true (default) blocks until the run finishes (up to 60s) and returns the report; with wait=false returns the run id immediately for polling via apical_run_status. Supports an idempotencyKey to make retried calls safe.',
    inputSchema: {
      type: 'object',
      properties: {
        workflowId: { type: 'string', description: 'The Apical workflow id to run.' },
        wait: { type: 'boolean', description: 'Block until the run completes (default true).' },
        idempotencyKey: { type: 'string', description: 'Optional: retried calls with the same key return the same run.' },
      },
      required: ['workflowId'],
    },
  },
  {
    name: 'apical_run_status',
    description:
      'Get a run\'s current status, per-step progress (including step errors), and the report once finished. Use to tail an async run or diagnose a failure before apical_rerun.',
    inputSchema: {
      type: 'object',
      properties: {
        runId: { type: 'string', description: 'The Apical run id.' },
      },
      required: ['runId'],
    },
  },
  {
    name: 'apical_rerun',
    description:
      'Re-execute a FAILED run as a new run, starting from the failed step (default) or an explicit fromStepId. Prior successful step outputs are carried over.',
    inputSchema: {
      type: 'object',
      properties: {
        runId: { type: 'string', description: 'The failed run id.' },
        fromStepId: { type: 'string', description: 'Optional: restart from this step instead of the failed one.' },
      },
      required: ['runId'],
    },
  },
  {
    name: 'apical_usage',
    description:
      'Get workspace usage and spend: balance, plan, run counts, per-key spend vs limits. Use to check budget before triggering many runs.',
    inputSchema: {
      type: 'object',
      properties: {
        days: { type: 'number', description: 'Lookback window in days (default 30, max 90).' },
      },
    },
  },
] as const

// ---------------------------------------------------------------------------
// Renderers — compact text for the LLM
// ---------------------------------------------------------------------------

function renderRegistry(data: any): string {
  const catalog: any[] = Array.isArray(data?.catalog) ? data.catalog : []
  const integrations: any[] = Array.isArray(data?.integrations) ? data.integrations : []
  if (catalog.length === 0 && integrations.length === 0) {
    return 'No integrations matched. Workflows can still use code and http steps.'
  }
  const lines: string[] = []
  if (integrations.length > 0) {
    lines.push('Installed / registry integrations (reference by id in workflow steps):')
    for (const i of integrations.slice(0, 25)) {
      const tools = Array.isArray(i.tools)
        ? i.tools.slice(0, 8).map((t: any) => t?.id || t?.name).filter(Boolean).join(', ')
        : ''
      lines.push(`  ${i.name} [${i.kind}] — id: ${i.id}${tools ? ` — tools: ${tools}` : ''}`)
    }
  }
  if (catalog.length > 0) {
    lines.push('', 'Catalog (installable — not yet in the workspace):')
    for (const c of catalog.slice(0, 15)) {
      lines.push(`  ${c.name} [${c.kind}] — slug: ${c.slug} — ${c.description ?? ''}`.trimEnd())
    }
  }
  return lines.join('\n')
}

function renderValidation(data: any): string {
  const issues: any[] = Array.isArray(data?.issues) ? data.issues : []
  const warnings: any[] = Array.isArray(data?.warnings) ? data.warnings : []
  const lines: string[] = [data?.valid ? 'VALID ✓' : 'INVALID ✗']
  if (issues.length > 0) {
    lines.push('Issues (must fix):')
    for (const i of issues.slice(0, 20)) lines.push(`  • ${i.path ?? ''}: ${i.message}`)
  }
  if (warnings.length > 0) {
    lines.push('Warnings:')
    for (const w of warnings.slice(0, 10)) lines.push(`  • ${w.path ?? ''}: ${w.message}`)
  }
  return lines.join('\n')
}

function renderWorkflowList(workflows: any[]): string {
  if (!Array.isArray(workflows) || workflows.length === 0) {
    return 'No workflows yet. Use apical_deploy or apical_generate to create one.'
  }
  return workflows
    .map((w) => `${w?.name ?? '(unnamed)'} — ${w?.status ?? '—'} — ${w?.runsCount ?? 0} runs — id: ${w?.id ?? '?'}`)
    .join('\n')
}

function renderWorkflowDetail(w: any): string {
  if (!w) return 'Workflow not found.'
  const steps: any[] = (w?.workflow?.steps as any[]) ?? (w?.steps as any[]) ?? []
  const header = [
    w?.name ?? '(unnamed)',
    `Status: ${w?.status ?? '—'}`,
    `Trigger: ${w?.trigger ?? 'manual'}${w?.schedule ? ` (${w.schedule})` : ''}`,
    `Runs: ${w?.runsCount ?? 0}`,
    '',
    'Steps:',
  ].join('\n')
  if (steps.length === 0) return `${header}\n  (no steps)`
  const stepLines = steps.map((s) => {
    const tool = s?.tool ?? (s?.http ? `http ${s.http.method ?? ''}`.trim() : s?.code ? `code:${s.code.language}` : s?.mcp ? `mcp:${s.mcp.tool}` : '')
    return `  ${s?.id ?? '?'} [${s?.kind ?? '?'}] ${s?.label ?? ''}${tool ? ` → ${tool}` : ''}`
  })
  return `${header}\n${stepLines.join('\n')}`
}

function renderRun(data: any): string {
  const run = data?.run ?? data
  if (!run) return 'Run not found.'
  const lines: string[] = [
    `Run ${run.id ?? '?'} — ${run.status ?? '—'}`,
  ]
  const steps: any[] = Array.isArray(run.steps) ? run.steps : []
  if (steps.length > 0) {
    lines.push('Steps:')
    for (const s of steps) {
      const err = s?.error ? ` — ERROR: ${s.error}` : ''
      lines.push(`  ${s?.stepId ?? '?'} [${s?.status ?? '—'}] ${s?.label ?? ''}${err}`)
    }
  }
  const report = run.report
  if (report?.summary) {
    lines.push('', `Report: ${report.summary}`)
    if (Array.isArray(report.flags) && report.flags.length > 0) {
      lines.push('Flagged:')
      for (const f of report.flags.slice(0, 10)) {
        lines.push(`  • [${f?.stepId ?? '?'}] ${f?.item ?? ''} — ${f?.reason ?? ''}`.trimEnd())
      }
    }
  }
  return lines.join('\n')
}

function renderUsage(data: any): string {
  const ws = data?.workspace ?? {}
  const runs = data?.runs ?? {}
  const lines: string[] = [
    `Plan: ${ws.plan ?? '—'} — balance: ${((ws.balanceCents ?? 0) / 100).toFixed(2)} USD`,
    `Runs (last ${data?.period?.days ?? 30}d): ${runs.total ?? 0} total, ${runs.failed ?? 0} failed — ${runs.costCentsPerRun ?? 0}¢/run`,
    `Spend: ${((data?.spend?.totalCents ?? 0) / 100).toFixed(2)} USD across ${data?.spend?.events ?? 0} billed events`,
  ]
  const keys: any[] = Array.isArray(data?.keys) ? data.keys : []
  if (keys.length > 0) {
    lines.push('Keys:')
    for (const k of keys) {
      const limit = k.spendLimitCents > 0 ? `${k.spentCents}/${k.spendLimitCents}¢` : `${k.spentCents}¢ (no limit)`
      lines.push(`  ${k.label} (${k.keyPrefix}…) — spent ${limit}`)
    }
  }
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Tool dispatch
// ---------------------------------------------------------------------------

type ToolName = (typeof TOOLS)[number]['name']

async function handleToolCall(name: ToolName, args: any): Promise<string> {
  log(`→ ${name}`)

  switch (name) {
    case 'apical_search_registry': {
      const q = typeof args?.query === 'string' ? args.query : ''
      const res = await callApi('GET', `/v1/registry/integrations${q ? `?q=${encodeURIComponent(q)}` : ''}`)
      if (!res.ok) return res.error
      return renderRegistry(res.data)
    }

    case 'apical_get_schema': {
      const url = `${API_URL}/schemas/workflow/v2.json`
      try {
        const res = await fetch(url)
        if (!res.ok) return `Could not fetch schema (HTTP ${res.status}) from ${url}`
        const text = await res.text()
        return `WorkflowJSON v2 JSON Schema (from ${url}):\n${text}`
      } catch {
        return `Could not reach ${url} — is the app running?`
      }
    }

    case 'apical_validate': {
      const workflow = args?.workflow
      if (!workflow || typeof workflow !== 'object' || Array.isArray(workflow)) {
        return 'Invalid input: `workflow` must be a WorkflowJSON object ({"version":2,"steps":[...]}).'
      }
      const res = await callApi('POST', '/v1/workflows/validate', { workflow })
      if (!res.ok) return res.error
      return renderValidation(res.data)
    }

    case 'apical_deploy': {
      const workflow = args?.workflow
      const name = typeof args?.name === 'string' ? args.name.trim() : ''
      if (!name) return 'Invalid input: `name` is required.'
      if (!workflow || typeof workflow !== 'object' || Array.isArray(workflow)) {
        return 'Invalid input: `workflow` must be a WorkflowJSON object ({"version":2,"steps":[...]}).'
      }
      const res = await callApi('POST', '/v1/workflows', {
        name,
        description: typeof args?.description === 'string' ? args.description : undefined,
        workflow,
      })
      if (!res.ok) return res.error
      const wf = res.data?.workflow
      const warnings: any[] = Array.isArray(res.data?.warnings) ? res.data.warnings : []
      const warnText = warnings.length
        ? `\nWarnings:\n${warnings.map((w: any) => `  • ${w.message}`).join('\n')}`
        : ''
      return `Deployed "${wf?.name ?? name}". Workflow ID: ${wf?.id ?? '(unknown)'}${warnText}\nRun it with apical_run.`
    }

    case 'apical_generate': {
      const spec = typeof args?.spec === 'string' ? args.spec.trim() : ''
      if (!spec) return 'Invalid input: `spec` is required.'
      const start = await callApi('POST', '/v1/workflows/generate', {
        spec,
        name: typeof args?.name === 'string' ? args.name : undefined,
      })
      if (!start.ok) return start.error
      const jobId = start.data?.jobId
      if (!jobId) return 'Generation did not return a job id.'

      // Poll up to ~90s.
      for (let i = 0; i < 45; i++) {
        await sleep(2000)
        const poll = await callApi('GET', `/v1/workflows/generate/${encodeURIComponent(jobId)}`)
        if (!poll.ok) return poll.error
        const status = poll.data?.status
        if (status === 'completed') {
          const issues: any[] = Array.isArray(poll.data?.issues) ? poll.data.issues : []
          const warnText = issues.length
            ? `\nWarnings:\n${issues.map((w: any) => `  • ${w.message ?? JSON.stringify(w)}`).join('\n')}`
            : ''
          return `Generated workflow ${poll.data.workflowId} (saved as draft).${warnText}\nInspect with apical_get_workflow, then run with apical_run.`
        }
        if (status === 'failed') {
          const issues: any[] = Array.isArray(poll.data?.issues) ? poll.data.issues : []
          const issueText = issues.length
            ? `\nIssues:\n${issues.map((w: any) => `  • ${w.message ?? JSON.stringify(w)}`).join('\n')}`
            : ''
          return `Generation failed: ${poll.data?.error ?? 'unknown'}${issueText}`
        }
      }
      return `Generation still running — poll job ${jobId} later or check the Apical UI.`
    }

    case 'apical_list_workflows': {
      const res = await callApi('GET', '/v1/workflows')
      if (!res.ok) return res.error
      return renderWorkflowList(res.data?.workflows ?? [])
    }

    case 'apical_get_workflow': {
      const workflowId = args?.workflowId
      if (typeof workflowId !== 'string' || !workflowId) return 'Invalid input: `workflowId` is required.'
      const res = await callApi('GET', `/v1/workflows/${encodeURIComponent(workflowId)}`)
      if (!res.ok) return res.error
      return renderWorkflowDetail(res.data?.workflow ?? res.data)
    }

    case 'apical_run': {
      const workflowId = args?.workflowId
      if (typeof workflowId !== 'string' || !workflowId) return 'Invalid input: `workflowId` is required.'
      const wait = args?.wait !== false
      const body: any = {}
      if (typeof args?.idempotencyKey === 'string' && args.idempotencyKey) {
        body.idempotencyKey = args.idempotencyKey
      }
      const res = await callApi(
        'POST',
        `/v1/workflows/${encodeURIComponent(workflowId)}/run${wait ? '?wait=true' : ''}`,
        body,
      )
      if (!res.ok) return res.error
      if (!wait) {
        return `Started run ${res.data?.runId ?? '(unknown)'}. Status: ${res.data?.status ?? 'running'}. Use apical_run_status to tail it.`
      }
      if (res.data?.timedOut) {
        return `Run ${res.data?.runId} is still running after 60s. Use apical_run_status to keep tailing it.`
      }
      return renderRun(res.data)
    }

    case 'apical_run_status': {
      const runId = args?.runId
      if (typeof runId !== 'string' || !runId) return 'Invalid input: `runId` is required.'
      const res = await callApi('GET', `/v1/runs/${encodeURIComponent(runId)}`)
      if (!res.ok) return res.error
      return renderRun(res.data)
    }

    case 'apical_rerun': {
      const runId = args?.runId
      if (typeof runId !== 'string' || !runId) return 'Invalid input: `runId` is required.'
      const body: any = {}
      if (typeof args?.fromStepId === 'string' && args.fromStepId) body.fromStepId = args.fromStepId
      const res = await callApi('POST', `/v1/runs/${encodeURIComponent(runId)}/rerun`, body)
      if (!res.ok) return res.error
      return `Rerun started: ${res.data?.runId ?? '(unknown)'}. Use apical_run_status to tail it.`
    }

    case 'apical_usage': {
      const days = typeof args?.days === 'number' && args.days > 0 ? Math.min(args.days, 90) : null
      const res = await callApi('GET', `/v1/usage${days ? `?days=${days}` : ''}`)
      if (!res.ok) return res.error
      return renderUsage(res.data)
    }

    default:
      return `Unknown tool: ${name}`
  }
}

// ---------------------------------------------------------------------------
// Server wiring
// ---------------------------------------------------------------------------

const server = new Server(
  { name: 'apical-mcp', version: '0.2.0' },
  {
    capabilities: {
      tools: {},
    },
  },
)

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema as any,
    })),
  }
})

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
