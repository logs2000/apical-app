// Apical — MCP client wrapper.
//
// Real `@modelcontextprotocol/sdk` connection helper. Used by:
//   - POST /api/mcp/connect — connect + discover tools, save as an Integration
//   - POST /api/mcp/[id]/refresh — re-discover tools
//   - POST /api/mcp/[id]/call — call a tool
//
// All three transports are supported:
//   - stdio  — spawn a local process (StdioClientTransport). Many npx packages
//              aren't installed in the sandbox, so a stdio spawn failing is the
//              common path; we surface a clear error.
//   - http   — Streamable HTTP (the modern MCP remote transport). Used by
//              servers like the official remote MCP servers.
//   - sse    — Legacy SSE (used by older MCP servers that haven't migrated to
//              Streamable HTTP yet). Marked deprecated in the SDK but still
//              common in the wild.
//
// Authenticated remote MCP servers: the http + sse transports accept
// `headers` (a Record<string, string>) and a `bearerToken` shorthand on the
// McpServerConfig. We merge these into a single `requestInit.headers` object
// passed to the transport. This lets users connect to MCP servers behind
// OAuth (e.g. a remote Notion MCP server that requires a Bearer token).
//
// Both connect + call paths are wrapped in a 15s timeout + try/catch so a
// broken MCP server never crashes the request — we return
// `{ error: message }` instead.

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import type { McpServerConfig, ToolDef } from './types'

const CONNECT_TIMEOUT_MS = 15_000
const CALL_TIMEOUT_MS = 15_000

export interface McpConnectResult {
  tools: ToolDef[]
  /** Populated when the connection failed — caller should treat as an error. */
  error?: string
}

/** Race a promise against a timeout. Rejects with Error('Timed out') on expiry. */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`))
    }, ms)
    p.then(
      (v) => {
        clearTimeout(t)
        resolve(v)
      },
      (e) => {
        clearTimeout(t)
        reject(e)
      },
    )
  })
}

/** Build a Client with a reasonable name + version. */
function buildClient(): Client {
  return new Client(
    { name: 'apical-mcp-client', version: '1.0.0' },
    { capabilities: {} },
  )
}

/**
 * Merge the McpServerConfig's headers + bearerToken into a single headers
 * object suitable for `requestInit.headers`. Explicit headers win; the bearer
 * token is added as `Authorization: Bearer <token>` if not already set.
 *
 * Returns undefined if neither is set (so we don't pollute the requestInit).
 */
function buildAuthHeaders(
  config: McpServerConfig,
): Record<string, string> | undefined {
  const headers: Record<string, string> = {}
  if (config.headers && typeof config.headers === 'object') {
    for (const [k, v] of Object.entries(config.headers)) {
      if (typeof v === 'string') headers[k] = v
    }
  }
  if (config.bearerToken && config.bearerToken.trim()) {
    // Only set Authorization if the caller hasn't already provided one.
    const hasAuth = Object.keys(headers).some(
      (k) => k.toLowerCase() === 'authorization',
    )
    if (!hasAuth) {
      headers['Authorization'] = `Bearer ${config.bearerToken.trim()}`
    }
  }
  return Object.keys(headers).length > 0 ? headers : undefined
}

/**
 * Build the right transport for the config. Throws on invalid config (missing
 * url for http/sse, missing command for stdio, unknown transport).
 */
function buildTransport(config: McpServerConfig): {
  transport:
    | StdioClientTransport
    | StreamableHTTPClientTransport
    | SSEClientTransport
  label: string
} {
  if (config.transport === 'stdio') {
    if (!config.command) {
      throw new Error('stdio MCP config requires a "command".')
    }
    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: config.env as Record<string, string> | undefined,
      // Pipe stderr so a chatty server doesn't pollute our own stderr.
      stderr: 'pipe',
    })
    return { transport, label: `stdio(${config.command})` }
  }

  if (config.transport === 'http' || config.transport === 'sse') {
    if (!config.url) {
      throw new Error(
        `${config.transport} MCP config requires a "url".`,
      )
    }
    let url: URL
    try {
      url = new URL(config.url)
    } catch {
      throw new Error(`Invalid MCP url: ${config.url}`)
    }
    const headers = buildAuthHeaders(config)
    const requestInit = headers
      ? { headers: headers as Record<string, string> }
      : undefined

    if (config.transport === 'http') {
      const transport = new StreamableHTTPClientTransport(url, { requestInit })
      return { transport, label: `http(${config.url})` }
    }
    // sse
    const transport = new SSEClientTransport(url, { requestInit })
    return { transport, label: `sse(${config.url})` }
  }

  throw new Error(
    `Invalid MCP transport: "${config.transport}". Must be "stdio", "http", or "sse".`,
  )
}

/**
 * Connect to an MCP server, discover its tools, and close the connection.
 * Always returns a result object (never throws). On failure, `error` is set.
 */
export async function connectMcpServer(
  config: McpServerConfig,
): Promise<McpConnectResult> {
  if (
    !config ||
    (config.transport !== 'stdio' &&
      config.transport !== 'http' &&
      config.transport !== 'sse')
  ) {
    return {
      tools: [],
      error:
        'Invalid MCP config: transport must be "stdio", "http", or "sse".',
    }
  }

  let built: ReturnType<typeof buildTransport>
  try {
    built = buildTransport(config)
  } catch (err) {
    return {
      tools: [],
      error: `Failed to build MCP transport: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
  const { transport, label } = built

  const client = buildClient()
  try {
    await withTimeout(client.connect(transport), CONNECT_TIMEOUT_MS, 'MCP connect')
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // Best-effort close.
    try {
      await client.close()
    } catch {
      // ignore
    }
    try {
      await transport.close()
    } catch {
      // ignore
    }
    return {
      tools: [],
      error:
        config.transport === 'stdio'
          ? `Could not start MCP server "${config.command}": ${msg}. (The sandbox may not have this command installed.)`
          : `Could not connect to MCP server at ${config.url} (${label}): ${msg}`,
    }
  }

  try {
    const listResult = await withTimeout(
      client.listTools(),
      CONNECT_TIMEOUT_MS,
      'MCP listTools',
    )
    const tools: ToolDef[] = (listResult.tools || []).map((t) => ({
      id: t.name,
      name: t.name,
      description: t.description || `Tool ${t.name}`,
      integrationId: '',
      inputSchema: t.inputSchema as Record<string, unknown> | undefined,
    }))
    return { tools }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return {
      tools: [],
      error: `Connected to the MCP server but could not list tools: ${msg}`,
    }
  } finally {
    try {
      await client.close()
    } catch {
      // ignore
    }
    try {
      await transport.close()
    } catch {
      // ignore
    }
  }
}

