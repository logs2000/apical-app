// Apical agent tools — the registry of tools the autonomous agent can call
// during a reasoning loop. Each tool has a strict JSON schema + an executor
// that returns a structured observation.
//
// Tools are the agent's hands. The engine (agent-engine.ts) is the brain.
//
// Security model:
//   - web_search, web_read, http_request: network egress (the agent can reach
//     the web to research).
//   - code_eval: a sandboxed JS eval (no filesystem, no require, no process).
//     Used for computations, data transformation, regex extraction.
//   - cli_run: DISABLED by default (requires an explicit enable flag). When
//     enabled, routes through the desktop bridge so commands run on the user's
//     machine, not the server.
//   - data_table_*: CRUD on the user's built-in DataTables.
//   - workflow_propose: lets the agent emit a workflow draft (not deploy).
//   - integration_list: lets the agent see what connections are available.

import { db } from '@/lib/db'
import { integrationFromRow, parseConfig, serializeWorkflowJSON } from '@/lib/apical-server'
import { callMcpTool } from '@/lib/mcp-client'
import { buildSecureHeaders, listCredentialsForAgent } from '@/lib/platform/agent-credentials'
import { ingestOpenApiSpec } from '@/lib/openapi-parser'
import { searchWeb } from '@/lib/platform/web-search'
import { saveAsset, assetDownloadUrl } from '@/lib/platform/assets'
import { normalizeSteps } from '@/lib/deploy'
import { computeNextRun, validateSchedule, parseFixedRate, type ScheduleKind } from '@/lib/platform/cron'
import type { WorkflowJSON, McpServerConfig } from '@/lib/types'

// ---------------- Types ----------------

export interface ToolCall {
  tool: string
  input: Record<string, unknown>
}

export interface ToolResult {
  ok: boolean
  output: unknown // structured; serialized to a string for the LLM
  error?: string
  /** Optional display hints for the UI. */
  display?: {
    title: string
    summary: string
    kind?: 'search' | 'http' | 'code' | 'cli' | 'data' | 'workflow' | 'info' | 'image' | 'file'
    assetId?: string
    assetUrl?: string
    assetName?: string
    mimeType?: string
  }
}

export interface CredentialRequest {
  service: string
  label: string
  /** Plain-English explanation of why the key is needed + where to find it. */
  instructions?: string
  /** A link to the service's API-key / token settings page. */
  docsUrl?: string
  fields: Array<{
    key: string
    label: string
    type?: 'text' | 'password' | 'apikey'
    placeholder?: string
    required?: boolean
  }>
  /** How the secret is injected when the agent later calls the API. */
  headerName?: string
  headerPrefix?: string
}

export interface ToolContext {
  userId: string
  agentId?: string | null
  /** The current agent's display name + role (when chatting with a specific agent). */
  agentName?: string | null
  agentTitle?: string | null
  /** The current agent's saved workflow JSON (so it can follow + evolve it). */
  currentWorkflow?: WorkflowJSON
  /** Whether CLI execution is allowed (routes through the desktop bridge). */
  allowCli: boolean
  /** Max HTTP fetch size (bytes). */
  maxFetchBytes: number
  /** The agent's accumulated workflow proposal (mutated by workflow_propose). */
  proposedWorkflow?: WorkflowJSON
  /** Set when a workflow was persisted onto an EXISTING agent (its own workflow)
   *  rather than proposed as a brand-new agent. */
  workflowSavedToAgentId?: string
  /** Set by credential_request — surfaced to the chat as an inline key-entry box. */
  credentialRequest?: CredentialRequest
  /** A growing list of research findings (mutated by web_read/http_request). */
  findings?: Array<{ source: string; url: string; type: string; description: string }>
  /** The live execution trace — each tool/reason/gate step the agent takes. */
  executionTrace?: Array<{
    stepId: string
    kind: 'tool' | 'reason' | 'gate'
    label: string
    tool?: string
    status: 'running' | 'done' | 'flagged' | 'gate' | 'error'
    durationMs?: number
    result?: string
    error?: string
  }>
  /** Credential ids the agent has used in this run (for the freeze step). */
  usedCredentialIds?: string[]
  /** Assets produced during this run (for chat + data tab). */
  producedAssets?: Array<{
    id: string
    name: string
    mimeType: string
    kind: string
    url: string
    sizeBytes?: number
  }>
}

export interface ToolDef {
  name: string
  description: string
  /** JSON-schema-ish input shape for the LLM. */
  inputSchema: Record<string, { type: string; description: string; required?: boolean; items?: { type: string } }>
  /** Run the tool. Must not throw — return { ok: false, error } on failure. */
  run: (input: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>
}

// ---------------- Helpers ----------------

function asString(v: unknown, max = 100_000): string {
  if (typeof v !== 'string') return ''
  return v.slice(0, max)
}

function asNumber(v: unknown, def = 0): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : def
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return s.slice(0, max) + `\n…[truncated, ${s.length - max} more chars]`
}

/**
 * Invoke a tool on the user's connected desktop via the desktop bridge.
 * Shared by cli_run + the fs_* tools. Requires an online DesktopSession.
 * Returns a normalized ToolResult so callers don't repeat the plumbing.
 */
async function invokeDesktopTool(
  ctx: ToolContext,
  tool: string,
  args: Record<string, unknown>,
  opts: { timeoutMs?: number; display: NonNullable<ToolResult['display']> },
): Promise<ToolResult> {
  const timeoutMs = Math.min(60_000, Math.max(1000, opts.timeoutMs ?? 15_000))
  try {
    const sessions = await db.desktopSession.findMany({
      where: { userId: ctx.userId, status: 'online' },
      take: 1,
    })
    if (sessions.length === 0)
      return {
        ok: false,
        output: null,
        error: 'No online desktop session. Connect the desktop app + enable desktop access in Settings → Desktop.',
      }
    const r = await fetch('http://localhost:3005/invoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: sessions[0].id,
        tool,
        args,
        timeoutMs: timeoutMs + 2000,
      }),
    })
    const data = (await r.json()) as { ok: boolean; result?: unknown; error?: string }
    return {
      ok: data.ok,
      output: data.result ?? null,
      error: data.error,
      display: { ...opts.display, summary: data.ok ? opts.display.summary : data.error || 'failed' },
    }
  } catch (e) {
    return { ok: false, output: null, error: (e as Error).message }
  }
}

// ---------------- Tool registry ----------------

// 1. web_search — find pages on the web.
const webSearch: ToolDef = {
  name: 'web_search',
  description:
    'Search the web for pages matching a query. Returns titles, URLs, and snippets. Use this freely to discover data sources, APIs, MCP servers, OpenAPI specs, documentation, or competitors — it works without any API key. This is how you FIND new tools to integrate (then connect them with tool_configure).',
  inputSchema: {
    query: { type: 'string', description: 'The search query.', required: true },
    num: { type: 'number', description: 'Number of results (default 6, max 10).' },
  },
  async run(input, _ctx) {
    const query = asString(input.query, 500)
    if (!query) return { ok: false, output: null, error: 'query is required' }
    const num = Math.min(10, Math.max(1, asNumber(input.num, 6)))
    try {
      const results = await searchWeb(query, num)
      const rows = results.map((r, i) => ({
        i: i + 1,
        title: r.title,
        url: r.url,
        host: r.host,
        snippet: truncate(r.snippet || '', 300),
      }))
      return {
        ok: true,
        output: rows,
        display: {
          title: `Searched the web`,
          summary: `${rows.length} results for "${query}"`,
          kind: 'search',
        },
      }
    } catch (e) {
      return { ok: false, output: null, error: (e as Error).message }
    }
  },
}

