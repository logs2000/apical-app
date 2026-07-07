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
//   - workflow_freeze: lets the agent save a proven automation.
//   - integration_list: lets the agent see what connections are available.

import { db } from '@/lib/db'
import type { ToolSpec } from '@/lib/platform/llm-gateway'
import { isAiProviderKeyRequest } from '@/lib/platform/llm-service'
import { integrationFromRow, parseConfig, serializeWorkflowJSON } from '@/lib/apical-server'
import { callMcpTool, connectMcpServer } from '@/lib/mcp-client'
import { buildSecureHeaders, listCredentialsForAgent } from '@/lib/platform/agent-credentials'
import { ingestOpenApiSpec } from '@/lib/openapi-parser'
import { searchWeb } from '@/lib/platform/web-search'
import { saveAsset, assetDownloadUrl } from '@/lib/platform/assets'
import { normalizeImage } from '@/lib/platform/images'
import { normalizeSteps } from '@/lib/deploy'
import { inferRuntimeFromSteps } from '@/lib/workflow-schema'
import { buildStepsForFreeze } from '@/lib/platform/workflow-distill'
import { saveWorkflowSteps, appendWorkflowStep, patchWorkflowStep } from '@/lib/platform/workflow-revisions'
import { validateWorkflowJSON } from '@/lib/workflow-schema'
import { validateSchedule, parseFixedRate, type ScheduleKind } from '@/lib/platform/cron'
import { buildPipedreamMcpConfig } from '@/lib/pipedream/mcp'
import { searchApps, getApp as getPipedreamApp } from '@/lib/pipedream/apps'
import { proxyFetch } from '@/lib/pipedream/proxy'
import { isPipedreamConfigured } from '@/lib/pipedream/config'
import type { WorkflowJSON, McpServerConfig, IntegrationConfig } from '@/lib/types'
import {
  WORKFLOW_META_TOOLS,
  MIN_SUBSTANTIVE_FREEZE_STEPS,
  normalizeTraceTool,
  isSubstantiveTraceStep,
  countSubstantiveTraceSteps,
  workflowStepsFromExecutionTrace,
  validateWorkflowFreezeTrace,
  savedWorkflowHasExecutableSteps,
  traceStepLabel,
  sanitizeTraceInput,
  type EngineTraceStep,
} from '@/lib/platform/workflow-trace'

export {
  WORKFLOW_META_TOOLS,
  MIN_SUBSTANTIVE_FREEZE_STEPS,
  normalizeTraceTool,
  isSubstantiveTraceStep,
  countSubstantiveTraceSteps,
  workflowStepsFromExecutionTrace,
  validateWorkflowFreezeTrace,
} from '@/lib/platform/workflow-trace'

// ---------------- Types ----------------

export interface ToolCall {
  tool: string
  input: Record<string, unknown>
}

export interface ToolResult {
  ok: boolean
  output: unknown // structured; serialized to a string for the LLM
  error?: string
  /** Vision output — normalized images the agent loop feeds to the model on
   *  the next LLM call (vision models only). Keep small: ≤4 per result. */
  images?: Array<{ mimeType: string; base64: string; label?: string }>
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

/** An account connection the agent asks the user to authorize via
 *  connection_request — rendered in chat as a "Connect your <App>" card that
 *  opens the Pipedream managed-auth window. */
export interface ConnectionRequest {
  /** Pipedream app name_slug, e.g. "slack". */
  app: string
  /** Display name, e.g. "Slack". */
  name: string
  /** App logo URL (Pipedream img_src). */
  imgSrc?: string
  /** Pipedream auth type: "oauth" | "keys" | "none". */
  authType?: string
  /** Plain-English: why the agent needs this connection. */
  reason?: string
}

/** A single checklist item the agent declares + updates via update_plan. */
export interface PlanItem {
  id: string
  label: string
  status: 'pending' | 'in_progress' | 'done'
}

export interface ClarificationOption {
  key: string
  label: string
  description?: string
}

/** A multiple-choice question the agent asks the user via ask_clarification,
 *  OR an approval gate before a high-stakes action via request_review. */
export interface ClarificationRequest {
  id: string
  question: string
  options: ClarificationOption[]
  multiple?: boolean
  /** Show a free-text "Other" input so the user can type a custom answer. */
  allowFreeText?: boolean
  /** Placeholder for the free-text input, e.g. "Type a folder path…". */
  freeTextPlaceholder?: string
  /** 'clarification' = disambiguate; 'review' = approval gate (default 'clarification'). */
  kind?: 'clarification' | 'review'
}

export interface ToolContext {
  userId: string
  /** Resolved lazily from userId; cached here after first lookup. */
  workspaceId?: string | null
  agentId?: string | null
  /** The current agent's display name (when chatting with a specific agent). */
  agentName?: string | null
  /** The current agent's saved workflow JSON (so it can follow + evolve it). */
  currentWorkflow?: WorkflowJSON
  /** Whether CLI execution is allowed (routes through the desktop bridge). */
  allowCli: boolean
  /** Max HTTP fetch size (bytes). */
  maxFetchBytes: number
  /** Optional workflow draft from workflow_freeze during the run. */
  proposedWorkflow?: WorkflowJSON
  /** Set when a workflow was persisted onto an EXISTING agent (its own workflow)
   *  rather than proposed as a brand-new agent. */
  workflowSavedToAgentId?: string
  /** Set when agent_create materializes a new agent (orchestrator only). */
  createdAgentId?: string
  createdAgentName?: string
  /** The user's goal for this turn — used to seed the new agent's thread. */
  userGoal?: string
  /** Set by credential_request — surfaced to the chat as inline key-entry boxes.
   *  An array so one turn can request several keys (one box each). */
  credentialRequests?: CredentialRequest[]
  /** Set by connection_request — surfaced to the chat as "Connect your <App>"
   *  cards that open the Pipedream managed-auth window. */
  connectionRequests?: ConnectionRequest[]
  /** Set by update_plan — the live checklist surfaced above the answer. */
  plan?: PlanItem[]
  /** Set by ask_clarification — a multiple-choice question that ends the turn. */
  clarification?: ClarificationRequest
  /** A growing list of research findings (mutated by web_read/http_request). */
  findings?: Array<{ source: string; url: string; type: string; description: string }>
  /** The live execution trace — each tool/reason/gate step the agent takes. */
  executionTrace?: Array<{
    stepId: string
    kind: 'tool' | 'reason' | 'gate'
    label: string
    tool?: string
    /** Tool arguments captured at call time (for workflow freeze). */
    input?: Record<string, unknown>
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
  /** Meta-tool failures (workflow_freeze, schedule_agent, etc.) — not in executionTrace. */
  metaToolFailures?: Array<{ tool: string; error: string }>
  /** The browser session opened for this run (lazily, by the browser tool);
   *  closed by the engine when the run ends. */
  browserSessionId?: string | null
  /** True when this run is itself a spawned subagent — blocks further spawning
   *  (no recursive subagent forests in v1). */
  isSubagent?: boolean
  /**
   * Abort signal from the originating HTTP request. Long-running tools
   * (network fetches, CLI/script runs) should pass this to their I/O so a
   * client disconnect cancels in-flight work instead of leaking it.
   */
  signal?: AbortSignal
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

const GENERIC_AGENT_NAME = /^(new agent|agent|untitled|my agent|assistant|workflow)(\s*\d*)?$/i

function isGenericAgentName(name: string): boolean {
  return GENERIC_AGENT_NAME.test(name.trim())
}

/**
 * Combined abort signal for a tool's I/O: fires on the per-call timeout OR
 * when the originating request is aborted (client disconnected / user hit
 * stop). Keeps in-flight fetches from outliving the agent turn.
 */
function toolAbortSignal(ctx: ToolContext, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs)
  return ctx.signal ? AbortSignal.any([timeout, ctx.signal]) : timeout
}

/** Resolve (and cache) the acting user's primary workspace id on the ctx. */
async function ctxWorkspaceId(ctx: ToolContext): Promise<string | null> {
  if (ctx.workspaceId !== undefined) return ctx.workspaceId
  const member = await db.workspaceMember.findFirst({
    where: { userId: ctx.userId },
    orderBy: { createdAt: 'asc' },
    select: { workspaceId: true },
  })
  let wsId = member?.workspaceId ?? null
  if (!wsId) {
    const legacy = await db.workspace.findFirst({
      where: { userId: ctx.userId },
      select: { id: true },
    })
    wsId = legacy?.id ?? null
  }
  ctx.workspaceId = wsId
  return wsId
}

/** Integration visibility filter: workspace instances + global registry rows. */
function integrationScope(wsId: string | null): { OR: Array<{ workspaceId: string | null }> } {
  return wsId
    ? { OR: [{ workspaceId: wsId }, { workspaceId: null }] }
    : { OR: [{ workspaceId: null }] }
}

import {
  invokeLocalDesktopTool,
  isLocalDesktopRuntime,
} from './desktop-local-runtime'
import { enforceGrantedRoots } from './granted-folders'

/**
 * Invoke a tool on the user's connected desktop via the desktop bridge.
 * Shared by cli_run + the fs_* tools. Requires an online DesktopSession.
 * When DESKTOP_LOCAL=true (Tauri), runs directly on the host filesystem.
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
    // fs tools are sandboxed to the user's granted folder roots (fail closed).
    const rootViolation = await enforceGrantedRoots(ctx.userId, tool, args)
    if (rootViolation) {
      return {
        ok: false,
        output: null,
        error: rootViolation,
        display: { ...opts.display, summary: 'blocked: folder not granted' },
      }
    }

    if (isLocalDesktopRuntime()) {
      const data = await invokeLocalDesktopTool(tool, args, timeoutMs)
      return {
        ok: data.ok,
        output: data.result ?? null,
        error: data.error,
        display: {
          ...opts.display,
          summary: data.ok ? opts.display.summary : data.error || 'failed',
        },
      }
    }

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
      signal: toolAbortSignal(ctx, timeoutMs + 5000),
    })
    const data = (await r.json()) as { ok: boolean; result?: unknown; error?: string }
    const err = data.error ?? ''
    const friendlyError =
      err.startsWith('remote_access_denied:')
        ? `Remote access blocked on the desktop (${err.slice('remote_access_denied:'.length)}). Open the Apical desktop app → Settings → Remote access to allow this, or run the workflow from the desktop.`
        : err
    return {
      ok: data.ok,
      output: data.result ?? null,
      error: data.ok ? undefined : friendlyError || 'failed',
      display: { ...opts.display, summary: data.ok ? opts.display.summary : friendlyError || 'failed' },
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
        signal: toolAbortSignal(ctx, 12_000),
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
    const { headers, hadCredential, pipedream } = await buildSecureHeaders(
      (input.headers as Record<string, string>) ?? {},
      credentialId || undefined,
      ctx.userId,
    )

    // Pipedream-managed credential: the token lives in Pipedream's vault, so
    // the request routes through their proxy (auth injected upstream). Same
    // insulation guarantee — the LLM only ever sees the response body.
    if (pipedream?.pipedreamAccountId) {
      ctx.usedCredentialIds = ctx.usedCredentialIds ?? []
      if (!ctx.usedCredentialIds.includes(credentialId)) {
        ctx.usedCredentialIds.push(credentialId)
      }
      const proxied = await proxyFetch(ctx.userId, pipedream.pipedreamAccountId, {
        url,
        method,
        headers,
        body: ['GET', 'HEAD'].includes(method) ? null : body,
      })
      let parsed: unknown = proxied.body
      try {
        parsed = JSON.parse(proxied.body)
      } catch {
        /* keep text */
      }
      if (!proxied.ok && proxied.error) {
        return {
          ok: false,
          output: { status: proxied.status, body: parsed },
          error: proxied.error,
          display: { title: `${method} ${url}`, summary: `proxy HTTP ${proxied.status}`, kind: 'http' },
        }
      }
      return {
        ok: proxied.ok,
        output: {
          status: proxied.status,
          ok: proxied.ok,
          body: typeof parsed === 'string' ? truncate(parsed, ctx.maxFetchBytes) : parsed,
          via: 'pipedream-proxy',
        },
        display: { title: `${method} ${url}`, summary: `HTTP ${proxied.status} (managed)`, kind: 'http' },
      }
    }

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
        signal: toolAbortSignal(ctx, 12_000),
      })
      const text = await Promise.race([
        r.text(),
        new Promise<string>((_, reject) =>
          setTimeout(() => reject(new Error('Response body read timed out')), 12_000),
        ),
      ])
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