/**
 * Connect, call a single tool by name, close. Returns the raw result on
 * success or `{ error: message }` on failure.
 */
export async function callMcpTool(
  config: McpServerConfig,
  toolName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  if (!toolName) return { error: 'tool name is required' }

  let built: ReturnType<typeof buildTransport>
  try {
    built = buildTransport(config)
  } catch (err) {
    return {
      error: `Failed to build MCP transport: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
  const { transport, label } = built

  const client = buildClient()
  try {
    await withTimeout(client.connect(transport), CONNECT_TIMEOUT_MS, 'MCP connect')
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    try {
      await client.close()
    } catch {
      // ignore
    }
    try {
      await transport.close()
    } catch {
      // ignore
    }
    return {
      error:
        config.transport === 'stdio'
          ? `Could not start MCP server "${config.command}": ${msg}`
          : `Could not connect to MCP server at ${config.url} (${label}): ${msg}`,
    }
  }

  try {
    const result = await withTimeout(
      client.callTool({ name: toolName, arguments: args }),
      CALL_TIMEOUT_MS,
      'MCP callTool',
    )
    // Strip the protocol-layer meta, keep the content fields.
    const { content, isError, _meta, ...rest } = result as Record<string, unknown>
    return {
      ok: !isError,
      content,
      result: rest,
      ...(typeof _meta === 'object' && _meta ? { _meta } : {}),
      ...(isError ? { error: 'MCP tool returned an error' } : {}),
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { error: `MCP callTool failed: ${msg}` }
  } finally {
    try {
      await client.close()
    } catch {
      // ignore
    }
    try {
      await transport.close()
    } catch {
      // ignore
    }
  }
}