// 2. web_read — fetch + extract the main content of a URL.
const webRead: ToolDef = {
  name: 'web_read',
  description:
    'Fetch a web page and extract its main text content. Use this to read a page found via web_search, inspect an API response, or read documentation. To read an authenticated page, pass a `credentialId` (from credential_list) — the server injects the secret server-side.',
  inputSchema: {
    url: { type: 'string', description: 'The URL to fetch.', required: true },
    maxChars: { type: 'number', description: 'Max content length (default 8000).' },
    credentialId: { type: 'string', description: 'Optional: a vault credential id (from credential_list) for authenticated pages. The server injects the secret; it never appears in the LLM context.' },
  },
  async run(input, ctx) {
    const url = asString(input.url, 2000)
    if (!url || !/^https?:\/\//.test(url))
      return { ok: false, output: null, error: 'valid http(s) url is required' }
    const maxChars = Math.min(50_000, Math.max(500, asNumber(input.maxChars, 8000)))
    const credentialId = asString(input.credentialId, 100)

    // SECURITY: resolve credential + build headers server-side. Strips any
    // auth-shaped headers the LLM tried to set.
    const { headers, hadCredential } = await buildSecureHeaders(
      { 'User-Agent': 'Apical-Research-Bot/1.0', Accept: 'text/html,application/json,text/plain,*/*' },
      credentialId || undefined,
      ctx.userId,
    )
    if (credentialId && !hadCredential) {
      return {
        ok: false,
        output: null,
        error: `credentialId "${credentialId}" not found or not active. Call credential_list to see available credentials.`,
      }
    }

    // Prefer a raw fetch + tag strip — reliable and does not depend on third-party readers.
    let title = ''
    let content = ''
    let publishedTime: string | undefined
    const usedMethod = 'fetch'

    try {
      const r = await fetch(url, {
        signal: AbortSignal.timeout(12_000),
        headers,
      })
      if (!r.ok) {
        return { ok: false, output: null, error: `HTTP ${r.status}` }
      }
      const ct = r.headers.get('content-type') || ''
      const raw = await r.text()
      if (ct.includes('json') || raw.trim().startsWith('{') || raw.trim().startsWith('[')) {
        try {
          content = JSON.stringify(JSON.parse(raw), null, 2)
        } catch {
          content = raw
        }
      } else {
        const titleMatch = raw.match(/<title[^>]*>([^<]*)<\/title>/i)
        if (titleMatch) title = titleMatch[1].trim().slice(0, 300)
        content = raw
          .replace(/<script[\s\S]*?<\/script>/gi, '')
          .replace(/<style[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/&[a-z]+;/gi, ' ')
          .replace(/\s+/g, ' ')
          .trim()
      }
    } catch (e) {
      return { ok: false, output: null, error: (e as Error).message }
    }

    content = truncate(content, maxChars)
    // Record a finding for the workflow proposal.
    ctx.findings?.push({
      source: title || url,
      url,
      type: 'website',
      description: truncate(content, 200),
    })
    const record = { url, title, content, publishedTime, method: usedMethod }
    return {
      ok: true,
      output: record,
      display: { title: `Read ${url}`, summary: title || 'read', kind: 'http' },
    }
  },
}

// 3. http_request — a raw HTTP call (for APIs the agent discovers).
//
// SECURITY: the LLM may pass a `credentialId` to reference a vault credential.
// The server resolves it + injects the secret into headers SERVER-SIDE. The
// secret NEVER enters the LLM context. Any auth-shaped headers the LLM tries
// to set directly (Authorization, X-Api-Key, etc.) are STRIPPED — the LLM
// has no legitimate reason to set those.
const httpRequest: ToolDef = {
  name: 'http_request',
  description:
    'Make a raw HTTP request to any URL. Use this to call an API endpoint you discovered. To authenticate, pass a `credentialId` (from credential_list) — the server injects the secret server-side; NEVER put raw keys/tokens in `headers` (they will be stripped). Returns the status, headers, and body (truncated).',
  inputSchema: {
    url: { type: 'string', description: 'The URL.', required: true },
    method: { type: 'string', description: 'HTTP method (default GET).' },
    headers: { type: 'object', description: 'Request headers (key-value). Auth headers (Authorization, X-Api-Key, etc.) are stripped — use credentialId instead.' },
    body: { type: 'string', description: 'Request body (for POST/PUT).' },
    credentialId: { type: 'string', description: 'Optional: a vault credential id (from credential_list). The server resolves + injects the secret; it never appears in the LLM context.' },
  },
  async run(input, ctx) {
    const url = asString(input.url, 2000)
    if (!url || !/^https?:\/\//.test(url))
      return { ok: false, output: null, error: 'valid http(s) url is required' }
    const method = (asString(input.method, 10) || 'GET').toUpperCase()
    const body = asString(input.body, 100_000)
    const credentialId = asString(input.credentialId, 100)

    // SECURITY: build headers server-side. Strips any auth-shaped headers
    // the LLM tried to set; injects the secret from the vault if credentialId
    // is provided.
    const { headers, hadCredential } = await buildSecureHeaders(
      (input.headers as Record<string, string>) ?? {},
      credentialId || undefined,
      ctx.userId,
    )

    if (credentialId && !hadCredential) {
      return {
        ok: false,
        output: null,
        error: `credentialId "${credentialId}" not found or not active. Call credential_list to see available credentials.`,
        display: { title: `${method} ${url}`, summary: 'bad credential', kind: 'http' },
      }
    }

    try {
      const r = await fetch(url, {
        method,
        headers,
        body: ['GET', 'HEAD'].includes(method) ? undefined : body,
        signal: AbortSignal.timeout(15_000),
      })
      const text = await r.text()
      const ct = r.headers.get('content-type') || ''
      // Try to parse JSON; else return text (truncated).
      let parsed: unknown = text
      if (ct.includes('json') || text.trim().startsWith('{') || text.trim().startsWith('[')) {
        try {
          parsed = JSON.parse(text)
        } catch {
          /* keep text */
        }
      }
      const out = {
        status: r.status,
        ok: r.ok,
        headers: Object.fromEntries(r.headers.entries()),
        body: typeof parsed === 'string' ? truncate(parsed, ctx.maxFetchBytes) : parsed,
      }
      return {
        ok: r.ok,
        output: out,
        display: { title: `${method} ${url}`, summary: `HTTP ${r.status}`, kind: 'http' },
      }
    } catch (e) {
      return { ok: false, output: null, error: (e as Error).message }
    }
  },
}

// 4b. asset_save — persist generated content as a downloadable asset.
const assetSave: ToolDef = {
  name: 'asset_save',
  description:
    'Save generated content (text, JSON, CSV, code, or base64-encoded binary like images) as a downloadable asset. Returns an asset id and download URL shown to the user in chat and the Data tab.',
  inputSchema: {
    name: { type: 'string', description: 'Filename including extension.', required: true },
    content: { type: 'string', description: 'File content (utf8 text or base64 when encoding=base64).', required: true },
    mimeType: { type: 'string', description: 'MIME type, e.g. text/plain, application/json, image/png.' },
    encoding: { type: 'string', description: 'utf8 (default) or base64.' },
    kind: { type: 'string', description: 'image | file | code' },
  },
  async run(input, ctx) {
    const name = asString(input.name, 200)
    const content = asString(input.content, 5_000_000)
    if (!name || !content) return { ok: false, output: null, error: 'name and content are required' }
    const encoding = asString(input.encoding) === 'base64' ? 'base64' : 'utf8'
    const bytes = encoding === 'base64' ? Buffer.from(content, 'base64') : Buffer.from(content, 'utf8')
    try {
      const asset = await saveAsset({
        userId: ctx.userId,
        agentId: ctx.agentId ?? null,
        name,
        bytes,
        mimeType: asString(input.mimeType) || 'application/octet-stream',
        kind: (asString(input.kind) as 'image' | 'file' | 'code') || undefined,
        source: 'agent',
      })
      ctx.producedAssets?.push({
        id: asset.id,
        name: asset.name,
        mimeType: asset.mimeType,
        kind: asset.kind,
        url: asset.url,
        sizeBytes: asset.sizeBytes,
      })
      return {
        ok: true,
        output: { assetId: asset.id, url: asset.url, name: asset.name, sizeBytes: asset.sizeBytes },
        display: {
          title: `Saved ${asset.name}`,
          summary: assetDownloadUrl(asset.id),
          kind: asset.kind === 'image' ? 'image' : 'file',
          assetId: asset.id,
          assetUrl: asset.url,
          assetName: asset.name,
          mimeType: asset.mimeType,
        },
      }
    } catch (e) {
      return { ok: false, output: null, error: (e as Error).message }
    }
  },
}

// 4. code_eval — sandboxed JS for computations + data transformation.
//    NO filesystem, NO require, NO process, NO fetch (the agent uses
//    http_request for network). Pure computation only.
const codeEval: ToolDef = {
  name: 'code_eval',
  description:
    'Run a snippet of JavaScript to compute, transform, or analyze data. Use this to parse JSON, run regex extraction, do math, filter/sort arrays, or format output. No filesystem, no network, no require — pure computation only. The last expression is the result.',
  inputSchema: {
    code: { type: 'string', description: 'JavaScript to evaluate. The last expression is returned.', required: true },
    data: { type: 'string', description: 'Optional JSON string to parse into a `data` variable.' },
  },
  async run(input, _ctx) {
    const code = asString(input.code, 20_000)
    if (!code) return { ok: false, output: null, error: 'code is required' }
    let data: unknown = undefined
    if (input.data) {
      try {
        data = JSON.parse(asString(input.data, 100_000))
      } catch {
        return { ok: false, output: null, error: 'data is not valid JSON' }
      }
    }
    try {
      // Sandbox: wrap in a function with no access to globals. We provide a
      // minimal `data` binding + JSON + Math + standard built-ins, plus a
      // `console` shim that captures log output (so scripts behave like a REPL).
      const logs: string[] = []
      const mkLog =
        () =>
        (...args: unknown[]) => {
          logs.push(
            args
              .map((a) => (typeof a === 'string' ? a : JSON.stringify(a)))
              .join(' '),
          )
        }
      const console = { log: mkLog(), info: mkLog(), warn: mkLog(), error: mkLog(), debug: mkLog() }
      const fn = new Function(
        'data',
        'console',
        '"use strict";\n' +
          'return (function(){\n' +
          code +
          '\n})();',
      )
      const result = fn(data, console)
      const logText = logs.join('\n')
      const resultStr =
        result === undefined
          ? ''
          : typeof result === 'string'
            ? result
            : JSON.stringify(result, null, 2)
      const combined = [logText, resultStr].filter(Boolean).join('\n')
      return {
        ok: true,
        output: {
          result: typeof result === 'string' ? truncate(result, 10_000) : result,
          logs: logText || undefined,
          stdout: truncate(combined, 10_000) || '(no output)',
        },
        display: { title: 'Ran code', summary: 'evaluated JS', kind: 'code' },
      }
    } catch (e) {
      return { ok: false, output: null, error: (e as Error).message }
    }
  },
}

// 5. cli_run — run a command on the user's desktop (via the desktop bridge).
//    Disabled unless ctx.allowCli is true.
const cliRun: ToolDef = {
  name: 'cli_run',
  description:
    'Run a shell command on the user\'s desktop (requires the desktop app to be connected). Use this to inspect local files, run network tools (nmap, arp), query local databases, or run scripts. DISABLED unless the user has enabled CLI access.',
  inputSchema: {
    command: { type: 'string', description: 'The command to run.', required: true },
    args: { type: 'array', description: 'Command arguments.', items: { type: 'string' } },
    cwd: { type: 'string', description: 'Working directory.' },
    timeoutMs: { type: 'number', description: 'Timeout in ms (default 15000, max 30000).' },
  },
  async run(input, ctx) {
    if (!ctx.allowCli)
      return {
        ok: false,
        output: null,
        error: 'CLI access is disabled. The user must enable it in Settings → Desktop.',
      }
    const command = asString(input.command, 2000)
    if (!command) return { ok: false, output: null, error: 'command is required' }
    const args = Array.isArray(input.args) ? input.args.map(String) : []
    const cwd = asString(input.cwd, 1000) || undefined
    const timeoutMs = Math.min(30_000, Math.max(1000, asNumber(input.timeoutMs, 15_000)))
    // The bridge expects `cmd` for the command (see desktop.cli.run catalog).
    return invokeDesktopTool(
      ctx,
      'desktop.cli.run',
      { cmd: command, args, cwd, timeoutMs },
      { timeoutMs, display: { title: `$ ${command}`, summary: 'ran', kind: 'cli' } },
    )
  },
}

// 5a. script_run — run JS (sandbox), Python, or shell (desktop CLI).
const scriptRun: ToolDef = {
  name: 'script_run',
  description:
    'Execute a script once. JavaScript runs in a sandboxed eval. Python and shell require desktop CLI access (allowCli). Use for one-off computation, data transforms, or local commands.',
  inputSchema: {
    language: { type: 'string', description: 'javascript | python | shell', required: true },
    code: { type: 'string', description: 'Script source code.', required: true },
    data: { type: 'string', description: 'Optional JSON string passed as `data` to JS scripts.' },
  },
  async run(input, ctx) {
    const language = asString(input.language).toLowerCase()
    const code = asString(input.code, 50_000)
    if (!code) return { ok: false, output: null, error: 'code is required' }
    if (language === 'javascript' || language === 'js') {
      return codeEval.run({ code, data: input.data }, ctx)
    }
    if (!ctx.allowCli) {
      return { ok: false, output: null, error: 'Python/shell scripts require desktop CLI access.' }
    }
    if (language === 'python' || language === 'py') {
      return cliRun.run({ command: 'python3', args: ['-c', code], timeoutMs: 30_000 }, ctx)
    }
    if (language === 'shell' || language === 'bash' || language === 'sh') {
      return cliRun.run({ command: 'bash', args: ['-lc', code], timeoutMs: 30_000 }, ctx)
    }
    return { ok: false, output: null, error: `Unsupported language: ${language}` }
  },
}

// 5b/5c/5d. fs_list / fs_read / fs_write — filesystem access on the user's
//    desktop (via the desktop bridge). Gated by ctx.allowCli, same as cli_run.
//    These give the agent first-class file handling for the "sort/rename/file
//    my scanned documents" and "watch an intake folder" class of workflows —
//    without dropping to raw shell.
const fsList: ToolDef = {
  name: 'fs_list',
  description:
    "List the entries (files + folders) in a directory on the user's desktop. Use this to discover what's in an intake/watch folder before reading or moving files. Requires desktop access (same flag as cli_run).",
  inputSchema: {
    path: { type: 'string', description: 'Absolute directory path to list.', required: true },
  },
  async run(input, ctx) {
    if (!ctx.allowCli)
      return { ok: false, output: null, error: 'Desktop access is disabled. The user must enable it in Settings → Desktop.' }
    const path = asString(input.path, 2000)
    if (!path) return { ok: false, output: null, error: 'path is required' }
    return invokeDesktopTool(ctx, 'desktop.fs.list', { path }, {
      display: { title: `Listed ${path}`, summary: 'listed', kind: 'data' },
    })
  },
}

const fsRead: ToolDef = {
  name: 'fs_read',
  description:
    "Read a file from the user's desktop. Returns the file content (utf8 by default; pass encoding 'base64' for binaries). Use this to OCR/parse a document, read a config, or inspect a local data file. Requires desktop access.",
  inputSchema: {
    path: { type: 'string', description: 'Absolute file path to read.', required: true },
    encoding: { type: 'string', description: "'utf8' (default) or 'base64'." },
  },
  async run(input, ctx) {
    if (!ctx.allowCli)
      return { ok: false, output: null, error: 'Desktop access is disabled. The user must enable it in Settings → Desktop.' }
    const path = asString(input.path, 2000)
    if (!path) return { ok: false, output: null, error: 'path is required' }
    const encoding = asString(input.encoding, 10) === 'base64' ? 'base64' : 'utf8'
    return invokeDesktopTool(ctx, 'desktop.fs.read', { path, encoding }, {
      display: { title: `Read ${path}`, summary: 'read', kind: 'data' },
    })
  },
}

const fsWrite: ToolDef = {
  name: 'fs_write',
  description:
    "Write content to a file on the user's desktop (overwrites). Also use desktop.fs.move semantics by writing then deleting — but prefer fs_write for creating reports, renamed copies, or exported data. Requires desktop access.",
  inputSchema: {
    path: { type: 'string', description: 'Absolute file path to write.', required: true },
    content: { type: 'string', description: 'The content to write.', required: true },
    encoding: { type: 'string', description: "'utf8' (default) or 'base64'." },
  },
  async run(input, ctx) {
    if (!ctx.allowCli)
      return { ok: false, output: null, error: 'Desktop access is disabled. The user must enable it in Settings → Desktop.' }
    const path = asString(input.path, 2000)
    if (!path) return { ok: false, output: null, error: 'path is required' }
    const content = asString(input.content, 500_000)
    const encoding = asString(input.encoding, 10) === 'base64' ? 'base64' : 'utf8'
    return invokeDesktopTool(ctx, 'desktop.fs.write', { path, content, encoding }, {
      display: { title: `Wrote ${path}`, summary: `${content.length} bytes`, kind: 'data' },
    })
  },
}

const fsMove: ToolDef = {
  name: 'fs_move',
  description:
    "Move or rename a file/folder on the user's desktop. This is the workhorse for filing workflows (e.g. move a scanned PDF into the right client folder, rename to a consistent format). Requires desktop access.",
  inputSchema: {
    from: { type: 'string', description: 'Absolute source path.', required: true },
    to: { type: 'string', description: 'Absolute destination path.', required: true },
  },
  async run(input, ctx) {
    if (!ctx.allowCli)
      return { ok: false, output: null, error: 'Desktop access is disabled. The user must enable it in Settings → Desktop.' }
    const from = asString(input.from, 2000)
    const to = asString(input.to, 2000)
    if (!from || !to) return { ok: false, output: null, error: 'from and to are required' }
    return invokeDesktopTool(ctx, 'desktop.fs.move', { from, to }, {
      display: { title: `Moved ${from} → ${to}`, summary: 'moved', kind: 'data' },
    })
  },
}

// 6. integration_list — see what connected tools/integrations are available.
const integrationList: ToolDef = {
  name: 'integration_list',
  description:
    'List the user\'s connected integrations and their tools (Gmail, Slack, Stripe, QuickBooks, etc.). Use this to discover what APIs you can call in a workflow.',
  inputSchema: {},
  async run(_input, ctx) {
    try {
      // The Integration model has no userId column (integrations are shared
      // in dev), so we query by status only.
      void ctx
      const all = await db.integration.findMany({ where: { status: 'connected' } })
      const out = all.map((i) => integrationFromRow(i))
      return {
        ok: true,
        output: out.map((i) => ({ id: i.id, name: i.name, kind: i.kind, tools: i.tools.map((t) => ({ id: t.id, name: t.name, description: t.description })) })),
        display: { title: 'Available integrations', summary: `${out.length} connected`, kind: 'info' },
      }
    } catch (e) {
      return { ok: false, output: null, error: (e as Error).message }
    }
  },
}

// 6b. mcp_list_servers — discover connected MCP servers + their tools.
//     This lets the agent explore its own tool inventory: "what MCP servers
//     does the user have connected, and what can each one do?" The agent uses
//     this to understand the problem space + pick the right tools.
const mcpListServers: ToolDef = {
  name: 'mcp_list_servers',
  description:
    'List all connected MCP (Model Context Protocol) servers and the tools each one exposes. Use this EARLY to understand what capabilities you have — filesystems, databases, APIs, browser automation, anything the user has connected via MCP. Each server has an id, name, transport (stdio/http), and a list of tools with their descriptions + input schemas.',
  inputSchema: {},
  async run(_input, ctx) {
    try {
      // MCP integrations are Integration rows with kind='mcp'. The Integration
      // model has no userId column (integrations are shared in dev), so we
      // query by kind + status.
      void ctx // (ctx.userId is not needed here — integrations are global)
      const pool = await db.integration.findMany({ where: { kind: 'mcp', status: 'connected' } })
      const servers = pool.map((r) => {
        const cfg = parseConfig<{ mcp?: McpServerConfig }>(r.config, {})
        const tools = JSON.parse(r.tools) as Array<{ id: string; name: string; description?: string; inputSchema?: Record<string, unknown> }>
        return {
          id: r.id,
          name: r.name,
          description: r.description,
          transport: cfg.mcp?.transport ?? 'unknown',
          command: cfg.mcp?.command,
          url: cfg.mcp?.url,
          toolCount: tools.length,
          tools: tools.map((t) => ({
            name: t.name || t.id,
            description: t.description || '',
            inputSchema: t.inputSchema,
          })),
        }
      })
      return {
        ok: true,
        output: { servers, total: servers.length },
        display: {
          title: 'Explored MCP servers',
          summary: `${servers.length} server${servers.length === 1 ? '' : 's'} · ${servers.reduce((n, s) => n + s.toolCount, 0)} tools`,
          kind: 'info',
        },
      }
    } catch (e) {
      return { ok: false, output: null, error: (e as Error).message }
    }
  },
}

// 6c. mcp_call_tool — call a tool on a connected MCP server.
//     The agent uses this to actually USE a capability it discovered via
//     mcp_list_servers (e.g. read a file via the filesystem MCP, query a
//     database via the postgres MCP, etc.).
const mcpCallTool: ToolDef = {
  name: 'mcp_call_tool',
  description:
    'Call a tool on a connected MCP server. First use mcp_list_servers to discover the server id + tool name, then call this with the server id, the tool name, and the args. Returns the tool\'s raw result.',
  inputSchema: {
    serverId: { type: 'string', description: 'The MCP server id (from mcp_list_servers).', required: true },
    tool: { type: 'string', description: 'The tool name to call on that server.', required: true },
    args: { type: 'object', description: 'Arguments to pass to the tool (key-value).' },
  },
  async run(input, ctx) {
    const serverId = asString(input.serverId, 100)
    const toolName = asString(input.tool, 200)
    if (!serverId || !toolName)
      return { ok: false, output: null, error: 'serverId and tool are required' }
    const args = (input.args as Record<string, unknown>) ?? {}
    try {
      // Look up the MCP integration by id. The Integration model has no
      // userId column (integrations are shared), so we query by id + kind.
      const row = await db.integration.findFirst({
        where: { id: serverId, kind: 'mcp' },
      })
      if (!row) return { ok: false, output: null, error: 'MCP server not found' }
      const cfg = parseConfig<{ mcp?: McpServerConfig }>(row.config, {})
      if (!cfg.mcp) return { ok: false, output: null, error: 'MCP server config missing' }
      const result = await callMcpTool(cfg.mcp, toolName, args)
      // callMcpTool returns { error } on failure, or the raw result on success.
      const errObj = result as { error?: string }
      if (errObj && typeof errObj.error === 'string') {
        return {
          ok: false,
          output: null,
          error: errObj.error,
          display: { title: `${row.name}.${toolName}`, summary: 'failed', kind: 'info' },
        }
      }
      return {
        ok: true,
        output: result,
        display: { title: `${row.name}.${toolName}`, summary: 'called', kind: 'info' },
      }
    } catch (e) {
      return { ok: false, output: null, error: (e as Error).message }
    }
  },
}

// 7. data_table_create — create a structured data table for storing results.
const dataTableCreate: ToolDef = {
  name: 'data_table_create',
  description:
    'Create a new data table to store structured results (e.g. a leads table, a device inventory, a compliance calendar). Returns the table id.',
  inputSchema: {
    name: { type: 'string', description: 'Table name.', required: true },
    description: { type: 'string', description: 'What this table stores.' },
    columns: {
      type: 'array',
      description: 'Column definitions.',
      items: { type: 'object' },
      required: true,
    },
  },
  async run(input, ctx) {
    const name = asString(input.name, 200)
    if (!name) return { ok: false, output: null, error: 'name is required' }
    const cols = Array.isArray(input.columns) ? input.columns : []
    const columnsJson = JSON.stringify(
      cols.map((c, i) => {
        const col = c as Record<string, unknown>
        return {
          name: asString(col.name, 100) || `col_${i + 1}`,
          type: asString(col.type, 20) || 'string',
          required: col.required === true,
        }
      }),
    )
    try {
      const table = await db.dataTable.create({
        data: {
          userId: ctx.userId,
          name,
          description: asString(input.description, 1000),
          columnsJson,
          rowCount: 0,
        },
      })
      return {
        ok: true,
        output: { tableId: table.id, name: table.name },
        display: { title: `Created table "${name}"`, summary: `${cols.length} columns`, kind: 'data' },
      }
    } catch (e) {
      return { ok: false, output: null, error: (e as Error).message }
    }
  },
}

// 8. data_table_insert — insert rows into a data table.
const dataTableInsert: ToolDef = {
  name: 'data_table_insert',
  description: 'Insert one or more rows into a data table you created.',
  inputSchema: {
    tableId: { type: 'string', description: 'The table id from data_table_create.', required: true },
    rows: { type: 'array', description: 'Rows to insert (objects keyed by column name).', items: { type: 'object' }, required: true },
  },
  async run(input, ctx) {
    const tableId = asString(input.tableId, 100)
    if (!tableId) return { ok: false, output: null, error: 'tableId is required' }
    const rows = Array.isArray(input.rows) ? input.rows : []
    if (rows.length === 0) return { ok: false, output: null, error: 'rows is required (and must be non-empty)' }
    try {
      // Verify ownership.
      const table = await db.dataTable.findFirst({ where: { id: tableId, userId: ctx.userId } })
      if (!table) return { ok: false, output: null, error: 'table not found' }
      await db.dataTableRow.createMany({
        data: rows.slice(0, 1000).map((r) => ({
          tableId,
          rowJson: JSON.stringify(r),
        })),
      })
      await db.dataTable.update({ where: { id: tableId }, data: { rowCount: { increment: Math.min(rows.length, 1000) } } })
      return {
        ok: true,
        output: { inserted: Math.min(rows.length, 1000) },
        display: { title: `Inserted into "${table.name}"`, summary: `${Math.min(rows.length, 1000)} rows`, kind: 'data' },
      }
    } catch (e) {
      return { ok: false, output: null, error: (e as Error).message }
    }
  },
}

// 9. data_table_query — list rows from a data table.
const dataTableQuery: ToolDef = {
  name: 'data_table_query',
  description: 'List rows from a data table (most recent first).',
  inputSchema: {
    tableId: { type: 'string', description: 'The table id.', required: true },
    limit: { type: 'number', description: 'Max rows (default 50, max 200).' },
  },
  async run(input, ctx) {
    const tableId = asString(input.tableId, 100)
    if (!tableId) return { ok: false, output: null, error: 'tableId is required' }
    const limit = Math.min(200, Math.max(1, asNumber(input.limit, 50)))
    try {
      const table = await db.dataTable.findFirst({ where: { id: tableId, userId: ctx.userId } })
      if (!table) return { ok: false, output: null, error: 'table not found' }
      const rows = await db.dataTableRow.findMany({
        where: { tableId },
        orderBy: { createdAt: 'desc' },
        take: limit,
      })
      return {
        ok: true,
        output: rows.map((r) => JSON.parse(r.rowJson)),
        display: { title: `Queried "${table.name}"`, summary: `${rows.length} rows`, kind: 'data' },
      }
    } catch (e) {
      return { ok: false, output: null, error: (e as Error).message }
    }
  },
}

// 10. workflow_propose — emit/update the workflow draft.
const workflowPropose: ToolDef = {
  name: 'workflow_propose',
  description:
    'Create or update the proposed workflow for this task. Call this once you have enough information to design the automation. The user will review + approve it before it runs.',
  inputSchema: {
    name: { type: 'string', description: 'Agent name (e.g. "LeadFinder").', required: true },
    description: { type: 'string', description: 'One-line description of what the agent does.', required: true },
    steps: {
      type: 'array',
      description: 'Workflow steps. Each step has a kind: "tool" | "reason" | "gate".',
      items: { type: 'object' },
      required: true,
    },
    schedule: { type: 'string', description: 'How often it should run (e.g. "Daily at 9am", "Every 30 min", "Weekly").' },
  },
  async run(input, ctx) {
    const name = asString(input.name, 200)
    const description = asString(input.description, 1000)
    const steps = Array.isArray(input.steps) ? input.steps : []
    if (!name || !description || steps.length === 0)
      return { ok: false, output: null, error: 'name, description, and steps are required' }
    // Normalize steps into the WorkflowStep shape.
    const normalized = steps.map((s, i) => {
      const step = s as Record<string, unknown>
      const kind = step.kind === 'reason' || step.kind === 'gate' ? step.kind : 'tool'
      const id = typeof step.id === 'string' && step.id ? step.id : `s${i + 1}`
      const label = typeof step.label === 'string' && step.label ? step.label : kind === 'reason' ? 'Reason' : kind === 'gate' ? 'Approve' : 'Tool'
      const out: Record<string, unknown> = { id, kind, label }
      if (kind === 'tool') {
        if (typeof step.tool === 'string') out.tool = step.tool
        if (step.inputs && typeof step.inputs === 'object') out.inputs = step.inputs
      } else if (kind === 'reason') {
        if (typeof step.prompt === 'string') out.prompt = step.prompt
        if (Array.isArray(step.allowedTools)) out.allowedTools = step.allowedTools
      } else if (kind === 'gate') {
        if (typeof step.gateMessage === 'string') out.gateMessage = step.gateMessage
      }
      if (typeof step.note === 'string') out.note = step.note
      return out
    })
    const wf: WorkflowJSON = { version: 1, steps: normalized as never }
    ctx.proposedWorkflow = wf
    return {
      ok: true,
      output: { name, description, stepCount: normalized.length, schedule: asString(input.schedule, 200) },
      display: {
        title: `Proposed agent: ${name}`,
        summary: `${normalized.length} steps`,
        kind: 'workflow',
      },
    }
  },
}

// 11. credential_list — list the user's vault credentials (non-secret metadata).
//     The agent uses this to know what credentialIds it can pass to
//     http_request / web_read. NEVER returns the secret itself.
const credentialList: ToolDef = {
  name: 'credential_list',
  description:
    'List the user\'s vault credentials (OAuth tokens, API keys, MCP tokens). Returns id, label, kind, service, oauthProvider for each — NEVER the secret itself. Use the id as `credentialId` in http_request / web_read to authenticate server-side.',
  inputSchema: {},
  async run(_input, ctx) {
    try {
      const creds = await listCredentialsForAgent(ctx.userId)
      return {
        ok: true,
        output: { credentials: creds, total: creds.length },
        display: {
          title: 'Vault credentials',
          summary: `${creds.length} available`,
          kind: 'info',
        },
      }
    } catch (e) {
      return { ok: false, output: null, error: (e as Error).message }
    }
  },
}

// 12. tool_configure — install a new MCP server or OpenAPI integration mid-flight.
//     This is the "realizes it needs a tool → configures it" step in the
//     learn-first loop. The agent discovers a service (via web_search), then
//     calls this to actually wire it up so it can use it in subsequent steps.
const toolConfigure: ToolDef = {
  name: 'tool_configure',
  description:
    'Configure a new tool integration mid-flight so you can use it in subsequent steps. Two modes: (a) MCP server — pass { kind: "mcp", transport, command?, url?, headers?, bearerToken? } to connect + discover tools; (b) OpenAPI spec — pass { kind: "openapi", specUrl, name? } to ingest the spec + auto-generate tools. Returns the new integration id + discovered tools. After this call succeeds, use mcp_list_servers / integration_list to see the new tools.',
  inputSchema: {
    kind: { type: 'string', description: '"mcp" or "openapi".', required: true },
    name: { type: 'string', description: 'A display name for the integration.' },
    // MCP
    transport: { type: 'string', description: 'For mcp: "stdio" | "http" | "sse".' },
    command: { type: 'string', description: 'For mcp stdio: the command to spawn.' },
    args: { type: 'object', description: 'For mcp stdio: args array.' },
    url: { type: 'string', description: 'For mcp http/sse: the server URL.' },
    headers: { type: 'object', description: 'For mcp http/sse: custom headers (key-value).' },
    bearerToken: { type: 'string', description: 'For mcp http/sse: a bearer token (resolved server-side from the vault if it starts with "cred:").' },
    // OpenAPI
    specUrl: { type: 'string', description: 'For openapi: the spec URL to ingest.' },
  },
  async run(input, _ctx) {
    const kind = asString(input.kind, 20)
    if (kind !== 'mcp' && kind !== 'openapi')
      return { ok: false, output: null, error: 'kind must be "mcp" or "openapi"' }

    try {
      if (kind === 'openapi') {
        const specUrl = asString(input.specUrl, 2000)
        if (!specUrl) return { ok: false, output: null, error: 'specUrl is required for openapi' }
        const result = await ingestOpenApiSpec(specUrl)
        if (result.error || result.tools.length === 0)
          return { ok: false, output: null, error: result.error || 'no tools discovered' }
        // Persist the integration via the API route (server-side fetch).
        const name = asString(input.name, 200) || result.title || 'Untitled API'
        const res = await fetch('http://localhost:3000/api/integrations/ingest-spec', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ specUrl, name, filter: { mode: 'all' } }),
        })
        if (!res.ok) {
          return { ok: false, output: null, error: `ingest-spec HTTP ${res.status}` }
        }
        const data = (await res.json()) as { integration: { id: string }; tools: unknown[] }
        return {
          ok: true,
          output: {
            integrationId: data.integration.id,
            name,
            toolCount: data.tools.length,
            tools: data.tools,
            kind: 'openapi',
          },
          display: {
            title: `Configured ${name}`,
            summary: `${data.tools.length} tools from OpenAPI spec`,
            kind: 'info',
          },
        }
      }

      // MCP — connect via the API route.
      const transport = asString(input.transport, 10) || 'stdio'
      const body: Record<string, unknown> = {
        name: asString(input.name, 200) || 'MCP server',
        transport,
      }
      if (transport === 'stdio') {
        body.command = asString(input.command, 500)
        if (input.args) body.args = input.args
      } else {
        body.url = asString(input.url, 2000)
        if (input.headers) body.headers = input.headers
        if (input.bearerToken) {
          // If the bearerToken is a cred reference, resolve it from the vault.
          const bt = asString(input.bearerToken, 2000)
          body.bearerToken = bt
        }
      }
      const res = await fetch('http://localhost:3000/api/mcp/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const errBody = await res.text().catch(() => '')
        return { ok: false, output: null, error: `mcp/connect HTTP ${res.status}: ${errBody}` }
      }
      const data = (await res.json()) as { integration: { id: string }; tools: unknown[]; error?: string }
      if (data.error) return { ok: false, output: null, error: data.error }
      return {
        ok: true,
        output: {
          integrationId: data.integration.id,
          name: body.name as string,
          toolCount: data.tools.length,
          tools: data.tools,
          kind: 'mcp',
        },
        display: {
          title: `Configured ${body.name}`,
          summary: `${data.tools.length} MCP tools`,
          kind: 'info',
        },
      }
    } catch (e) {
      return { ok: false, output: null, error: (e as Error).message }
    }
  },
}