// 4c. image_read — load an image so the model can SEE it (vision input).
const imageRead: ToolDef = {
  name: 'image_read',
  description:
    'Look at an image. Loads an image from an asset id, URL, or desktop file path and attaches it to your next reasoning step so you can see the pixels (vision models only; on non-vision models you get a text note instead). Use this to inspect screenshots, charts, photos, satellite tiles, or generated renders before deciding what to do next.',
  inputSchema: {
    assetId: { type: 'string', description: 'A UserAsset id (from asset_save, uploads, or job artifacts).' },
    url: { type: 'string', description: 'An http(s) or data: image URL.' },
    path: { type: 'string', description: "Absolute file path on the user's desktop (requires desktop access)." },
    label: { type: 'string', description: 'Short label for the image, e.g. "satellite tile row 2".' },
  },
  async run(input, ctx) {
    const assetId = asString(input.assetId, 100)
    const url = asString(input.url, 4000)
    const path = asString(input.path, 2000)
    const label = asString(input.label, 200) || undefined
    if (!assetId && !url && !path) {
      return { ok: false, output: null, error: 'one of assetId, url, or path is required' }
    }
    try {
      let normalized
      if (path) {
        if (!ctx.allowCli && !isLocalDesktopRuntime()) {
          return { ok: false, output: null, error: 'Desktop access is disabled. Use assetId or url instead.' }
        }
        const read = await fsRead.run({ path, encoding: 'base64' }, ctx)
        const content = read.ok ? (read.output as { content?: string } | null)?.content : null
        if (!content) return { ok: false, output: null, error: read.error || 'could not read image file' }
        normalized = await normalizeImage({ bytes: Buffer.from(content, 'base64'), label })
      } else {
        normalized = await normalizeImage({ assetId: assetId || undefined, userId: ctx.userId, url: url || undefined, label })
      }
      return {
        ok: true,
        output: {
          width: normalized.width,
          height: normalized.height,
          mimeType: normalized.mimeType,
          sizeBytes: normalized.sizeBytes,
          source: assetId ? `asset:${assetId}` : url || path,
          note: 'Image attached — it is visible to you in this turn.',
        },
        images: [{ mimeType: normalized.mimeType, base64: normalized.base64, label }],
        display: {
          title: label || 'Read image',
          summary: `${normalized.width}×${normalized.height} ${normalized.mimeType}`,
          kind: 'image',
          ...(assetId ? { assetId, assetUrl: assetDownloadUrl(assetId) } : {}),
        },
      }
    } catch (e) {
      return { ok: false, output: null, error: (e as Error).message }
    }
  },
}

// 4d/4e/4f/4g. job_* — async compute (submit → poll → collect). For work too
// heavy or slow for a normal tool call (photogrammetry, video CV, big data,
// long renders): the job runs detached in the worker (backend: server) or on
// the user's machine (backend: desktop), for up to hours, and produces
// downloadable artifacts. Poll job_status, then job_collect.
const jobSubmit: ToolDef = {
  name: 'job_submit',
  description:
    'Start a long-running compute job (heavy/slow work: photogrammetry, video frame extraction, large data crunching, 3D processing, long renders). Runs detached — it survives beyond one tool call. Returns a jobId to poll with job_status and gather with job_collect. Prefer this over script_run when the work takes more than a minute.',
  inputSchema: {
    label: { type: 'string', description: 'Short human label for the job.', required: true },
    language: { type: 'string', description: 'python | javascript | shell.', required: true },
    source: { type: 'string', description: 'Script source. Write output files to $APICAL_JOB_DIR/out (they become downloadable artifacts). Rewrite $APICAL_JOB_DIR/progress.json with {"progress":0..1,"note":"…"} to report progress.', required: true },
    packages: { type: 'array', description: 'npm/PyPI packages to install (max 20).', items: { type: 'string' } },
    args: { type: 'array', description: 'String args; also passed as JSON in APICAL_DATA.', items: { type: 'string' } },
    backend: { type: 'string', description: "'server' (default) or 'desktop' (runs on the user's machine — needed for local GPU/files)." },
    timeoutMinutes: { type: 'number', description: 'Max runtime in minutes (default 30, max 360).' },
  },
  async run(input, ctx) {
    const label = asString(input.label, 200)
    const language = asString(input.language, 20).toLowerCase()
    const source = asString(input.source, 200_000)
    if (!label || !source) return { ok: false, output: null, error: 'label and source are required' }
    if (!['python', 'javascript', 'shell'].includes(language)) {
      return { ok: false, output: null, error: 'language must be python, javascript, or shell' }
    }
    const backend = asString(input.backend, 20) === 'desktop' ? 'desktop' : 'server'
    if (backend === 'desktop' && !ctx.allowCli && !isLocalDesktopRuntime()) {
      return { ok: false, output: null, error: 'Desktop backend needs desktop access (Settings → Desktop). Use backend "server".' }
    }
    const packages = Array.isArray(input.packages) ? (input.packages as unknown[]).filter((p) => typeof p === 'string').slice(0, 20) as string[] : []
    const args = Array.isArray(input.args) ? (input.args as unknown[]).filter((a) => typeof a === 'string') as string[] : []
    const timeoutMinutes = Math.max(1, Math.min(360, Number(input.timeoutMinutes) || 30))
    try {
      const job = await db.job.create({
        data: {
          userId: ctx.userId,
          workspaceId: ctx.workspaceId ?? null,
          agentId: ctx.agentId ?? null,
          label,
          kind: language === 'shell' ? 'cli' : 'script',
          backend,
          timeoutMs: timeoutMinutes * 60_000,
          payloadJson: JSON.stringify({ language, source, packages, args }),
        },
      })
      return {
        ok: true,
        output: { jobId: job.id, backend, status: 'queued', note: 'Job queued. Poll job_status; gather with job_collect.' },
        display: { title: `Submitted job: ${label}`, summary: `${backend} · ${language}`, kind: 'code' },
      }
    } catch (e) {
      return { ok: false, output: null, error: (e as Error).message }
    }
  },
}

const jobStatus: ToolDef = {
  name: 'job_status',
  description: 'Check a job’s status and progress. Optionally wait up to a few seconds for it to advance. Returns status (queued|accepted|running|completed|failed|cancelled|timeout), progress (0–1), and a note.',
  inputSchema: {
    jobId: { type: 'string', description: 'The job id from job_submit.', required: true },
    waitSeconds: { type: 'number', description: 'Block up to this many seconds (max 55) for progress.' },
  },
  async run(input, ctx) {
    const jobId = asString(input.jobId, 100)
    if (!jobId) return { ok: false, output: null, error: 'jobId is required' }
    const waitMs = Math.max(0, Math.min(55, Number(input.waitSeconds) || 0)) * 1000
    const deadline = Date.now() + waitMs
    const terminal = new Set(['completed', 'failed', 'cancelled', 'timeout'])
    for (;;) {
      const job = await db.job.findFirst({ where: { id: jobId, userId: ctx.userId } })
      if (!job) return { ok: false, output: null, error: 'job not found' }
      if (terminal.has(job.status) || Date.now() >= deadline) {
        return {
          ok: true,
          output: {
            status: job.status,
            progress: job.progress ?? 0,
            note: job.progressNote ?? undefined,
            error: job.error ?? undefined,
            elapsedMs: job.startedAt ? Date.now() - +new Date(job.startedAt) : 0,
          },
          display: { title: `Job ${job.status}`, summary: job.progressNote ?? `${Math.round((job.progress ?? 0) * 100)}%`, kind: 'info' },
        }
      }
      await new Promise((r) => setTimeout(r, 2000))
    }
  },
}

const jobCollect: ToolDef = {
  name: 'job_collect',
  description: 'Gather a finished job’s result and artifacts. Returns the result summary and downloadable artifacts; image artifacts are shown to you so you can inspect the output. Call after job_status reports completed.',
  inputSchema: {
    jobId: { type: 'string', description: 'The job id from job_submit.', required: true },
  },
  async run(input, ctx) {
    const jobId = asString(input.jobId, 100)
    if (!jobId) return { ok: false, output: null, error: 'jobId is required' }
    const job = await db.job.findFirst({ where: { id: jobId, userId: ctx.userId } })
    if (!job) return { ok: false, output: null, error: 'job not found' }
    if (!['completed', 'failed', 'timeout', 'cancelled'].includes(job.status)) {
      return { ok: false, output: null, error: `job is still ${job.status} — poll job_status first` }
    }
    const artifactIds: string[] = job.artifactIdsJson ? (JSON.parse(job.artifactIdsJson) as string[]) : []
    const assets = artifactIds.length
      ? await db.userAsset.findMany({ where: { id: { in: artifactIds }, userId: ctx.userId } })
      : []
    const artifacts = assets.map((a) => ({ id: a.id, name: a.name, mimeType: a.mimeType, url: assetDownloadUrl(a.id) }))
    for (const a of assets) {
      ctx.producedAssets?.push({ id: a.id, name: a.name, mimeType: a.mimeType, kind: a.kind, url: assetDownloadUrl(a.id), sizeBytes: a.sizeBytes })
    }
    // Show image artifacts to the model (vision) so it can judge the output.
    const images: ToolResult['images'] = []
    for (const a of assets.filter((x) => x.mimeType.startsWith('image/')).slice(0, 4)) {
      try {
        const norm = await normalizeImage({ assetId: a.id, userId: ctx.userId, label: a.name })
        images.push({ mimeType: norm.mimeType, base64: norm.base64, label: a.name })
      } catch {
        /* skip unreadable artifact */
      }
    }
    const result = job.resultJson ? (JSON.parse(job.resultJson) as Record<string, unknown>) : null
    return {
      ok: job.status === 'completed',
      output: { status: job.status, error: job.error ?? undefined, result, artifacts },
      ...(images.length ? { images } : {}),
      display: { title: `Job ${job.status}: ${job.label}`, summary: `${artifacts.length} artifact(s)`, kind: 'file' },
    }
  },
}

const jobCancel: ToolDef = {
  name: 'job_cancel',
  description: 'Cancel a running or queued job.',
  inputSchema: { jobId: { type: 'string', description: 'The job id.', required: true } },
  async run(input, ctx) {
    const jobId = asString(input.jobId, 100)
    if (!jobId) return { ok: false, output: null, error: 'jobId is required' }
    const job = await db.job.findFirst({ where: { id: jobId, userId: ctx.userId }, select: { id: true } })
    if (!job) return { ok: false, output: null, error: 'job not found' }
    const { cancelJob } = await import('@/lib/platform/jobs')
    await cancelJob(jobId)
    return { ok: true, output: { jobId, status: 'cancelled' }, display: { title: 'Job cancelled', summary: jobId, kind: 'info' } }
  },
}

// agent_spawn / agent_status / agent_collect — live subagents. The agent
// delegates a bounded subtask to a fresh durable AgentRun (executed by the
// agent-worker) and collects its result. Freezing an agent_spawn+collect pair
// yields a "spawn" workflow step. A spawned run cannot spawn again (depth cap).
const SPAWN_SAFE_TOOLS = new Set([
  'web_search', 'web_read', 'http_request', 'code_eval', 'script_run',
  'image_read', 'browser', 'job_submit', 'job_status', 'job_collect', 'data_table_query',
])

