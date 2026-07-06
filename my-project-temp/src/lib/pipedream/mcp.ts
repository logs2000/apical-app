// Apical — per-user, per-app Pipedream MCP server config.
//
// Pipedream hosts an MCP server for every app in its catalog, scoped to one
// (external user, app) pair. This is the PRIMARY invocation path for managed
// connections: the existing mcp-client speaks to it like any other remote MCP
// server. Auth headers are minted here per call and live only in memory —
// they must NEVER be persisted into Integration.config (see the warning on
// McpServerConfig.headers in types.ts).

import type { McpServerConfig } from '../types'
import { getPipedreamConfig } from './config'
import { getPipedreamApiToken } from './client'

const MCP_BASE = 'https://remote.mcp.pipedream.net'

/** The non-secret MCP URL persisted into Integration.config (no headers). */
export function pipedreamMcpUrl(userId: string, appSlug: string): string {
  const params = new URLSearchParams({ externalUserId: userId, app: appSlug })
  return `${MCP_BASE}/v3?${params.toString()}`
}

/**
 * Build a ready-to-connect McpServerConfig for one user's connection to one
 * app. Returns null when Pipedream is unconfigured or token acquisition fails.
 */
export async function buildPipedreamMcpConfig(
  userId: string,
  appSlug: string,
): Promise<McpServerConfig | null> {
  const cfg = getPipedreamConfig()
  if (!cfg || !userId || !appSlug) return null
  const token = await getPipedreamApiToken()
  if (!token) return null
  return {
    // Streamable HTTP first; mcp-client's caller falls back to sse on failure.
    transport: 'http',
    url: pipedreamMcpUrl(userId, appSlug),
    headers: {
      Authorization: `Bearer ${token}`,
      'x-pd-project-id': cfg.projectId,
      'x-pd-environment': cfg.environment,
      // Redundant with the query params, but harmless — older server versions
      // read these from headers.
      'x-pd-external-user-id': userId,
      'x-pd-app-slug': appSlug,
      // Deterministic prebuilt tools (no server-side LLM sub-agent).
      'x-pd-tool-mode': 'tools-only',
    },
  }
}