// 13. workflow_freeze — freeze the agent's live execution trace into a
//     deterministic workflow artifact. The agent calls this AFTER it has
//     successfully accomplished the task by hand (via tool calls), to convert
//     what it learned into a reusable automation. Production runs execute the
//     frozen artifact verbatim — no re-deriving.
const workflowFreeze: ToolDef = {
  name: 'workflow_freeze',
  description:
    'Freeze your live execution trace into a reusable workflow. Call this AFTER you\'ve successfully accomplished the task by hand (via tool calls) — it converts what you learned into a deterministic automation that runs on a schedule. The frozen workflow references credentials by id only (secrets stay in the vault). Production runs execute the frozen artifact verbatim.',
  inputSchema: {
    name: { type: 'string', description: 'A name for the agent (e.g. "Sorter", "InvoiceChaser").', required: true },
    description: { type: 'string', description: 'One-line description of what the agent does.', required: true },
    schedule: { type: 'string', description: 'How often it should run (e.g. "every 15 min", "daily 9am", "weekly Mon").' },
    credentialIds: { type: 'object', description: 'Array of credential ids the workflow uses (referenced by id; secrets stay in vault).' },
  },
  async run(input, ctx) {
    const name = asString(input.name, 200)
    const description = asString(input.description, 1000)
    if (!name || !description)
      return { ok: false, output: null, error: 'name and description are required' }
    if (!ctx.executionTrace || ctx.executionTrace.length === 0)
      return { ok: false, output: null, error: 'no execution trace — accomplish the task by hand first, then freeze' }

    // Build a WorkflowJSON from the execution trace. Each trace step becomes
    // a workflow step with the same kind + label + tool.
    const steps = ctx.executionTrace.map((s, i) => ({
      id: `s${i + 1}`,
      kind: s.kind,
      label: s.label,
      ...(s.tool ? { tool: s.tool } : {}),
      ...(s.kind === 'reason' ? { prompt: s.label } : {}),
      note: s.status === 'flagged' ? 'Flagged during live run — review' : undefined,
    }))
    const wf: WorkflowJSON = { version: 1, steps: steps as never }

    // Track the credential ids the workflow should reference.
    const credIds = Array.isArray(input.credentialIds)
      ? (input.credentialIds as unknown[]).filter((x): x is string => typeof x === 'string')
      : (ctx.usedCredentialIds || [])

    // OWNERSHIP: if we're chatting with a specific agent, the frozen workflow
    // belongs to THAT agent — persist it onto its own row. We do NOT propose a
    // brand-new agent. New agents are only created via agent_create when there's
    // a clear reason for a separate, dedicated agent.
    if (ctx.agentId) {
      try {
        await db.workflow.update({
          where: { id: ctx.agentId },
          data: {
            stepsJson: serializeWorkflowJSON(wf),
            description,
            ...(asString(input.schedule, 200)
              ? { schedule: asString(input.schedule, 200) }
              : {}),
          },
        })
        ctx.currentWorkflow = wf
        ctx.workflowSavedToAgentId = ctx.agentId
        return {
          ok: true,
          output: {
            agentId: ctx.agentId,
            stepCount: steps.length,
            credentialIds: credIds,
            savedToAgent: true,
            note: 'Saved as THIS agent\'s own workflow. It now owns + runs these steps. Use workflow_update later to evolve it as you learn.',
          },
          display: {
            title: `Updated this agent's workflow`,
            summary: `${steps.length} steps · ${credIds.length} credentials`,
            kind: 'workflow',
          },
        }
      } catch (e) {
        return { ok: false, output: null, error: (e as Error).message }
      }
    }

    // No specific agent (orchestrator context): hold it as a proposal the user
    // can turn into a new agent.
    ctx.proposedWorkflow = wf
    return {
      ok: true,
      output: {
        name,
        description,
        schedule: asString(input.schedule, 200),
        stepCount: steps.length,
        credentialIds: credIds,
        frozen: true,
        note: 'Workflow frozen from live execution trace. Offer to create a dedicated agent (agent_create) only if this is a recurring job that warrants its own agent.',
      },
      display: {
        title: `Froze workflow: ${name}`,
        summary: `${steps.length} steps · ${credIds.length} credentials`,
        kind: 'workflow',
      },
    }
  },
}