const agentSpawn: ToolDef = {
  name: 'agent_spawn',
  description:
    'Delegate a bounded subtask to a temporary subagent that runs independently (in parallel with your other work) and returns a result. Use this to fan out — research several things at once, process items concurrently, or offload a self-contained investigation. Returns an agentRunId; check it with agent_status and gather the result with agent_collect. Subagents cannot spawn further subagents.',
  inputSchema: {
    goal: { type: 'string', description: 'The self-contained task for the subagent.', required: true },
    tools: { type: 'array', description: 'Tool names the subagent may use (subset of safe tools).', items: { type: 'string' } },
    maxIterations: { type: 'number', description: 'Max reasoning steps (default 16, max 40).' },
    outputShape: { type: 'string', description: 'Optional JSON describing the fields you want back.' },
  },
  async run(input, ctx) {
    if (ctx.isSubagent) {
      return { ok: false, output: null, error: 'subagents cannot spawn further subagents' }
    }
    const goal = asString(input.goal, 20_000)
    if (!goal) return { ok: false, output: null, error: 'goal is required' }
    const tools = Array.isArray(input.tools)
      ? (input.tools as unknown[]).filter((t) => typeof t === 'string' && SPAWN_SAFE_TOOLS.has(t)) as string[]
      : []
    let outputShape: Record<string, string> | undefined
    if (input.outputShape) {
      try {
        outputShape = JSON.parse(asString(input.outputShape, 4000)) as Record<string, string>
      } catch {
        /* ignore malformed shape */
      }
    }
    try {
      const run = await db.agentRun.create({
        data: {
          userId: ctx.userId,
          workspaceId: ctx.workspaceId ?? null,
          agentId: ctx.agentId ?? null,
          origin: 'spawn',
          goal,
          optsJson: JSON.stringify({
            maxIterations: Math.max(1, Math.min(40, Number(input.maxIterations) || 16)),
            source: 'workflow',
            allowedTools: tools.length ? tools : undefined,
            outputShape,
          }),
        },
      })
      return { ok: true, output: { agentRunId: run.id, status: 'queued' }, display: { title: 'Spawned subagent', summary: goal.slice(0, 80), kind: 'info' } }
    } catch (e) {
      return { ok: false, output: null, error: (e as Error).message }
    }
  },
}

const agentStatus: ToolDef = {
  name: 'agent_status',
  description: 'Check a spawned subagent’s status. Optionally wait up to a few seconds for it to progress.',
  inputSchema: {
    agentRunId: { type: 'string', description: 'From agent_spawn.', required: true },
    waitSeconds: { type: 'number', description: 'Block up to this many seconds (max 55).' },
  },
  async run(input, ctx) {
    const id = asString(input.agentRunId, 100)
    if (!id) return { ok: false, output: null, error: 'agentRunId is required' }
    const waitMs = Math.max(0, Math.min(55, Number(input.waitSeconds) || 0)) * 1000
    const deadline = Date.now() + waitMs
    const terminal = new Set(['completed', 'failed', 'cancelled', 'awaiting_input'])
    for (;;) {
      const run = await db.agentRun.findFirst({ where: { id, userId: ctx.userId }, select: { status: true, iterations: true, error: true } })
      if (!run) return { ok: false, output: null, error: 'subagent run not found' }
      if (terminal.has(run.status) || Date.now() >= deadline) {
        return { ok: true, output: { status: run.status, iterations: run.iterations, error: run.error ?? undefined } }
      }
      await new Promise((r) => setTimeout(r, 2000))
    }
  },
}

const agentCollect: ToolDef = {
  name: 'agent_collect',
  description: 'Gather a finished subagent’s answer (and structured output if you requested a shape). Call after agent_status reports completed.',
  inputSchema: { agentRunId: { type: 'string', description: 'From agent_spawn.', required: true } },
  async run(input, ctx) {
    const id = asString(input.agentRunId, 100)
    if (!id) return { ok: false, output: null, error: 'agentRunId is required' }
    const run = await db.agentRun.findFirst({ where: { id, userId: ctx.userId }, select: { status: true, finalJson: true, error: true } })
    if (!run) return { ok: false, output: null, error: 'subagent run not found' }
    if (!['completed', 'awaiting_input', 'failed', 'cancelled'].includes(run.status)) {
      return { ok: false, output: null, error: `subagent is still ${run.status} — poll agent_status first` }
    }
    const final = run.finalJson ? (JSON.parse(run.finalJson) as { answer?: string; structured?: unknown }) : {}
    return {
      ok: run.status === 'completed' || run.status === 'awaiting_input',
      output: { status: run.status, answer: final.answer ?? '', structured: final.structured, error: run.error ?? undefined },
      display: { title: `Subagent ${run.status}`, summary: (final.answer ?? '').slice(0, 80), kind: 'info' },
    }
  },
}

// job.run — deterministic submit+poll+collect for FROZEN WORKFLOWS only
// (hidden from the interactive LLM, which uses the async trio + its own loop).
// A frozen workflow can't poll across steps, so heavy compute freezes into one
// blocking node that waits for the job to finish.
const jobRun: ToolDef = {
  name: 'job.run',
  description: 'Run a compute job to completion (deterministic workflow step).',
  inputSchema: {
    label: { type: 'string', description: 'Job label.', required: true },
    language: { type: 'string', description: 'python | javascript | shell.', required: true },
    source: { type: 'string', description: 'Script source.', required: true },
    packages: { type: 'array', description: 'Packages to install.', items: { type: 'string' } },
    backend: { type: 'string', description: 'server | desktop.' },
    timeoutMinutes: { type: 'number', description: 'Max runtime (default 30, max 360).' },
  },
  async run(input, ctx) {
    const submitted = await jobSubmit.run(input, ctx)
    if (!submitted.ok) return submitted
    const jobId = (submitted.output as { jobId?: string }).jobId
    if (!jobId) return { ok: false, output: null, error: 'job submission returned no id' }
    const timeoutMs = Math.max(1, Math.min(360, Number(input.timeoutMinutes) || 30)) * 60_000
    const deadline = Date.now() + timeoutMs + 60_000
    const terminal = new Set(['completed', 'failed', 'cancelled', 'timeout'])
    for (;;) {
      if (ctx.signal?.aborted) return { ok: false, output: null, error: 'aborted' }
      const job = await db.job.findFirst({ where: { id: jobId, userId: ctx.userId }, select: { status: true } })
      if (!job) return { ok: false, output: null, error: 'job vanished' }
      if (terminal.has(job.status)) return jobCollect.run({ jobId }, ctx)
      if (Date.now() > deadline) return { ok: false, output: null, error: 'job did not finish within the step timeout' }
      await new Promise((r) => setTimeout(r, 3000))
    }
  },
}

