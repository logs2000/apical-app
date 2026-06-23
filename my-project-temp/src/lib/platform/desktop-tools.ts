// MCP tool catalog for the Apical desktop bridge.
//
// This is the public surface of the desktop bridge — the 9 tools a hosted
// agent can call against a connected desktop. The same catalog is served by:
//   - The desktop-bridge mini-service: `GET http://localhost:3005/tools`
//   - The Next.js API route:           `GET /api/desktop/bridge/tools`
//
// Both must stay in sync. The mini-service has its own copy (it's a separate
// bun project and can't import from src/); this is the canonical copy for the
// Next.js side. The DesktopBridgePanel also imports it to render the catalog
// without an extra fetch.

export interface McpTool {
  /** Dotted tool name (e.g. `desktop.fs.list`). */
  name: string
  /** One-line description of what the tool does. */
  description: string
  /** Map of arg name → human-readable type/shape. */
  args: Record<string, string>
  /** Map of return-field name → human-readable type/shape. */
  returns: Record<string, string>
  /** Optional group label for the UI (fs / cli / net / notify / secrets). */
  group: 'fs' | 'cli' | 'net' | 'notify' | 'secrets'
}

export const MCP_TOOLS: McpTool[] = [
  {
    name: 'desktop.fs.list',
    description: 'List entries in a directory on the connected desktop.',
    args: { path: 'string (absolute path)' },
    returns: { entries: 'array of { name, type, size }' },
    group: 'fs',
  },
  {
    name: 'desktop.fs.read',
    description:
      "Read a file. encoding defaults to utf8; use base64 for binaries.",
    args: { path: 'string', encoding: "'utf8' | 'base64' (optional)" },
    returns: { content: 'string' },
    group: 'fs',
  },
  {
    name: 'desktop.fs.write',
    description:
      'Write content to a file (overwrites). encoding defaults to utf8.',
    args: {
      path: 'string',
      content: 'string',
      encoding: "'utf8' | 'base64' (optional)",
    },
    returns: { ok: 'boolean', bytes: 'number' },
    group: 'fs',
  },
  {
    name: 'desktop.fs.move',
    description: 'Move or rename a file/directory.',
    args: { from: 'string', to: 'string' },
    returns: { ok: 'boolean' },
    group: 'fs',
  },
  {
    name: 'desktop.fs.watch',
    description:
      'Start watching a path for changes. Subsequent change events are emitted separately.',
    args: { path: 'string' },
    returns: { ok: 'boolean' },
    group: 'fs',
  },
  {
    name: 'desktop.cli.run',
    description:
      'Run a CLI command on the desktop. Bounded by timeoutMs (default 30s).',
    args: {
      cmd: 'string',
      args: 'string[] (optional)',
      cwd: 'string (optional)',
      timeoutMs: 'number (optional)',
    },
    returns: { stdout: 'string', stderr: 'string', exitCode: 'number' },
    group: 'cli',
  },
  {
    name: 'desktop.net.fetch',
    description:
      "HTTP request from the desktop (reaches the user's local network).",
    args: {
      url: 'string',
      method: 'string (optional)',
      headers: 'object (optional)',
      body: 'any (optional)',
    },
    returns: { status: 'number', headers: 'object', body: 'string' },
    group: 'net',
  },
  {
    name: 'desktop.notify',
    description: 'Show a native OS notification on the desktop.',
    args: { title: 'string', body: 'string' },
    returns: { ok: 'boolean' },
    group: 'notify',
  },
  {
    name: 'desktop.secrets.get',
    description: 'Read a value from the OS keychain (service = "apical").',
    args: { key: 'string' },
    returns: { value: 'string | null' },
    group: 'secrets',
  },
]

/** Look up a tool by name. Returns undefined if not found. */
export function getTool(name: string): McpTool | undefined {
  return MCP_TOOLS.find((t) => t.name === name)
}

/** True if the given name is a known desktop bridge tool. */
export function isKnownTool(name: string): boolean {
  return MCP_TOOLS.some((t) => t.name === name)
}