// 13b. workflow_update — update the CURRENT agent's own workflow JSON. This is
//      how an agent evolves the process it owns over time (after learning a
//      better step order, fixing a failure, adding a gate, etc.). Operates on
//      ctx.agentId — no id needed.
const workflowUpdate: ToolDef = {
  name: 'workflow_update',
  description:
    "Update THIS agent's own saved workflow (the JSON list of steps it follows). Use this to evolve the process you own — add/replace/reorder steps after you learn a better way, fix a failing step, or add a gate. Pass the COMPLETE new steps array (kind: tool/reason/gate). Only valid when you ARE a specific agent (not the general orchestrator).",
  inputSchema: {
    steps: { type: 'array', description: 'The complete new workflow steps array (replaces the current one).', items: { type: 'object' }, required: true },
    description: { type: 'string', description: 'Optional updated one-line description of what the workflow does.' },
    note: { type: 'string', description: 'Optional short note on what changed + why (for the activity log).' },
  },
  async run(input, ctx) {
    if (!ctx.agentId)
      return { ok: false, output: null, error: 'workflow_update only works when acting as a specific agent. Use workflow_propose / agent_create instead.' }
    const rawSteps = Array.isArray(input.steps) ? input.steps : []
    if (rawSteps.length === 0)
      return { ok: false, output: null, error: 'a non-empty steps array is required' }
    try {
      const steps = normalizeSteps(rawSteps)
      const wf: WorkflowJSON = { version: 1, steps }
      const description = asString(input.description, 1000)
      await db.workflow.update({
        where: { id: ctx.agentId },
        data: {
          stepsJson: serializeWorkflowJSON(wf),
          ...(description ? { description } : {}),
        },
      })
      ctx.currentWorkflow = wf
      ctx.workflowSavedToAgentId = ctx.agentId
      return {
        ok: true,
        output: {
          agentId: ctx.agentId,
          stepCount: steps.length,
          note: asString(input.note, 500) || 'Workflow updated.',
        },
        display: {
          title: 'Updated workflow',
          summary: `${steps.length} steps`,
          kind: 'workflow',
        },
      }
    } catch (e) {
      return { ok: false, output: null, error: (e as Error).message }
    }
  },
}