// 4i. browser — drive a real headless browser (navigate/click/type/scroll)
// and SEE each page via screenshots. Runs on the agent-worker (Vercel can't
// run Chromium). This is how the agent reads pages that need JS, captures
// satellite/map imagery, grabs video frames, or automates a web UI. Gated on
// the worker being configured (toolSpecsForLLM), so it only appears when live.
const browserTool: ToolDef = {
  name: 'browser',
  description:
    'Control a real web browser and look at pages. Actions: navigate (url), click (selector), type (selector,text), press (key), scroll (deltaY), screenshot, back, wait, close. Each action returns the page title, a text summary of headings/links/text, and a screenshot you can see (vision). Use this for JS-heavy pages, capturing map/satellite imagery, grabbing frames, or automating a web UI — prefer http_request/web_read for simple static fetches.',
  inputSchema: {
    action: { type: 'string', description: 'navigate | click | type | press | scroll | screenshot | back | wait | close', required: true },
    url: { type: 'string', description: 'For navigate: the URL to open.' },
    selector: { type: 'string', description: 'CSS selector for click/type.' },
    text: { type: 'string', description: 'For type: the text to enter.' },
    key: { type: 'string', description: 'For press: the key (e.g. Enter).' },
    deltaY: { type: 'number', description: 'For scroll: pixels to scroll (default 600).' },
  },
  async run(input, ctx) {
    const { browserAvailable, openBrowserSession, browserAct, closeBrowserSession } = await import('@/lib/platform/browser-client')
    if (!browserAvailable()) {
      return { ok: false, output: null, error: 'Browser is not available (agent-worker not configured). Use web_read or http_request instead.' }
    }
    const action = asString(input.action, 20) as import('@/lib/platform/browser-client').BrowserActParams['action']
    if (!action) return { ok: false, output: null, error: 'action is required' }

    try {
      if (action === 'close') {
        if (ctx.browserSessionId) {
          await closeBrowserSession(ctx.browserSessionId)
          ctx.browserSessionId = null
        }
        return { ok: true, output: { closed: true }, display: { title: 'Closed browser', summary: '', kind: 'info' } }
      }
      if (!ctx.browserSessionId) {
        ctx.browserSessionId = await openBrowserSession(ctx.userId)
      }
      const result = await browserAct(ctx.browserSessionId, {
        action,
        url: asString(input.url, 4000) || undefined,
        selector: asString(input.selector, 1000) || undefined,
        text: asString(input.text, 10_000) || undefined,
        key: asString(input.key, 40) || undefined,
        deltaY: typeof input.deltaY === 'number' ? input.deltaY : undefined,
      })
      return {
        ok: true,
        output: { url: result.url, title: result.title, page: result.domSummary },
        ...(result.image ? { images: [result.image] } : {}),
        display: { title: `${action}: ${result.title || result.url}`, summary: result.url, kind: 'image' },
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
    if (!ctx.allowCli && !isLocalDesktopRuntime())
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

// 5a. script_run — run JS or Python on the server (with optional npm/PyPI
//     packages, installed automatically), or shell via the desktop CLI.
const scriptRun: ToolDef = {
  name: 'script_run',
  description:
    'Execute a script. JavaScript and Python run server-side and CAN use real packages: pass packages:["axios"] (npm) or packages:["requests"] (PyPI) and they are installed automatically before the run — never tell the user to install anything. JS: require("pkg") works when packages are given; a returned value is printed. Python: import as normal. Shell scripts run on the user desktop (requires CLI access). Use for computation, data transforms, API glue, file parsing — anything a small script solves.',
  inputSchema: {
    language: { type: 'string', description: 'javascript | python | shell', required: true },
    code: { type: 'string', description: 'Script source code.', required: true },
    packages: { type: 'array', description: 'Packages to install first: npm names for javascript, PyPI names for python. Installed into a cached env — fast on repeat runs.', items: { type: 'string' } },
    data: { type: 'string', description: 'Optional JSON string passed as `data` to the script.' },
  },
  async run(input, ctx) {
    const language = asString(input.language).toLowerCase()
    const code = asString(input.code, 50_000)
    if (!code) return { ok: false, output: null, error: 'code is required' }
    const packages = Array.isArray(input.packages)
      ? input.packages.map(String).filter(Boolean)
      : []
    const data = input.data ? asString(input.data, 100_000) : undefined

    if (language === 'javascript' || language === 'js') {
      // No packages → fast in-process sandbox. With packages → real Node run.
      if (packages.length === 0) return codeEval.run({ code, data: input.data }, ctx)
      const { runNodeScript } = await import('./script-runner')
      const res = await runNodeScript(code, packages, { data })
      return {
        ok: res.ok,
        output: res.ok
          ? { stdout: res.stdout || '(no output)', stderr: res.stderr || undefined }
          : null,
        error: res.ok ? undefined : res.error,
        display: { title: 'Ran Node script', summary: `packages: ${packages.join(', ')}`, kind: 'code' },
      }
    }
    if (language === 'python' || language === 'py') {
      // Prefer the server runtime (works on web + supports packages); fall
      // back to the desktop CLI when the server has no python3.
      const { runPythonScript } = await import('./script-runner')
      const res = await runPythonScript(code, packages, { data })
      if (!res.ok && /python3|ENOENT/i.test(res.error ?? '') && (ctx.allowCli || isLocalDesktopRuntime()) && packages.length === 0) {
        return cliRun.run({ command: 'python3', args: ['-c', code], timeoutMs: 30_000 }, ctx)
      }
      return {
        ok: res.ok,
        output: res.ok
          ? { stdout: res.stdout || '(no output)', stderr: res.stderr || undefined }
          : null,
        error: res.ok ? undefined : res.error,
        display: {
          title: 'Ran Python script',
          summary: packages.length ? `packages: ${packages.join(', ')}` : 'ran',
          kind: 'code',
        },
      }
    }
    if (language === 'shell' || language === 'bash' || language === 'sh') {
      if (!ctx.allowCli && !isLocalDesktopRuntime()) {
        return { ok: false, output: null, error: 'Shell scripts require desktop CLI access. Use javascript or python instead — both run server-side.' }
      }
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
    if (!ctx.allowCli && !isLocalDesktopRuntime())
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
    if (!ctx.allowCli && !isLocalDesktopRuntime())
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
    if (!ctx.allowCli && !isLocalDesktopRuntime())
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
    if (!ctx.allowCli && !isLocalDesktopRuntime())
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
      const wsId = await ctxWorkspaceId(ctx)
      const all = await db.integration.findMany({
        where: { status: 'connected', ...integrationScope(wsId) },
      })
      const out = all.map((i) => integrationFromRow(i))
      const providers = new Map(
        all.map((r) => [
          r.id,
          parseConfig<IntegrationConfig>(r.config, {}).pipedream ? 'pipedream' : 'direct',
        ]),
      )
      return {
        ok: true,
        output: out.map((i) => ({ id: i.id, name: i.name, kind: i.kind, provider: providers.get(i.id) ?? 'direct', tools: i.tools.map((t) => ({ id: t.id, name: t.name, description: t.description })) })),
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
      // MCP integrations are Integration rows with kind='mcp', scoped to the
      // user's workspace (plus global registry rows).
      const wsId = await ctxWorkspaceId(ctx)
      const pool = await db.integration.findMany({
        where: { kind: 'mcp', status: 'connected', ...integrationScope(wsId) },
      })
      const servers = pool.map((r) => {
        const cfg = parseConfig<IntegrationConfig>(r.config, {})
        const tools = JSON.parse(r.tools) as Array<{ id: string; name: string; description?: string; inputSchema?: Record<string, unknown> }>
        return {
          id: r.id,
          name: r.name,
          description: r.description,
          transport: cfg.mcp?.transport ?? 'unknown',
          command: cfg.mcp?.command,
          url: cfg.mcp?.url,
          // Managed connections (Pipedream) vs direct MCP servers.
          provider: cfg.pipedream ? 'pipedream' : 'direct',
          app: cfg.pipedream?.appSlug,
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
      // Look up the MCP integration by id, restricted to rows visible to the
      // user's workspace (own instances + global registry rows).
      const wsId = await ctxWorkspaceId(ctx)
      const row = await db.integration.findFirst({
        where: { id: serverId, kind: 'mcp', ...integrationScope(wsId) },
      })
      if (!row) return { ok: false, output: null, error: 'MCP server not found' }
      const cfg = parseConfig<IntegrationConfig>(row.config, {})
      // Pipedream-managed connection: auth headers are minted per call, in
      // memory only — the stored config carries no secrets.
      let mcpCfg = cfg.mcp
      if (cfg.pipedream) {
        const built = await buildPipedreamMcpConfig(ctx.userId, cfg.pipedream.appSlug)
        if (!built) {
          return {
            ok: false,
            output: null,
            error:
              'This integration uses a Pipedream-managed connection, but Pipedream is not configured or authentication failed.',
          }
        }
        mcpCfg = built
        // Record the connection as a dependency so workflow freeze captures it.
        ctx.usedCredentialIds = ctx.usedCredentialIds ?? []
        if (!ctx.usedCredentialIds.includes(cfg.pipedream.credentialId)) {
          ctx.usedCredentialIds.push(cfg.pipedream.credentialId)
        }
      }
      if (!mcpCfg) return { ok: false, output: null, error: 'MCP server config missing' }
      const result = await callMcpTool(mcpCfg, toolName, args)
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

// 10. credential_list — list the user's vault credentials (non-secret metadata).
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
  async run(input, ctx) {
    const kind = asString(input.kind, 20)
    if (kind !== 'mcp' && kind !== 'openapi')
      return { ok: false, output: null, error: 'kind must be "mcp" or "openapi"' }

    // Integrations created by the agent belong to the acting user's workspace
    // (direct lib calls — no unauthenticated localhost round-trips).
    const wsId = await ctxWorkspaceId(ctx)

    try {
      if (kind === 'openapi') {
        const specUrl = asString(input.specUrl, 2000)
        if (!specUrl) return { ok: false, output: null, error: 'specUrl is required for openapi' }
        const result = await ingestOpenApiSpec(specUrl)
        if (result.error || result.tools.length === 0)
          return { ok: false, output: null, error: result.error || 'no tools discovered' }
        const name = asString(input.name, 200) || result.title || 'Untitled API'
        const defaultScheme = result.authSchemes.length === 1 ? result.authSchemes[0] : null
        const created = await db.integration.create({
          data: {
            workspaceId: wsId,
            name,
            kind: 'api',
            description: `Auto-ingested from OpenAPI ${result.specVersion} spec on ${new Date().toISOString().slice(0, 10)}. ${result.totalOperations} operations.`,
            category: 'general',
            color: 'violet',
            status: 'connected',
            config: JSON.stringify({
              url: result.baseUrl,
              specUrl,
              auth: defaultScheme
                ? {
                    type: defaultScheme.type,
                    schemeName: defaultScheme.schemeName,
                    headerName: defaultScheme.headerName,
                    headerIn: defaultScheme.headerIn,
                  }
                : { type: 'none' },
              authSchemes: result.authSchemes,
            }),
            tools: '[]',
            source: 'private',
            visibility: 'private',
            authorLabel: null,
            installs: 0,
          },
        })
        const tools = result.tools.map((t) => ({ ...t, integrationId: created.id }))
        await db.integration.update({
          where: { id: created.id },
          data: { tools: JSON.stringify(tools) },
        })
        return {
          ok: true,
          output: {
            integrationId: created.id,
            name,
            toolCount: tools.length,
            tools: tools.slice(0, 40).map((t) => ({ id: t.id, name: t.name, description: t.description })),
            kind: 'openapi',
          },
          display: {
            title: `Configured ${name}`,
            summary: `${tools.length} tools from OpenAPI spec`,
            kind: 'info',
          },
        }
      }

      // MCP — connect + discover directly.
      const transport = asString(input.transport, 10) || 'stdio'
      const name = asString(input.name, 200) || 'MCP server'
      const config: McpServerConfig =
        transport === 'stdio'
          ? {
              transport: 'stdio',
              command: asString(input.command, 500) || undefined,
              args: Array.isArray(input.args)
                ? (input.args as unknown[]).map((a) => String(a))
                : undefined,
            }
          : {
              transport: transport === 'sse' ? 'sse' : 'http',
              url: asString(input.url, 2000) || undefined,
              headers:
                input.headers && typeof input.headers === 'object'
                  ? (input.headers as Record<string, string>)
                  : undefined,
              bearerToken: asString(input.bearerToken, 2000) || undefined,
            }
      if (config.transport === 'stdio' && !config.command) {
        return { ok: false, output: null, error: 'stdio transport requires a "command"' }
      }
      if (config.transport !== 'stdio' && !config.url) {
        return { ok: false, output: null, error: `${transport} transport requires a "url"` }
      }

      const discovered = await connectMcpServer(config)
      if (discovered.error || discovered.tools.length === 0) {
        return {
          ok: false,
          output: null,
          error: discovered.error || 'Connected but no tools were discovered',
        }
      }

      const created = await db.integration.create({
        data: {
          workspaceId: wsId,
          name,
          kind: 'mcp',
          description: `MCP server (${transport}) connected on ${new Date().toISOString().slice(0, 10)}.`,
          category: 'general',
          color: 'violet',
          status: 'connected',
          config: JSON.stringify({ mcp: config }),
          tools: '[]',
          source: 'private',
          visibility: 'private',
          authorLabel: null,
          installs: 0,
        },
      })
      const tools = discovered.tools.map((t) => ({ ...t, integrationId: created.id }))
      await db.integration.update({
        where: { id: created.id },
        data: { tools: JSON.stringify(tools) },
      })
      return {
        ok: true,
        output: {
          integrationId: created.id,
          name,
          toolCount: tools.length,
          tools: tools.slice(0, 40).map((t) => ({ id: t.id, name: t.name, description: t.description })),
          kind: 'mcp',
        },
        display: {
          title: `Configured ${name}`,
          summary: `${tools.length} MCP tools`,
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

// Shared {{...}} template-ref grammar, appended to every workflow-authoring
// tool description so the model never invents namespaces (e.g. {{lead.x}}).
const REF_GRAMMAR =
  ' Template refs in step fields: {{stepId.field}} (an EARLIER step\'s output), {{trigger.field}} (the trigger payload), {{cred:service.field}} (vault credential — colon, not dot), {{env:VAR}}. Inside a loop or map body ONLY, you may also use {{item}} / {{item.field}} (the current element) and {{$index}} (0-based position); loops also expose {{$iteration}}. Outside a loop/map body those per-item refs are invalid — never invent other namespaces like {{lead.x}}. Control-flow step kinds: "branch" ({ when: {left,op,right}, thenSteps[], elseSteps[] }), "loop" ({ loopOver: "{{s.rows}}" or until: {...}, bodySteps[], maxIterations }), "map" ({ itemsRef: "{{s.rows}}", bodySteps[], concurrency }). A map exposes {{mapStepId.outputs}} (array of each item\'s last body output) and {{mapStepId.count}}. Gates must stay at the top level (not inside a body).'

const workflowFreeze: ToolDef = {
  name: 'workflow_freeze',
  description:
    'Freeze an n8n-style production automation: tie together the proven steps from the work you just did into 2–8 deterministic nodes (code, HTTP, MCP, integrations, gates) that the runtime replays without an agent. Prefer workflow_step_append to capture single steps as you go during first-time work; call workflow_freeze to tie several steps together or to make the initial save. Optional "steps" array if you already designed the automation. Exploration tools are never saved.' +
    REF_GRAMMAR,
  inputSchema: {
    name: { type: 'string', description: 'A name for the agent (e.g. "Sorter", "InvoiceChaser").', required: true },
    description: { type: 'string', description: 'One-line description of what the agent does.', required: true },
    schedule: { type: 'string', description: 'How often it should run (e.g. "every 15 min", "daily 9am", "weekly Mon").' },
    credentialIds: { type: 'object', description: 'Array of credential ids the workflow uses (referenced by id; secrets stay in vault).' },
    steps: { type: 'array', description: 'Optional: your own distilled workflow steps (3–8 max, human labels + full inputs). If omitted, the server distills from the trace automatically.', items: { type: 'object' } },
  },
  async run(input, ctx) {
    const name = asString(input.name, 200)
    const description = asString(input.description, 1000)
    if (!name || !description)
      return { ok: false, output: null, error: 'name and description are required' }

    const validation = validateWorkflowFreezeTrace(ctx.executionTrace)
    const agentSteps = Array.isArray(input.steps) ? input.steps : undefined
    if (!validation.ok && !agentSteps?.length) {
      return { ok: false, output: null, error: validation.error }
    }

    const rawSteps = workflowStepsFromExecutionTrace((ctx.executionTrace ?? []) as EngineTraceStep[])
    const { steps, distilled } = await buildStepsForFreeze({
      userId: ctx.userId,
      trace: (ctx.executionTrace ?? []) as EngineTraceStep[],
      jobDescription: description,
      goal: ctx.userGoal,
      agentProvidedSteps: agentSteps,
      rawSteps,
    })

    if (steps.length < MIN_SUBSTANTIVE_FREEZE_STEPS) {
      return {
        ok: false,
        output: null,
        error: `Distilled workflow has only ${steps.length} step(s) — need at least ${MIN_SUBSTANTIVE_FREEZE_STEPS} executable steps with real parameters.`,
      }
    }

    const wf: WorkflowJSON = { version: 1, steps }

    // Track the credential ids the workflow should reference.
    const credIds = Array.isArray(input.credentialIds)
      ? (input.credentialIds as unknown[]).filter((x): x is string => typeof x === 'string')
      : (ctx.usedCredentialIds || [])

    // OWNERSHIP: if we're chatting with a specific agent, the frozen workflow
    // belongs to THAT agent — persist it onto its own row. We do NOT propose a
    // brand-new agent. New agents are only created via agent_create when there's
    // a clear reason for a separate, dedicated agent.
    if (ctx.agentId) {
      const saved = await persistAgentWorkflowSteps(ctx, steps, {
        description,
        schedule: asString(input.schedule, 200) || undefined,
      })
      if (!saved.ok) {
        return { ok: false, output: null, error: saved.error ?? 'failed to save workflow' }
      }
      ctx.currentWorkflow = wf
      ctx.workflowSavedToAgentId = ctx.agentId
      return {
        ok: true,
        output: {
          agentId: ctx.agentId,
          stepCount: saved.stepCount,
          distilled,
          credentialIds: credIds,
          savedToAgent: true,
          savedSteps: steps.map((s) => ({
            id: s.id,
            kind: s.kind,
            label: s.label,
            tool: s.tool,
            inputs: s.inputs,
            http: s.http,
            hardened: s.hardened,
          })),
          note:
            distilled
              ? `Saved a distilled production workflow (${saved.stepCount} steps) — not a verbatim copy of exploration. Describe ONLY savedSteps in your final answer.`
              : 'Saved as THIS agent\'s own workflow. Your final answer must describe ONLY the savedSteps above.',
        },
        display: {
          title: `Updated this agent's workflow`,
          summary: `${saved.stepCount} steps · ${credIds.length} credentials`,
          kind: 'workflow',
        },
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
        distilled,
        savedSteps: steps.map((s) => ({
          id: s.id,
          kind: s.kind,
          label: s.label,
          tool: s.tool,
          inputs: s.inputs,
          http: s.http,
          hardened: s.hardened,
        })),
        note:
          distilled
            ? `Distilled ${steps.length}-step production workflow (exploration steps collapsed). Describe ONLY savedSteps.`
            : 'Workflow frozen. Your final answer must describe ONLY savedSteps — never fabricate steps.',
      },
      display: {
        title: `Froze workflow: ${name}`,
        summary: `${steps.length} steps · ${credIds.length} credentials`,
        kind: 'workflow',
      },
    }
  },
}

/**
 * SECURITY: verify a workflow belongs to the current user before reading run
 * history or mutating its frozen steps. Legacy seed rows (userId null) pass
 * until the tenancy backfill assigns owners. Returns the row or null.
 */
async function findOwnedWorkflow(
  workflowId: string,
  userId: string,
): Promise<{ id: string; stepsJson: string } | null> {
  if (!workflowId || !userId) return null
  try {
    return await db.workflow.findFirst({
      where: { id: workflowId, OR: [{ userId }, { userId: null }] },
      select: { id: true, stepsJson: true },
    })
  } catch {
    return null
  }
}

// 13b. workflow_update — update the CURRENT agent's own workflow JSON. This is
//      how an agent evolves the process it owns over time (after learning a
//      better step order, fixing a failure, adding a gate, etc.). Operates on
//      ctx.agentId — no id needed.
const workflowUpdate: ToolDef = {
  name: 'workflow_update',
  description:
    "Replace THIS agent's saved automation with a COMPLETE new steps array (n8n-style nodes: code, HTTP, MCP, integrations, gates). Use for a broad restructure; prefer workflow_step_patch for a single-node fix. Only valid when you ARE a specific agent." +
    REF_GRAMMAR,
  inputSchema: {
    steps: { type: 'array', description: 'The complete new workflow steps array (replaces the current one).', items: { type: 'object' }, required: true },
    description: { type: 'string', description: 'Optional updated one-line description of what the workflow does.' },
    note: { type: 'string', description: 'Optional short note on what changed + why (for the activity log).' },
  },
  async run(input, ctx) {
    if (!ctx.agentId)
      return { ok: false, output: null, error: 'workflow_update only works when acting as a specific agent. Use workflow_freeze / agent_create instead.' }
    const rawSteps = Array.isArray(input.steps) ? input.steps : []
    if (rawSteps.length === 0)
      return { ok: false, output: null, error: 'a non-empty steps array is required' }
    const owned = await findOwnedWorkflow(ctx.agentId, ctx.userId)
    if (!owned)
      return { ok: false, output: null, error: 'workflow not found or not owned by you' }
    try {
      const steps = normalizeSteps(rawSteps)
      const wf: WorkflowJSON = { version: 1, steps }
      const description = asString(input.description, 1000)
      if (description) {
        await db.workflow.update({
          where: { id: ctx.agentId },
          data: { description },
        })
      }
      await saveWorkflowSteps(ctx.agentId, wf, {
        author: 'agent',
        note: asString(input.note, 500) || 'workflow_update',
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

// 13c. workflow_step_append — add ONE proven step to the agent's living
//      workflow. Lets the agent build up an automation incrementally as it
//      solves subproblems, instead of only via a big workflow_freeze at the end.
const workflowStepAppend: ToolDef = {
  name: 'workflow_step_append',
  description:
    "Add ONE proven step to THIS agent's living workflow. Use when you solve a subproblem (script_run, http_request, fs_*, etc.) that should run the same way next time — capture it immediately as a node instead of waiting to freeze everything at the end. Pass a single step object with kind, label, and an executable spec (tool+inputs, http, mcp, or code). An id is auto-assigned if omitted. Only valid when acting as a specific agent." +
    REF_GRAMMAR,
  inputSchema: {
    step: {
      type: 'object',
      description:
        'One WorkflowStep: { kind: "tool"|"reason"|"gate", label, and one of tool+inputs / http / mcp / code }.',
      required: true,
    },
    note: { type: 'string', description: 'Short note on why this step was added.' },
  },
  async run(input, ctx) {
    if (!ctx.agentId)
      return {
        ok: false,
        output: null,
        error: 'workflow_step_append only works when acting as a specific agent.',
      }
    const step = input.step
    if (!step || typeof step !== 'object' || Array.isArray(step))
      return { ok: false, output: null, error: 'a single step object is required' }
    const owned = await findOwnedWorkflow(ctx.agentId, ctx.userId)
    if (!owned) return { ok: false, output: null, error: 'workflow not found or not owned by you' }
    try {
      const [normalized] = normalizeSteps([step as Record<string, unknown>])
      if (!normalized)
        return { ok: false, output: null, error: 'step could not be normalized into a workflow node' }
      const { stepCount, addedStepId } = await appendWorkflowStep(ctx.agentId, normalized, {
        author: 'agent',
        note: asString(input.note, 500) || 'workflow_step_append',
      })
      return {
        ok: true,
        output: { agentId: ctx.agentId, addedStepId, stepCount },
        display: {
          title: 'Added workflow step',
          summary: `${normalized.label} · ${stepCount} steps total`,
          kind: 'workflow',
        },
      }
    } catch (e) {
      return { ok: false, output: null, error: (e as Error).message }
    }
  },
}

// 13d. workflow_step_patch — surgically fix ONE node by id without rewriting
//      the whole workflow. The supervisor and the agent both use this to repair
//      a broken step in place.
const workflowStepPatch: ToolDef = {
  name: 'workflow_step_patch',
  description:
    "Surgically update ONE step in THIS agent's workflow by id (partial fields are merged into the existing node). Prefer this over workflow_update for single-node fixes — e.g. fixing a URL, credentialId, or code node after a run failed. Only valid when acting as a specific agent." +
    REF_GRAMMAR,
  inputSchema: {
    stepId: { type: 'string', description: 'The id of the step to patch.', required: true },
    changes: {
      type: 'object',
      description: 'Partial WorkflowStep fields to merge into the existing step.',
      required: true,
    },
    note: { type: 'string', description: 'Short note on what changed + why.' },
  },
  async run(input, ctx) {
    if (!ctx.agentId)
      return {
        ok: false,
        output: null,
        error: 'workflow_step_patch only works when acting as a specific agent.',
      }
    const stepId = asString(input.stepId, 200)
    if (!stepId) return { ok: false, output: null, error: 'stepId is required' }
    const changes = input.changes
    if (!changes || typeof changes !== 'object' || Array.isArray(changes))
      return { ok: false, output: null, error: 'a changes object is required' }
    const owned = await findOwnedWorkflow(ctx.agentId, ctx.userId)
    if (!owned) return { ok: false, output: null, error: 'workflow not found or not owned by you' }
    try {
      const { stepCount } = await patchWorkflowStep(
        ctx.agentId,
        stepId,
        changes as Record<string, unknown>,
        { author: 'agent', note: asString(input.note, 500) || 'workflow_step_patch' },
      )
      return {
        ok: true,
        output: { agentId: ctx.agentId, stepId, stepCount },
        display: {
          title: 'Patched workflow step',
          summary: `${stepId} · ${stepCount} steps`,
          kind: 'workflow',
        },
      }
    } catch (e) {
      return { ok: false, output: null, error: (e as Error).message }
    }
  },
}

// 13a. update_plan — declare + maintain a live checklist for a multi-step task.
//      Renders a checklist card in the chat that updates as the agent works.
const VALID_PLAN_STATUS = new Set(['pending', 'in_progress', 'done'])
const updatePlanTool: ToolDef = {
  name: 'update_plan',
  description:
    'Create or update your step-by-step checklist. Call this FIRST for any task with 2+ steps to lay out the plan, then call it again to mark items in_progress/done as you complete them. Renders a live checklist in the chat so the user can follow along. Always pass the FULL list each time (not a diff). Keep labels short + imperative.',
  inputSchema: {
    items: {
      type: 'array',
      description:
        'The full checklist. Each item: { id (stable short slug), label (short imperative step), status: "pending" | "in_progress" | "done" }.',
      required: true,
      items: { type: 'object' },
    },
  },
  async run(input, ctx) {
    const rawItems = Array.isArray(input.items) ? input.items : []
    const items: PlanItem[] = rawItems
      .map((it, i) => {
        const o = (it ?? {}) as Record<string, unknown>
        const id = asString(o.id, 60) || `step-${i + 1}`
        const label = asString(o.label, 200)
        const statusRaw = asString(o.status, 20)
        const status = (VALID_PLAN_STATUS.has(statusRaw) ? statusRaw : 'pending') as PlanItem['status']
        return { id, label, status }
      })
      .filter((it) => it.label)
    if (items.length === 0)
      return { ok: false, output: null, error: 'items must be a non-empty array of { id, label, status }' }
    ctx.plan = items
    const done = items.filter((i) => i.status === 'done').length
    return {
      ok: true,
      output: { items, done, total: items.length },
      display: { title: 'Checklist updated', summary: `${done}/${items.length} done`, kind: 'info' },
    }
  },
}

// 13b. ask_clarification — ask the user a multiple-choice question when the
//      request is genuinely ambiguous. Renders clickable option buttons and
//      ENDS the turn; the user's choice arrives as the next message.
const askClarificationTool: ToolDef = {
  name: 'ask_clarification',
  description:
    'Ask the user a clarifying question when a quick answer would prevent wasted or wrong work (unclear destination, format, scope, target, or a missing value). Renders an interactive card in the chat — the user\'s answer is sent back as the next message, so this ENDS your current turn. Provide 2–5 concrete options when the choices are enumerable, OR ask a fill-in-the-blank question (few/no options + allowFreeText) when the answer is an open value like a name, path, or number. A free-text "Other" input is shown by default so the user can always type their own answer. Ask as often as genuinely needed to get it right — but never ask what you can reasonably infer, look up, or safely default.',
  inputSchema: {
    question: { type: 'string', description: 'The clarifying question to ask.', required: true },
    options: {
      type: 'array',
      description:
        '0–5 options the user can click. Each: { key (short slug), label (button text), description? (one-line detail) }. Omit or leave short for a fill-in-the-blank question.',
      items: { type: 'object' },
    },
    multiple: { type: 'boolean', description: 'Allow selecting more than one option (default false).' },
    allowFreeText: {
      type: 'boolean',
      description: 'Show a free-text "Other" input so the user can type their own answer (default true).',
    },
    freeTextPlaceholder: {
      type: 'string',
      description: 'Placeholder for the free-text input, e.g. "Type a folder path…".',
    },
  },
  async run(input, ctx) {
    const question = asString(input.question, 500)
    if (!question) return { ok: false, output: null, error: 'question is required' }
    const rawOptions = Array.isArray(input.options) ? input.options : []
    const options: ClarificationOption[] = rawOptions
      .map((it, i) => {
        const o = (it ?? {}) as Record<string, unknown>
        return {
          key: asString(o.key, 60) || `opt-${i + 1}`,
          label: asString(o.label, 200),
          description: asString(o.description, 400) || undefined,
        }
      })
      .filter((o) => o.label)
    const allowFreeText = input.allowFreeText !== false
    // A pure fill-in-the-blank question (0–1 options) is valid when free text is
    // on; otherwise require at least 2 clickable options.
    if (options.length < 2 && !allowFreeText)
      return { ok: false, output: null, error: 'provide at least 2 options, or set allowFreeText to let the user type an answer' }
    ctx.clarification = {
      id: `clarify-${Date.now()}`,
      question,
      options,
      multiple: Boolean(input.multiple),
      allowFreeText,
      freeTextPlaceholder: asString(input.freeTextPlaceholder, 120) || undefined,
      kind: 'clarification',
    }
    return {
      ok: true,
      output: {
        asked: true,
        note: 'A multiple-choice question is now shown to the user. STOP — wait for their selection, which arrives as your next message. Do not continue or assume an answer.',
      },
      display: { title: 'Asked for clarification', summary: question.slice(0, 80), kind: 'info' },
    }
  },
}

// 13b2. request_review — an APPROVAL GATE before a genuinely high-stakes or
//       irreversible action (delete data, send money, mass email, public post,
//       overwrite files, anything hard to undo). Renders the same clickable
//       card with approve/cancel-style options and ENDS the turn. AVOID this
//       whenever a safe, reversible, or autonomous path exists.
const requestReviewTool: ToolDef = {
  name: 'request_review',
  description:
    'Pause for HUMAN APPROVAL before a genuinely high-stakes, destructive, or irreversible action (deleting data, spending money, sending mass/external emails, posting publicly, overwriting or removing files, anything hard to undo). Renders clickable approve/cancel options and ENDS your turn; the choice comes back as your next message. Use this SPARINGLY — only when there is no safe, reversible, or autonomous alternative. Prefer doing reversible work autonomously over asking. Never use it for routine, low-risk, or easily-undone steps.',
  inputSchema: {
    summary: {
      type: 'string',
      description: 'Plainly state exactly WHAT you are about to do, WHY it is high-stakes, and that it needs approval (e.g. "Send this email to 240 customers?").',
      required: true,
    },
    options: {
      type: 'array',
      description:
        'The choices, default approve + cancel. Each: { key, label, description? }. e.g. [{key:"approve",label:"Approve & continue"},{key:"cancel",label:"Cancel"}].',
      items: { type: 'object' },
    },
  },
  async run(input, ctx) {
    const summary = asString(input.summary, 600)
    if (!summary) return { ok: false, output: null, error: 'summary is required' }
    const rawOptions = Array.isArray(input.options) ? input.options : []
    let options: ClarificationOption[] = rawOptions
      .map((it, i) => {
        const o = (it ?? {}) as Record<string, unknown>
        return {
          key: asString(o.key, 60) || `opt-${i + 1}`,
          label: asString(o.label, 200),
          description: asString(o.description, 400) || undefined,
        }
      })
      .filter((o) => o.label)
    if (options.length < 2) {
      options = [
        { key: 'approve', label: 'Approve & continue' },
        { key: 'cancel', label: 'Cancel' },
      ]
    }
    ctx.clarification = {
      id: `review-${Date.now()}`,
      question: summary,
      options,
      multiple: false,
      kind: 'review',
    }
    return {
      ok: true,
      output: {
        asked: true,
        note: 'An approval gate is now shown to the user. STOP — wait for their decision, which arrives as your next message. Do not proceed with the action until they approve.',
      },
      display: { title: 'Awaiting approval', summary: summary.slice(0, 80), kind: 'info' },
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
    "Ask the user for an API key / token you need. This renders a SECURE inline entry in the chat where the user types the key — it is saved straight to the vault and you get back only a credentialId (never the secret). NEVER request AI model provider keys (OpenAI, Anthropic/Claude, Google AI/Gemini, xAI/Grok, Mistral, etc.) — Apical provides LLM access in-house on the user's plan credits; for LLM work inside an automation use a reason step. Call it ONCE PER KEY, and request ALL the keys this job needs IN THE SAME TURN — they are presented to the user as a single checklist stepped through ONE AT A TIME (each with a Skip option), NOT as a stack of boxes. So call credential_request for every key up front rather than trickling them across turns. Call credential_list first to skip keys already saved. In your final answer, briefly LIST the keys you're asking for and why each is needed, but do NOT describe the boxes/stepper themselves and do NOT ask the user to paste keys into chat. The user may save or skip each; you'll be resumed with a summary of what was saved vs skipped — proceed with placeholders/mocks for skipped keys.",
  inputSchema: {
    service: { type: 'string', description: 'The service the key is for (e.g. "openai", "stripe", "github").', required: true },
    label: { type: 'string', description: 'A human label for the credential (e.g. "OpenAI API key").', required: true },
    instructions: { type: 'string', description: 'Plain-English: why you need it + where the user finds it.' },
    docsUrl: { type: 'string', description: "ALWAYS provide: direct deep link to the exact page where the user creates/copies this API key (e.g. https://platform.openai.com/api-keys). The box shows it as a 'Get your key' link." },
    headerName: { type: 'string', description: 'Header to inject the secret into when calling the API (default X-Api-Key).' },
    headerPrefix: { type: 'string', description: 'Value prefix, e.g. "Bearer " for bearer tokens (default empty).' },
  },
  async run(input, ctx) {
    const service = asString(input.service, 100)
    const label = asString(input.label, 200) || service
    if (!service)
      return { ok: false, output: null, error: 'service is required' }
    // HOUSE RULE: users are never asked for AI model provider keys — Apical
    // provides LLM access in-house, billed to the user's plan credits.
    if (isAiProviderKeyRequest(service, label)) {
      return {
        ok: false,
        output: null,
        error:
          `Never ask the user for an AI model provider key ("${service}"). Apical provides LLM access in-house on the user's plan credits — you already have model access in this run. For LLM work inside an automation (drafting emails, summarizing, classifying, extracting), use a reason step (kind:"reason" with a prompt + outputShape); the runtime executes it on Apical's models and bills the user's credits automatically. Only if the user EXPLICITLY says they want to use their own key, point them to Settings → Models (BYOK) — do not request it here.`,
      }
    }
    ctx.credentialRequests = ctx.credentialRequests ?? []
    // Dedupe repeat calls for the same key within one turn (same service may
    // legitimately need several keys, e.g. Stripe publishable + secret).
    if (!ctx.credentialRequests.some((r) => r.service === service && r.label === label)) {
      ctx.credentialRequests.push({
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
      })
    }
    return {
      ok: true,
      output: {
        requested: service,
        note: 'Queued. Keys are shown to the user as ONE checklist stepped through one at a time (each skippable) — so if this job needs more keys, call credential_request now for EACH remaining key before finishing. Then emit your final answer: briefly LIST which keys you asked for and why, but do NOT describe the entry boxes and do NOT ask the user to paste keys into chat. The turn ends there; you will be resumed with a summary of which keys were saved vs skipped.',
      },
      display: {
        title: `Requested ${label}`,
        summary: 'Awaiting the user to save it to the vault',
        kind: 'info',
      },
    }
  },
}

// 13d. app_search — search the managed app catalog (Pipedream Connect,
//      3,000+ apps). The PRIMARY way to find a connector for a service the
//      user mentions. Results include whether the user already connected it.
const appSearchTool: ToolDef = {
  name: 'app_search',
  description:
    'Search the managed app catalog (3,000+ apps: Slack, Notion, QuickBooks, Salesforce, …) for a service you need. Returns each app\'s slug, auth type, and whether the user has ALREADY CONNECTED it (with the credentialId + integrationId to use). If the app you need is not connected, call connection_request with its slug to show the user a one-click connect card. Prefer this over tool_configure / credential_request for well-known SaaS apps — managed connections need no API keys.',
  inputSchema: {
    query: { type: 'string', description: 'App name or keyword, e.g. "slack", "accounting".', required: true },
    limit: { type: 'number', description: 'Max results (default 8).' },
  },
  async run(input, ctx) {
    const query = asString(input.query, 200)
    if (!query) return { ok: false, output: null, error: 'query is required' }
    if (!isPipedreamConfigured()) {
      return {
        ok: true,
        output: {
          apps: [],
          note: 'Managed connections (Pipedream) are not configured on this deployment. Use mcp_list_servers / integration_list for existing connections, tool_configure to add an MCP server or OpenAPI spec, or credential_request for an API key.',
        },
      }
    }
    const limit = Math.min(20, Math.max(1, asNumber(input.limit, 8)))
    try {
      const { apps, error } = await searchApps(query)
      if (error) return { ok: false, output: null, error }
      const top = apps.slice(0, limit)
      // Merge the user's connection state.
      const creds = top.length
        ? await db.credential.findMany({
            where: {
              userId: ctx.userId,
              kind: 'pipedream',
              status: 'active',
              pipedreamApp: { in: top.map((a) => a.slug) },
            },
            select: { id: true, pipedreamApp: true, pipedreamAccountId: true },
          })
        : []
      const credByApp = new Map(creds.map((c) => [c.pipedreamApp, c]))
      const accountIds = creds
        .map((c) => c.pipedreamAccountId)
        .filter((v): v is string => Boolean(v))
      const integrations = accountIds.length
        ? await db.integration.findMany({
            where: {
              kind: 'mcp',
              OR: accountIds.map((id) => ({ config: { contains: `"accountId":"${id}"` } })),
            },
            select: { id: true, config: true },
          })
        : []
      const integrationByAccount = new Map<string, string>()
      for (const row of integrations) {
        const cfg = parseConfig<IntegrationConfig>(row.config, {})
        if (cfg.pipedream?.accountId) integrationByAccount.set(cfg.pipedream.accountId, row.id)
      }
      const out = top.map((a) => {
        const cred = credByApp.get(a.slug)
        return {
          slug: a.slug,
          name: a.name,
          description: a.description,
          authType: a.authType,
          connected: Boolean(cred),
          credentialId: cred?.id,
          integrationId: cred?.pipedreamAccountId
            ? integrationByAccount.get(cred.pipedreamAccountId)
            : undefined,
        }
      })
      return {
        ok: true,
        output: {
          apps: out,
          note: 'For connected apps, use mcp_list_servers/mcp_call_tool with the integrationId (or http_request with the credentialId). For unconnected apps, call connection_request with the slug.',
        },
        display: {
          title: `Searched apps: "${query}"`,
          summary: `${out.length} result${out.length === 1 ? '' : 's'}`,
          kind: 'info',
        },
      }
    } catch (e) {
      return { ok: false, output: null, error: (e as Error).message }
    }
  },
}

// 13e. connection_request — ask the user to connect an app account by
//      rendering a one-click "Connect your <App>" card in the chat. The card
//      opens the Pipedream managed-auth window; the agent is resumed once the
//      user connects (or skips). Use INSTEAD of telling the user to go set
//      anything up themselves.
const connectionRequestTool: ToolDef = {
  name: 'connection_request',
  description:
    'Ask the user to connect an app account (found via app_search) by showing a one-click connect card in the chat. The user authorizes in a popup — no API keys involved. If the app is ALREADY connected this returns the existing credentialId/integrationId immediately (no card). Otherwise the card is shown, the turn should END, and you will be resumed once the user connects or skips. Request ALL connections the job needs in the same turn.',
  inputSchema: {
    app: { type: 'string', description: 'The app slug from app_search (e.g. "slack").', required: true },
    reason: { type: 'string', description: 'One sentence shown on the card: why you need this connection (e.g. "To post the weekly summary to #general").' },
  },
  async run(input, ctx) {
    const app = asString(input.app, 100).trim().toLowerCase()
    if (!app) return { ok: false, output: null, error: 'app is required' }
    if (!isPipedreamConfigured()) {
      return {
        ok: false,
        output: null,
        error:
          'Managed connections (Pipedream) are not configured on this deployment. Use tool_configure or credential_request for a direct connection instead.',
      }
    }
    try {
      // Already connected? Return the reference — no card needed.
      const existing = await db.credential.findFirst({
        where: { userId: ctx.userId, kind: 'pipedream', status: 'active', pipedreamApp: app },
        select: { id: true, pipedreamAccountId: true, label: true },
      })
      if (existing) {
        const integration = existing.pipedreamAccountId
          ? await db.integration.findFirst({
              where: {
                kind: 'mcp',
                config: { contains: `"accountId":"${existing.pipedreamAccountId}"` },
              },
              select: { id: true },
            })
          : null
        return {
          ok: true,
          output: {
            alreadyConnected: true,
            app,
            credentialId: existing.id,
            integrationId: integration?.id,
            note: 'This app is already connected — use it directly via mcp_call_tool / http_request.',
          },
          display: { title: `${existing.label}`, summary: 'already connected', kind: 'info' },
        }
      }

      // Resolve display metadata server-side so the card looks right.
      const meta = await getPipedreamApp(app)
      ctx.connectionRequests = ctx.connectionRequests ?? []
      if (!ctx.connectionRequests.some((r) => r.app === app)) {
        ctx.connectionRequests.push({
          app,
          name: meta?.name || app,
          imgSrc: meta?.imgSrc ?? undefined,
          authType: meta?.authType ?? undefined,
          reason: asString(input.reason, 500) || undefined,
        })
      }
      return {
        ok: true,
        output: {
          requested: app,
          note: 'Queued. A connect card is shown to the user for each requested app — request ALL connections this job needs now (call connection_request for each), then emit your final answer: briefly say which connections you asked for and why. Do NOT describe the cards or ask the user to do anything else. The turn ends there; you will be resumed with which apps were connected vs skipped.',
        },
        display: {
          title: `Requested ${meta?.name || app} connection`,
          summary: 'Awaiting the user to connect the account',
          kind: 'info',
        },
      }
    } catch (e) {
      return { ok: false, output: null, error: (e as Error).message }
    }
  },
}

// 14. workflow_monitor — review recent runs + failures of a frozen workflow.
//     The agent calls this to see how its automation is doing + spot failures
//     that need improvement.
const workflowMonitor: ToolDef = {
  name: 'workflow_monitor',
  description:
    'Inspect recent automated runs for YOUR workflow: run status, per-run report summaries, and the REAL step errors of failed runs. Failed runs are already auto-supervised (diagnosed, patched, and rerun) by the runtime, so use this mainly when the user asks how the automation is doing, or as an optional health check — pass review=true to batch-audit recent outputs for silent quality problems. When you are a specific agent, workflowId defaults to your own workflow.',
  inputSchema: {
    workflowId: { type: 'string', description: 'The workflow id to monitor. Defaults to YOUR OWN workflow when you are a specific agent.' },
    limit: { type: 'number', description: 'Max runs to return (default 10).' },
    review: { type: 'boolean', description: 'true = also run a batch output review (samples recent runs, sanity-checks their real outputs).' },
  },
  async run(input, ctx) {
    const workflowId = asString(input.workflowId, 100) || ctx.agentId || ''
    if (!workflowId)
      return { ok: false, output: null, error: 'workflowId is required (or act as a specific agent)' }
    const ownedMonitor = await findOwnedWorkflow(workflowId, ctx.userId)
    if (!ownedMonitor)
      return { ok: false, output: null, error: 'workflow not found or not owned by you' }
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
          steps: {
            where: { status: 'failed' },
            select: { stepId: true, label: true, kind: true, outputJson: true },
          },
        },
      })
      // Also pull tool failure logs for this workflow.
      const failures = await db.executionPattern.findMany({
        where: { workflowId },
        orderBy: { updatedAt: 'desc' },
        take: 20,
        select: { id: true, stepId: true, occurrences: true, signature: true, outputJson: true, hardened: true },
      })

      const runsOut = runs.map((r) => {
        let reportSummary: string | undefined
        try {
          reportSummary = r.reportJson
            ? ((JSON.parse(r.reportJson) as { summary?: string }).summary ?? undefined)
            : undefined
        } catch {
          reportSummary = undefined
        }
        return {
          id: r.id,
          status: r.status,
          itemsProcessed: r.itemsProcessed,
          flaggedCount: r.flaggedCount,
          durationMs: r.durationMs,
          startedAt: r.startedAt.toISOString(),
          finishedAt: r.finishedAt?.toISOString() ?? null,
          reportSummary,
          // The REAL errors of failed steps — what to actually fix.
          stepErrors: r.steps.map((s) => {
            let error = ''
            try {
              error = s.outputJson
                ? String((JSON.parse(s.outputJson) as { error?: unknown }).error ?? '')
                : ''
            } catch {
              error = (s.outputJson ?? '').slice(0, 300)
            }
            return { stepId: s.stepId, label: s.label, kind: s.kind, error: error.slice(0, 500) }
          }),
        }
      })

      // Optional batch output review — catches "green but garbage" runs.
      let batchReview: import('./oversight').BatchReviewResult | undefined
      if (input.review === true || input.review === 'true') {
        const { batchQualityAudit } = await import('./oversight')
        batchReview = await batchQualityAudit(workflowId, ctx.userId, 5)
      }

      const failedCount = runs.filter((r) => r.status === 'failed').length
      return {
        ok: true,
        output: {
          runs: runsOut,
          totalRuns: runs.length,
          recentFailures: failedCount,
          failurePatterns: failures.map((f) => ({
            stepId: f.stepId,
            occurrences: f.occurrences,
            signature: f.signature,
            output: f.outputJson,
            hardened: f.hardened,
          })),
          ...(batchReview ? { batchReview } : {}),
        },
        display: {
          title: `Monitor ${workflowId}`,
          summary: `${runs.length} runs · ${failedCount} failed${batchReview ? ` · review: ${batchReview.verdict}` : ''}`,
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
    'Improve YOUR automation. Pass an improvement description and optionally the complete newSteps array (n8n-style nodes). The runtime uses the updated automation on the next run — you do not re-execute the job manually. Prefer workflow_step_patch for a single broken node.' +
    REF_GRAMMAR,
  inputSchema: {
    workflowId: { type: 'string', description: 'The workflow id to improve. Defaults to YOUR OWN workflow when you are a specific agent.' },
    improvement: { type: 'string', description: 'A plain-English description of the improvement (e.g. "add retry to s3", "replace s2 tool").', required: true },
    newSteps: { type: 'object', description: 'Optional: the complete new steps array to replace the frozen artifact with. If omitted, the improvement is recorded as a note for human review.' },
  },
  async run(input, ctx) {
    const workflowId = asString(input.workflowId, 100) || ctx.agentId || ''
    const improvement = asString(input.improvement, 2000)
    if (!workflowId || !improvement)
      return { ok: false, output: null, error: 'workflowId and improvement are required (or act as a specific agent)' }
    try {
      const wf = await findOwnedWorkflow(workflowId, ctx.userId)
      if (!wf) return { ok: false, output: null, error: 'workflow not found or not owned by you' }

      // If newSteps provided, replace the frozen artifact (as a new revision).
      if (input.newSteps && Array.isArray(input.newSteps)) {
        const normalized = normalizeSteps(input.newSteps as unknown[])
        await saveWorkflowSteps(
          workflowId,
          { version: 1, steps: normalized },
          { author: 'agent', note: `workflow_improve: ${improvement.slice(0, 400)}` },
        )
        if (ctx.agentId === workflowId) {
          ctx.currentWorkflow = { version: 1, steps: input.newSteps as never }
          ctx.workflowSavedToAgentId = workflowId
        }
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
    "Orchestrator only: Create a dedicated agent that owns a recurring job after you have accomplished it and learned what is needed. Pass n8n-style workflow steps (code, HTTP, MCP, integrations, gates). Include contextForAgent with everything learned. The app opens the new agent's chat automatically. Call schedule_agent next for recurring jobs. Do NOT create before proving the approach works.",
  inputSchema: {
    name: { type: 'string', description: 'Specific, descriptive agent name (e.g. "Lead Scout", "HubSpot Pipeline Builder"). NOT generic placeholders.', required: true },
    description: { type: 'string', description: 'One-line description of what the agent does.', required: true },
    steps: { type: 'array', description: 'Workflow steps (each has kind: "tool" | "reason" | "gate").', items: { type: 'object' }, required: true },
    schedule: { type: 'string', description: 'Optional human-readable schedule label (e.g. "Daily at 9am"). For an actual recurring trigger, call schedule_agent after.' },
    contextForAgent: { type: 'string', description: 'Onboarding notes for the new agent: user goals, setup decisions, missing credentials, outreach copy, prospect sources, etc.' },
  },
  async run(input, ctx) {
    const name = asString(input.name, 200)
    const description = asString(input.description, 1000)
    const rawSteps = Array.isArray(input.steps) ? input.steps : []
    if (!name || !description || rawSteps.length === 0)
      return { ok: false, output: null, error: 'name, description, and a non-empty steps array are required' }
    if (isGenericAgentName(name))
      return {
        ok: false,
        output: null,
        error: 'Pick a specific, descriptive agent name (e.g. "Lead Scout", "HubSpot Pipeline Builder") — not a generic placeholder like "Agent" or "New agent".',
      }
    try {
      const steps = normalizeSteps(rawSteps)
      const scheduleLabel = asString(input.schedule, 200) || null
      const contextForAgent = asString(input.contextForAgent, 8000)
      const runtime = inferRuntimeFromSteps(steps)
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
          runtime,
        },
      })
      await saveWorkflowSteps(created.id, { version: 1, steps }, {
        author: 'agent',
        note: 'Initial revision (agent_create).',
      })
      ctx.createdAgentId = created.id
      ctx.createdAgentName = created.name

      const onboardingParts = [
        `You were just created to own this job going forward.`,
        `**What you do:** ${description}`,
        ctx.userGoal ? `**Original user request:** ${ctx.userGoal}` : '',
        contextForAgent ? `**Setup context:**\n${contextForAgent}` : '',
        scheduleLabel ? `**Schedule:** ${scheduleLabel}` : '',
        `**Workflow:** ${steps.length} step${steps.length === 1 ? '' : 's'} configured — see the Config tab for the full process.`,
        `How you work: accomplish tasks with real tools, capture proven steps into a living workflow (workflow_step_append / workflow_freeze), then supervise its runs — the runtime replays your saved steps cheaply, and when one fails you patch it (workflow_step_patch / workflow_update), rerun, and verify. You manage the automation; you do not re-run it by hand every cycle.`,
      ].filter(Boolean)
      await db.agentMessage.create({
        data: {
          agentId: created.id,
          role: 'agent',
          content: onboardingParts.join('\n\n'),
        },
      })
      if (ctx.userGoal?.trim()) {
        await db.agentMessage.create({
          data: {
            agentId: created.id,
            role: 'user',
            content: ctx.userGoal.trim(),
          },
        })
      }

      return {
        ok: true,
        output: {
          agentId: created.id,
          name: created.name,
          stepCount: steps.length,
          schedule: scheduleLabel,
          note: 'Agent created and opened for the user. Call schedule_agent to make it run automatically.',
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
    'Schedule the automation to run on a cadence. Requires workflow_freeze first (production nodes saved). Pass agentId and cron ("0 9 * * *") or fixed_rate ("fixed_rate:3600"). Returns next run time.',
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
        select: { id: true, name: true, stepsJson: true, runtime: true },
      })
      if (!wf) return { ok: false, output: null, error: 'agent not found (or not owned by this user)' }
      if (!savedWorkflowHasExecutableSteps(wf.stepsJson)) {
        return {
          ok: false,
          output: null,
          error:
            'Cannot schedule — this agent has no production automation yet. Call workflow_freeze first to save deterministic nodes (code, HTTP, MCP, integrations).',
        }
      }
      const warnings: string[] = []
      if (wf.runtime === 'local') {
        const { userHasDesktopSession } = await import('./scheduler-guards')
        const hasDesktop = await userHasDesktopSession(db, ctx.userId)
        if (!hasDesktop) {
          warnings.push(
            'Link your desktop in Settings → Desktop and keep Apical running in the menu bar for scheduled runs to succeed.',
          )
        }
      }
      const { upsertScheduledJob } = await import('./scheduler-jobs')
      // Idempotent: one ScheduledJob per (user, workflow). Re-running
      // schedule_agent updates the existing job instead of creating duplicates.
      const job = await upsertScheduledJob({
        userId: ctx.userId,
        workflowId: agentId,
        schedule,
        scheduleKind: kind,
        timezone: 'UTC',
      })
      const nextRunAt = job.nextRunAt
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
          warnings: warnings.length ? warnings : undefined,
          note: `Scheduled. ${wf.name} will run automatically; next run ${nextRunAt.toISOString()}.`,
        },
        display: { title: `Scheduled ${wf.name}`, summary: `${schedule} · next ${nextRunAt.toISOString()}`, kind: 'workflow' },
      }
    } catch (e) {
      return { ok: false, output: null, error: (e as Error).message }
    }
  },
}

// 18b. watch_folder — register a watched-folder trigger: new files appearing
//      in a granted folder start a run of the frozen workflow. The desktop
//      counterpart to schedule_agent.
const watchFolder: ToolDef = {
  name: 'watch_folder',
  description:
    'Trigger the automation whenever a NEW file appears in a desktop folder (e.g. "when a scan lands in ~/Scans, file it"). Requires workflow_freeze first and the folder must be inside the user\'s granted folder roots. Pass agentId, path, and an optional filename pattern like "*.pdf". Runs receive {{trigger.newFiles}}.',
  inputSchema: {
    agentId: { type: 'string', description: 'The agent (workflow) id to trigger.', required: true },
    path: { type: 'string', description: 'Absolute folder path to watch (must be granted).', required: true },
    pattern: { type: 'string', description: 'Optional filename glob, e.g. "*.pdf" or "invoice-*".' },
  },
  async run(input, ctx) {
    const agentId = asString(input.agentId, 100)
    const watchPath = asString(input.path, 2000)
    const pattern = asString(input.pattern, 200) || null
    if (!agentId || !watchPath)
      return { ok: false, output: null, error: 'agentId and path are required' }
    try {
      const wf = await db.workflow.findFirst({
        where: { id: agentId, OR: [{ userId: ctx.userId }, { userId: null }] },
        select: { id: true, name: true, stepsJson: true, workspaceId: true },
      })
      if (!wf) return { ok: false, output: null, error: 'agent not found (or not owned by this user)' }
      if (!savedWorkflowHasExecutableSteps(wf.stepsJson)) {
        return {
          ok: false,
          output: null,
          error:
            'Cannot watch — this agent has no production automation yet. Call workflow_freeze first.',
        }
      }
      const { checkPathsGranted, normalizeGrantedPath } = await import('./granted-folders')
      const normalized = normalizeGrantedPath(watchPath)
      const granted = await checkPathsGranted(ctx.userId, [normalized])
      if (!granted.ok) return { ok: false, output: null, error: granted.error }

      const watch = await db.watchedFolder.create({
        data: {
          userId: ctx.userId,
          workspaceId: wf.workspaceId,
          workflowId: agentId,
          path: normalized,
          pattern,
        },
      })
      return {
        ok: true,
        output: {
          watchId: watch.id,
          agentId,
          path: normalized,
          pattern,
          note: `Watching ${normalized}${pattern ? ` (${pattern})` : ''}. New files start ${wf.name}; existing files are ignored.`,
        },
        display: {
          title: `Watching ${normalized}`,
          summary: pattern ? `new ${pattern} files run ${wf.name}` : `new files run ${wf.name}`,
          kind: 'workflow',
        },
      }
    } catch (e) {
      return { ok: false, output: null, error: (e as Error).message }
    }
  },
}

// ---------------- Workflow persistence helpers ----------------

/** Persist workflow steps onto an agent's owned workflow row. */
export async function persistAgentWorkflowSteps(
  ctx: ToolContext,
  steps: WorkflowJSON['steps'],
  opts: { description?: string; schedule?: string } = {},
): Promise<{ ok: boolean; stepCount: number; error?: string }> {
  if (!ctx.agentId) return { ok: false, stepCount: 0, error: 'no agentId' }
  if (steps.length < MIN_SUBSTANTIVE_FREEZE_STEPS) {
    return { ok: false, stepCount: 0, error: `need at least ${MIN_SUBSTANTIVE_FREEZE_STEPS} steps` }
  }
  const owned = await findOwnedWorkflow(ctx.agentId, ctx.userId)
  if (!owned) return { ok: false, stepCount: 0, error: 'workflow not found or not owned by you' }
  const wf: WorkflowJSON = { version: 1, steps }

  // Single save path: every agent save goes through the same schema +
  // referential validation as POST /v1/workflows. Invalid steps never persist.
  const check = validateWorkflowJSON(wf)
  if (!check.ok) {
    const detail = check.issues
      .slice(0, 5)
      .map((i) => `${i.path}: ${i.message}`)
      .join('; ')
    return {
      ok: false,
      stepCount: 0,
      error: `workflow failed schema validation — ${detail}. Fix the steps and retry.`,
    }
  }

  const description = opts.description?.trim() || ctx.agentName || 'Agent workflow'
  try {
    await db.workflow.update({
      where: { id: ctx.agentId },
      data: {
        description,
        ...(opts.schedule ? { schedule: opts.schedule } : {}),
      },
    })
    await saveWorkflowSteps(ctx.agentId, wf, {
      author: 'agent',
      note: 'workflow_freeze',
    })
    ctx.currentWorkflow = wf
    ctx.workflowSavedToAgentId = ctx.agentId
    return { ok: true, stepCount: steps.length }
  } catch (e) {
    return { ok: false, stepCount: 0, error: (e as Error).message }
  }
}

/** Persist the current execution trace onto an agent's owned workflow row. */
export async function persistAgentWorkflowFromTrace(
  ctx: ToolContext,
  opts: {
    description?: string
    schedule?: string
    steps?: WorkflowJSON['steps']
    goal?: string
    agentProvidedSteps?: unknown[]
  } = {},
): Promise<{ ok: boolean; stepCount: number; error?: string; distilled?: boolean }> {
  if (!ctx.agentId) return { ok: false, stepCount: 0, error: 'no agentId' }
  const trace = (ctx.executionTrace ?? []) as EngineTraceStep[]
  if (trace.length === 0 && !opts.steps?.length) {
    return { ok: false, stepCount: 0, error: 'empty trace' }
  }
  const validation = validateWorkflowFreezeTrace(trace)
  if (!validation.ok && !opts.steps?.length) {
    return { ok: false, stepCount: 0, error: validation.error }
  }

  let steps = opts.steps
  let distilled = false
  if (!steps?.length) {
    const rawSteps = workflowStepsFromExecutionTrace(trace)
    const built = await buildStepsForFreeze({
      userId: ctx.userId,
      trace,
      jobDescription: opts.description ?? ctx.agentName ?? 'Agent workflow',
      goal: opts.goal ?? ctx.userGoal,
      agentProvidedSteps: opts.agentProvidedSteps,
      rawSteps,
    })
    steps = built.steps
    distilled = built.distilled
  }

  const saved = await persistAgentWorkflowSteps(ctx, steps, opts)
  return { ...saved, distilled }
}

/** Load substantive tool steps from recent agent chat turns (for cross-turn freeze). */
export async function loadPriorEngineTrace(
  agentId: string,
): Promise<NonNullable<ToolContext['executionTrace']>> {
  const rows = await db.agentMessage.findMany({
    where: { agentId, role: 'agent' },
    orderBy: { createdAt: 'desc' },
    take: 6,
    select: { eventsJson: true },
  })
  const out: NonNullable<ToolContext['executionTrace']> = []
  for (const row of rows.reverse()) {
    if (!row.eventsJson) continue
    try {
      const events = JSON.parse(row.eventsJson) as Array<{
        type?: string
        tool?: string
        input?: unknown
        inputParams?: Record<string, unknown>
        status?: string
        result?: string
      }>
      if (!Array.isArray(events)) continue
      for (const e of events) {
        if (e.type !== 'tool_call') continue
        const tool = String(e.tool ?? '')
        if (!tool || WORKFLOW_META_TOOLS.has(tool)) continue
        if (e.status === 'error' || e.status === 'calling') continue
        const inputParams =
          e.inputParams && typeof e.inputParams === 'object' && !Array.isArray(e.inputParams)
            ? sanitizeTraceInput(e.inputParams as Record<string, unknown>)
            : parseLegacyToolInput(e.input, tool)
        out.push({
          stepId: `prior_${out.length + 1}`,
          kind: tool === 'code_eval' ? 'reason' : 'tool',
          label: traceStepLabel(tool, inputParams),
          tool: normalizeTraceTool(tool),
          input: inputParams,
          status: 'done',
          result: e.result?.slice(0, 200),
        })
      }
    } catch {
      // skip malformed rows
    }
  }
  return out.slice(-40)
}

/** Best-effort parse when only a legacy action string was persisted. */
function parseLegacyToolInput(input: unknown, tool: string): Record<string, unknown> {
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    return sanitizeTraceInput(input as Record<string, unknown>)
  }
  const s = String(input ?? '')
  if (!s) return {}
  // Legacy traces stored "fs_list(path)" — no values; cannot replay.
  if (/^\w+\([^)]*\)$/.test(s) && !s.includes('=') && !s.includes('/')) {
    return {}
  }
  try {
    const parsed = JSON.parse(s) as Record<string, unknown>
    if (parsed && typeof parsed === 'object') return sanitizeTraceInput(parsed)
  } catch {
    // not JSON
  }
  if (tool === 'fs_list' || tool === 'fs_read' || tool === 'fs_write') {
    return { path: s }
  }
  return {}
}

// NOTE: the old persistAgentWorkflowFromChatTrace "safety net" (auto-saving a
// workflow from a CLIENT-supplied chat trace in /api/agent/analyze-run) was
// deleted: it trusted unverifiable client data and silently overwrote the
// agent's workflow. Saves happen only through explicit workflow_freeze /
// workflow_update tool calls, all funneled through saveWorkflowSteps.

// ---------------- Registry ----------------

export const AGENT_TOOLS: ToolDef[] = [
  webSearch,
  webRead,
  httpRequest,
  codeEval,
  assetSave,
  imageRead,
  browserTool,
  jobSubmit,
  jobStatus,
  jobCollect,
  jobCancel,
  jobRun,
  agentSpawn,
  agentStatus,
  agentCollect,
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
  appSearchTool,
  connectionRequestTool,
  toolConfigure,
  dataTableCreate,
  dataTableInsert,
  dataTableQuery,
  agentList,
  agentCreate,
  scheduleAgent,
  watchFolder,
  workflowFreeze,
  workflowUpdate,
  workflowStepAppend,
  workflowStepPatch,
  workflowMonitor,
  workflowImprove,
  updatePlanTool,
  askClarificationTool,
  requestReviewTool,
  credentialRequestTool,
]

// Tools that require desktop access (an online DesktopSession + the user's
// allowCli flag). Hidden from the LLM catalog unless desktop access is on.
const DESKTOP_TOOLS = new Set(['cli_run', 'fs_list', 'fs_read', 'fs_write', 'fs_move'])

// Tools callable by frozen workflows but hidden from the interactive LLM
// catalog. `job.run` is the deterministic submit+poll+collect form of the
// async job trio — a workflow can't poll across steps, so it gets one
// blocking step instead.
const HIDDEN_FROM_LLM = new Set(['job.run'])

// The browser tool needs the agent-worker (headless Chromium). Hide it unless
// that worker is configured — otherwise the LLM would call a dead tool.
if (!process.env.AGENT_WORKER_URL || !process.env.AGENT_WORKER_SECRET) {
  HIDDEN_FROM_LLM.add('browser')
}

export const AGENT_TOOL_MAP: Record<string, ToolDef> = Object.fromEntries(
  AGENT_TOOLS.map((t) => [t.name, t]),
)

export function getAgentTool(name: string): ToolDef | undefined {
  return AGENT_TOOL_MAP[name]
}

// The tool catalog passed to the LLM (compact). Legacy fallback for models
// without native tool calling (llama.cpp) — the native path uses toolSpecsForLLM.
export function toolCatalogForLLM(allowCli: boolean): string {
  return AGENT_TOOLS.filter((t) => (allowCli || !DESKTOP_TOOLS.has(t.name)) && !HIDDEN_FROM_LLM.has(t.name))
    .map((t) => {
      const params = Object.entries(t.inputSchema)
        .map(([k, v]) => `${k}${v.required ? ' (required)' : ''}: ${v.type} — ${v.description}`)
        .join('\n      ')
      return `- ${t.name}: ${t.description}\n      params:\n      ${params || '(none)'}`
    })
    .join('\n')
}

// The native tool-calling specs (JSON Schema) passed to the LLM gateway's
// `tools` param. Mirrors toolCatalogForLLM's desktop gating.
export function toolSpecsForLLM(allowCli: boolean): ToolSpec[] {
  return AGENT_TOOLS.filter((t) => (allowCli || !DESKTOP_TOOLS.has(t.name)) && !HIDDEN_FROM_LLM.has(t.name)).map((t) => ({
    name: t.name,
    description: t.description,
    parameters: {
      type: 'object',
      properties: Object.fromEntries(
        Object.entries(t.inputSchema).map(([k, v]) => [
          k,
          {
            type: v.type,
            description: v.description,
            ...(v.items ? { items: v.items } : {}),
          },
        ]),
      ),
      required: Object.entries(t.inputSchema)
        .filter(([, v]) => v.required)
        .map(([k]) => k),
    },
  }))
}
