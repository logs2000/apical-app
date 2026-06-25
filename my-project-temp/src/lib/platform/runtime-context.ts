/**
 * Describes the client runtime for the LLM — what the agent can and cannot do.
 */

export type ClientPlatform = 'desktop' | 'web'

export interface RuntimeContextInput {
  platform: ClientPlatform
  allowCli: boolean
}

export function runtimeContextForLLM(opts: RuntimeContextInput): string {
  const { platform, allowCli } = opts

  if (platform === 'desktop' && allowCli) {
    return `RUNTIME ENVIRONMENT: Desktop app (local).
You are running inside the user's Apical desktop application with full local access.
AVAILABLE: cli_run (shell commands), fs_list / fs_read / fs_write / fs_move (local filesystem), script_run for JavaScript, Python, and shell, native file/folder pickers, and all web/cloud tools.
LIMITATIONS: You cannot access files outside what the user grants. Secrets still live in the Vault — never ask for raw API keys in chat.
Always act within these capabilities. Do not claim you lack local access — you have it.`
  }

  if (platform === 'web' && allowCli) {
    return `RUNTIME ENVIRONMENT: Web browser (development mode with desktop bridge enabled).
CLI and filesystem tools are enabled for this session only. In a normal production web session they would be unavailable.
AVAILABLE: cli_run, fs_*, script_run (all languages), plus all standard web/cloud tools.
Treat this as a temporary elevated session — prefer portable approaches when possible.`
  }

  return `RUNTIME ENVIRONMENT: Web app (browser).
You do NOT have direct access to the user's local filesystem or shell.
UNAVAILABLE: cli_run, fs_list, fs_read, fs_write, fs_move. Python and shell via script_run will fail — only JavaScript runs (server sandbox).
AVAILABLE: web_search, web_read, http_request, data_table_*, asset_save, integration/MCP tools, vault credentials (by id), and cloud APIs.
Never tell the user you can browse their local files, run terminal commands, or execute Python/shell scripts. If they need that, suggest the Apical desktop app.
JavaScript one-off computation via script_run or code_eval is fine.`
}

export function clientPlatformFromRequest(isDesktop?: boolean): ClientPlatform {
  return isDesktop ? 'desktop' : 'web'
}