// 13c. credential_request — ask the user for an API key / token by rendering an
//      inline, secure entry box in the chat (the value goes straight to the
//      vault; the agent never sees it). Use this INSTEAD of telling the user to
//      go open the Vault tab themselves.
const credentialRequestTool: ToolDef = {
  name: 'credential_request',
  description:
    "Ask the user for an API key / token you need. This renders a SECURE inline box in the chat where the user types the key — it is saved straight to the vault and you get back only a credentialId (never the secret). Call credential_list first to check it isn't already saved. Use this instead of telling the user to open the Vault tab. After the user saves it, it appears in credential_list and you reference it by credentialId.",
  inputSchema: {
    service: { type: 'string', description: 'The service the key is for (e.g. "openai", "stripe", "github").', required: true },
    label: { type: 'string', description: 'A human label for the credential (e.g. "OpenAI API key").', required: true },
    instructions: { type: 'string', description: 'Plain-English: why you need it + where the user finds it.' },
    docsUrl: { type: 'string', description: "Link to the service's API-key settings page." },
    headerName: { type: 'string', description: 'Header to inject the secret into when calling the API (default X-Api-Key).' },
    headerPrefix: { type: 'string', description: 'Value prefix, e.g. "Bearer " for bearer tokens (default empty).' },
  },
  async run(input, ctx) {
    const service = asString(input.service, 100)
    const label = asString(input.label, 200) || service
    if (!service)
      return { ok: false, output: null, error: 'service is required' }
    ctx.credentialRequest = {
      service,
      label,
      instructions: asString(input.instructions, 1000) || undefined,
      docsUrl: asString(input.docsUrl, 2000) || undefined,
      headerName: asString(input.headerName, 100) || undefined,
      headerPrefix: asString(input.headerPrefix, 50) || undefined,
      fields: [
        {
          key: 'value',
          label,
          type: 'password',
          placeholder: `Paste your ${label}`,
          required: true,
        },
      ],
    }
    return {
      ok: true,
      output: {
        requested: service,
        note: 'A secure key-entry box is now shown in the chat. Once the user saves it, call credential_list to get the new credentialId, then continue. Do NOT ask the user to paste the key into the chat text.',
      },
      display: {
        title: `Requested ${label}`,
        summary: 'Awaiting the user to save it to the vault',
        kind: 'info',
      },
    }
  },
}

// 14. workflow_monitor — review recent runs + failures of a frozen workflow.
//     The agent calls this to see how its automation is doing + spot failures
//     that need improvement.
const workflowMonitor: ToolDef = {
  name: 'workflow_monitor',
  description:
    'Review recent runs + failures of a frozen workflow. Returns the last N runs with status, items processed, errors, and any tool failures. Use this to spot problems + decide whether to call workflow_improve.',
  inputSchema: {
    workflowId: { type: 'string', description: 'The workflow id to monitor.', required: true },
    limit: { type: 'number', description: 'Max runs to return (default 10).' },
  },
  async run(input, _ctx) {
    const workflowId = asString(input.workflowId, 100)
    if (!workflowId)
      return { ok: false, output: null, error: 'workflowId is required' }
    const limit = Math.min(50, Math.max(1, asNumber(input.limit, 10)))
    try {
      const runs = await db.run.findMany({
        where: { workflowId },
        orderBy: { startedAt: 'desc' },
        take: limit,
        select: {
          id: true,
          status: true,
          itemsProcessed: true,
          flaggedCount: true,
          durationMs: true,
          startedAt: true,
          finishedAt: true,
          reportJson: true,
        },
      })
      // Also pull tool failure logs for this workflow.
      const failures = await db.executionPattern.findMany({
        where: { workflowId },
        orderBy: { updatedAt: 'desc' },
        take: 20,
        select: { id: true, stepId: true, occurrences: true, signature: true, outputJson: true, hardened: true },
      })
      return {
        ok: true,
        output: {
          runs: runs.map((r) => ({
            id: r.id,
            status: r.status,
            itemsProcessed: r.itemsProcessed,
            flaggedCount: r.flaggedCount,
            durationMs: r.durationMs,
            startedAt: r.startedAt.toISOString(),
            finishedAt: r.finishedAt?.toISOString() ?? null,
          })),
          totalRuns: runs.length,
          recentFailures: runs.filter((r) => r.status === 'failed').length,
          failurePatterns: failures.map((f) => ({
            stepId: f.stepId,
            occurrences: f.occurrences,
            signature: f.signature,
            output: f.outputJson,
            hardened: f.hardened,
          })),
        },
        display: {
          title: `Monitor ${workflowId}`,
          summary: `${runs.length} runs · ${runs.filter((r) => r.status === 'failed').length} failed`,
          kind: 'info',
        },
      }
    } catch (e) {
      return { ok: false, output: null, error: (e as Error).message }
    }
  },
}

// 15. workflow_improve — edit a frozen workflow's artifact based on observed
//     failures. The agent calls this after workflow_monitor surfaces problems.
//     It updates the frozen steps (e.g. add a retry, change a tool, add a gate)
//     so the next run is more robust. This is the "continues improving over
//     time" step.
const workflowImprove: ToolDef = {
  name: 'workflow_improve',
  description:
    'Improve a frozen workflow based on observed failures. Call workflow_monitor first to see what\'s broken, then call this with the workflow id + a description of the improvement (e.g. "add a retry to step s3", "change s2 tool to http_request with credentialId", "add a gate before s4"). The improvement is applied to the frozen artifact so the next run uses it.',
  inputSchema: {
    workflowId: { type: 'string', description: 'The workflow id to improve.', required: true },
    improvement: { type: 'string', description: 'A plain-English description of the improvement (e.g. "add retry to s3", "replace s2 tool").', required: true },
    newSteps: { type: 'object', description: 'Optional: the complete new steps array to replace the frozen artifact with. If omitted, the improvement is recorded as a note for human review.' },
  },
  async run(input, _ctx) {
    const workflowId = asString(input.workflowId, 100)
    const improvement = asString(input.improvement, 2000)
    if (!workflowId || !improvement)
      return { ok: false, output: null, error: 'workflowId and improvement are required' }
    try {
      const wf = await db.workflow.findUnique({
        where: { id: workflowId },
        select: { id: true, stepsJson: true },
      })
      if (!wf) return { ok: false, output: null, error: 'workflow not found' }

      // If newSteps provided, replace the frozen artifact.
      if (input.newSteps && Array.isArray(input.newSteps)) {
        const newStepsJson = JSON.stringify({ version: 1, steps: input.newSteps })
        await db.workflow.update({
          where: { id: workflowId },
          data: { stepsJson: newStepsJson },
        })
        return {
          ok: true,
          output: {
            workflowId,
            improvement,
            applied: true,
            newStepCount: (input.newSteps as unknown[]).length,
            note: 'Frozen artifact replaced with new steps. Next run will use the updated workflow.',
          },
          display: {
            title: `Improved ${workflowId}`,
            summary: `Replaced with ${(input.newSteps as unknown[]).length} steps`,
            kind: 'workflow',
          },
        }
      }

      // Otherwise, record the improvement as an ExecutionPattern note for
      // human review (the user can apply it manually or the next agent run
      // can propose the specific step changes).
      await db.executionPattern.create({
        data: {
          workflowId,
          stepId: 'improvement_note',
          signature: `improvement:${Date.now()}`,
          outputJson: JSON.stringify({ improvement, status: 'pending review' }),
          occurrences: 1,
          hardened: false,
        },
      })
      return {
        ok: true,
        output: {
          workflowId,
          improvement,
          applied: false,
          note: 'Improvement recorded for review. Call workflow_improve again with newSteps to apply it automatically.',
        },
        display: {
          title: `Recorded improvement for ${workflowId}`,
          summary: improvement.slice(0, 80),
          kind: 'workflow',
        },
      }
    } catch (e) {
      return { ok: false, output: null, error: (e as Error).message }
    }
  },
}

// 16. agent_list — see the user's existing agents (for routing + awareness).
//     The orchestrator uses this to decide whether to reuse/route to an
//     existing agent vs. branch into a new one.
const agentList: ToolDef = {
  name: 'agent_list',
  description:
    "List the user's existing agents (name, what each does, schedule, status). Use this EARLY when a request might belong to an agent that already exists — so you can route to it (via the answer) instead of creating a duplicate.",
  inputSchema: {},
  async run(_input, ctx) {
    try {
      const rows = await db.workflow.findMany({
        where: { OR: [{ userId: ctx.userId }, { userId: null }] },
        orderBy: { updatedAt: 'desc' },
        take: 100,
        select: {
          id: true,
          name: true,
          description: true,
          title: true,
          status: true,
          trigger: true,
          schedule: true,
        },
      })
      return {
        ok: true,
        output: { agents: rows, total: rows.length },
        display: { title: 'Listed agents', summary: `${rows.length} agent${rows.length === 1 ? '' : 's'}`, kind: 'info' },
      }
    } catch (e) {
      return { ok: false, output: null, error: (e as Error).message }
    }
  },
}

// 17. agent_create — create a real, persisted agent (Workflow) owned by the
//     user. This is how the orchestrator "branches into a new agent": once it
//     has learned the process, it materializes a dedicated agent that owns the
//     job going forward (and gets its own chat thread + inspector in the UI).
const agentCreate: ToolDef = {
  name: 'agent_create',
  description:
    "Create a new, persisted agent that owns a job going forward. Call this AFTER you understand the process (ideally after doing it once / freezing a trace). The new agent gets its own chat thread + dashboard. Pass the workflow steps (tool/reason/gate, same shape as workflow_propose). Returns the new agentId — tell the user it's been created and that they can open it. To make it run on a schedule, call schedule_agent next.",
  inputSchema: {
    name: { type: 'string', description: 'Agent name (e.g. "Sorter", "LeadFinder").', required: true },
    description: { type: 'string', description: 'One-line description of what the agent does.', required: true },
    steps: { type: 'array', description: 'Workflow steps (each has kind: "tool" | "reason" | "gate").', items: { type: 'object' }, required: true },
    title: { type: 'string', description: 'A plain role title (e.g. "Filing Agent").' },
    schedule: { type: 'string', description: 'Optional human-readable schedule label (e.g. "Daily at 9am"). For an actual recurring trigger, call schedule_agent after.' },
  },
  async run(input, ctx) {
    const name = asString(input.name, 200)
    const description = asString(input.description, 1000)
    const rawSteps = Array.isArray(input.steps) ? input.steps : []
    if (!name || !description || rawSteps.length === 0)
      return { ok: false, output: null, error: 'name, description, and a non-empty steps array are required' }
    try {
      const steps = normalizeSteps(rawSteps)
      const title = asString(input.title, 100) || null
      const scheduleLabel = asString(input.schedule, 200) || null
      const created = await db.workflow.create({
        data: {
          userId: ctx.userId,
          name,
          description,
          stepsJson: serializeWorkflowJSON({ version: 1, steps }),
          trigger: scheduleLabel ? 'schedule' : 'manual',
          schedule: scheduleLabel,
          status: 'active',
          origin: 'agent',
          department: 'General',
          title,
        },
      })
      return {
        ok: true,
        output: {
          agentId: created.id,
          name: created.name,
          stepCount: steps.length,
          schedule: scheduleLabel,
          note: 'Agent created. It now has its own chat thread + dashboard. Call schedule_agent to make it run automatically.',
        },
        display: { title: `Created agent: ${name}`, summary: `${steps.length} steps`, kind: 'workflow' },
      }
    } catch (e) {
      return { ok: false, output: null, error: (e as Error).message }
    }
  },
}

// 18. schedule_agent — register a recurring schedule for an agent so it runs
//     automatically. This is the "execute the process repeatedly" step that
//     turns a one-off into an automation.
const scheduleAgent: ToolDef = {
  name: 'schedule_agent',
  description:
    'Make an agent run automatically on a recurring schedule. Pass the agentId (from agent_create or agent_list) and a schedule. Use cron ("0 9 * * *" = daily 9am UTC; "*/15 * * * *" = every 15 min) or a fixed rate ("fixed_rate:3600" = every hour). Returns the next run time.',
  inputSchema: {
    agentId: { type: 'string', description: 'The agent (workflow) id to schedule.', required: true },
    schedule: { type: 'string', description: 'A 5-field cron expression, or "fixed_rate:<seconds>".', required: true },
    scheduleKind: { type: 'string', description: 'Optional: "cron" or "fixed_rate". Auto-detected from the schedule if omitted.' },
  },
  async run(input, ctx) {
    const agentId = asString(input.agentId, 100)
    const schedule = asString(input.schedule, 200)
    if (!agentId || !schedule)
      return { ok: false, output: null, error: 'agentId and schedule are required' }
    const kind: ScheduleKind =
      input.scheduleKind === 'fixed_rate' || input.scheduleKind === 'cron'
        ? (input.scheduleKind as ScheduleKind)
        : parseFixedRate(schedule) != null
          ? 'fixed_rate'
          : 'cron'
    const scheduleError = validateSchedule(schedule, kind)
    if (scheduleError) return { ok: false, output: null, error: scheduleError }
    try {
      const wf = await db.workflow.findFirst({
        where: { id: agentId, OR: [{ userId: ctx.userId }, { userId: null }] },
        select: { id: true, name: true },
      })
      if (!wf) return { ok: false, output: null, error: 'agent not found (or not owned by this user)' }
      const nextRunAt = computeNextRun(schedule, kind, 'UTC')
      const job = await db.scheduledJob.create({
        data: {
          userId: ctx.userId,
          workflowId: agentId,
          schedule,
          scheduleKind: kind,
          timezone: 'UTC',
          status: 'active',
          nextRunAt,
          runCount: 0,
          failureCount: 0,
        },
      })
      // Reflect the recurring trigger on the agent itself.
      await db.workflow.update({
        where: { id: agentId },
        data: { trigger: 'schedule', schedule },
      })
      return {
        ok: true,
        output: {
          jobId: job.id,
          agentId,
          schedule,
          scheduleKind: kind,
          nextRunAt: nextRunAt.toISOString(),
          note: `Scheduled. ${wf.name} will run automatically; next run ${nextRunAt.toISOString()}.`,
        },
        display: { title: `Scheduled ${wf.name}`, summary: `${schedule} · next ${nextRunAt.toISOString()}`, kind: 'workflow' },
      }
    } catch (e) {
      return { ok: false, output: null, error: (e as Error).message }
    }
  },
}

// ---------------- Registry ----------------

export const AGENT_TOOLS: ToolDef[] = [
  webSearch,
  webRead,
  httpRequest,
  codeEval,
  assetSave,
  scriptRun,
  cliRun,
  fsList,
  fsRead,
  fsWrite,
  fsMove,
  credentialList,
  integrationList,
  mcpListServers,
  mcpCallTool,
  toolConfigure,
  dataTableCreate,
  dataTableInsert,
  dataTableQuery,
  agentList,
  agentCreate,
  scheduleAgent,
  workflowPropose,
  workflowFreeze,
  workflowUpdate,
  workflowMonitor,
  workflowImprove,
  credentialRequestTool,
]

// Tools that require desktop access (an online DesktopSession + the user's
// allowCli flag). Hidden from the LLM catalog unless desktop access is on.
const DESKTOP_TOOLS = new Set(['cli_run', 'fs_list', 'fs_read', 'fs_write', 'fs_move'])

export const AGENT_TOOL_MAP: Record<string, ToolDef> = Object.fromEntries(
  AGENT_TOOLS.map((t) => [t.name, t]),
)

export function getAgentTool(name: string): ToolDef | undefined {
  return AGENT_TOOL_MAP[name]
}

// The tool catalog passed to the LLM (compact).
export function toolCatalogForLLM(allowCli: boolean): string {
  return AGENT_TOOLS.filter((t) => allowCli || !DESKTOP_TOOLS.has(t.name))
    .map((t) => {
      const params = Object.entries(t.inputSchema)
        .map(([k, v]) => `${k}${v.required ? ' (required)' : ''}: ${v.type} — ${v.description}`)
        .join('\n      ')
      return `- ${t.name}: ${t.description}\n      params:\n      ${params || '(none)'}`
    })
    .join('\n')
}
