// Apical — curated MCP server directory.
//
// A static catalog of popular, well-maintained MCP servers that users can
// one-click install. This is the "anti-library" move: instead of reimplementing
// connectors for every service, we point at the MCP ecosystem. Users install
// a server, Apical connects to it (stdio for local, http/sse for remote), and
// the server's tools become available to the agent.
//
// Each entry has:
//   - slug: stable identifier (used in URLs + the install payload)
//   - name, icon, category, description, shortDesc
//   - transport: stdio | http | sse
//   - install: how to connect (command+args for stdio; url for http/sse)
//   - requiresAuth: whether the user needs to provide credentials
//   - authFields: the fields the user must fill in (env vars for stdio, headers
//     for http/sse) — surfaced in the install UI
//   - homepageUrl, docsUrl: links for the user to learn more
//   - popularity: 0-100 (rough heuristic for sort order)
//   - tags: for search/filtering
//
// KEEP THIS LIST CURATED. Don't add servers that haven't been verified to
// work. The whole value proposition is "these just work."

export interface McpDirectoryEntry {
  slug: string
  name: string
  icon: string
  category:
    | 'files'
    | 'dev'
    | 'database'
    | 'web'
    | 'messaging'
    | 'productivity'
    | 'ai'
    | 'media'
    | 'cloud'
    | 'local'
  description: string
  shortDesc: string
  transport: 'stdio' | 'http' | 'sse'
  /** For stdio: the command + args to spawn. */
  command?: string
  args?: string[]
  /** For http/sse: the server URL. */
  url?: string
  /** Whether the user must provide credentials to install. */
  requiresAuth: boolean
  /**
   * Auth fields the user must fill in at install time. For stdio, these
   * become environment variables on the spawned process. For http/sse, these
   * become headers (with the field's value as the header value).
   */
  authFields?: Array<{
    key: string
    label: string
    type: 'env' | 'header' | 'bearer'
    /** For `env`: the env var name. For `header`: the header name. For `bearer`: ignored (uses Authorization). */
    target?: string
    placeholder?: string
    description?: string
    required: boolean
    /** Marks the field as a secret (masked in the UI). */
    secret: boolean
  }>
  homepageUrl?: string
  docsUrl?: string
  popularity: number
  tags: string[]
  /** Curator's note — anything the user should know before installing. */
  notes?: string
}

// ─── Catalog ────────────────────────────────────────────────────────────────

export const MCP_DIRECTORY: McpDirectoryEntry[] = [
  // ─── Files / Filesystem ──────────────────────────────────────────────────
  {
    slug: 'filesystem',
    name: 'Filesystem',
    icon: '📁',
    category: 'files',
    description:
      'Read, write, and manage files on the local filesystem. The official @modelcontextprotocol/server-filesystem. Configure which directories the server can access.',
    shortDesc: 'Read/write local files.',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
    requiresAuth: false,
    homepageUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem',
    docsUrl: 'https://modelcontextprotocol.io/docs',
    popularity: 95,
    tags: ['files', 'local', 'official'],
    notes:
      'The last arg is the allowed directory. Add more directories as additional positional args.',
  },
  {
    slug: 'sqlite',
    name: 'SQLite',
    icon: '🗄️',
    category: 'database',
    description:
      'Query and manage a local SQLite database. The official @modelcontextprotocol/server-sqlite. Provide a path to the .db file.',
    shortDesc: 'Query local SQLite DBs.',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sqlite', '--db-path', '/tmp/apical.db'],
    requiresAuth: false,
    homepageUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/sqlite',
    popularity: 80,
    tags: ['database', 'local', 'official'],
    notes: 'Pass the .db file path via --db-path.',
  },

  // ─── Dev / GitHub ────────────────────────────────────────────────────────
  {
    slug: 'github',
    name: 'GitHub',
    icon: '🐙',
    category: 'dev',
    description:
      'Manage repos, issues, PRs, and commits through the GitHub API. Requires a personal access token.',
    shortDesc: 'GitHub repos, issues, PRs.',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    requiresAuth: true,
    authFields: [
      {
        key: 'GITHUB_PERSONAL_ACCESS_TOKEN',
        label: 'GitHub Personal Access Token',
        type: 'env',
        target: 'GITHUB_PERSONAL_ACCESS_TOKEN',
        placeholder: 'ghp_xxxxxxxxxxxx',
        description: 'Create at github.com/settings/tokens (classic, with repo scope).',
        required: true,
        secret: true,
      },
    ],
    homepageUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/github',
    popularity: 92,
    tags: ['dev', 'git', 'official'],
  },
  {
    slug: 'gitlab',
    name: 'GitLab',
    icon: '🦊',
    category: 'dev',
    description:
      'Manage GitLab projects, issues, MRs through the GitLab API. Requires a personal access token.',
    shortDesc: 'GitLab projects + MRs.',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-gitlab'],
    requiresAuth: true,
    authFields: [
      {
        key: 'GITLAB_PERSONAL_ACCESS_TOKEN',
        label: 'GitLab Personal Access Token',
        type: 'env',
        target: 'GITLAB_PERSONAL_ACCESS_TOKEN',
        placeholder: 'glpat-xxxxxxxxxxxx',
        description: 'Create at gitlab.com/-/profile/personal_access_tokens.',
        required: true,
        secret: true,
      },
    ],
    homepageUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/gitlab',
    popularity: 65,
    tags: ['dev', 'git'],
  },

  // ─── Web / Search ────────────────────────────────────────────────────────
  {
    slug: 'brave-search',
    name: 'Brave Search',
    icon: '🦁',
    category: 'web',
    description:
      'Web + local search via the Brave Search API. Requires a Brave API key.',
    shortDesc: 'Brave web + local search.',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-brave-search'],
    requiresAuth: true,
    authFields: [
      {
        key: 'BRAVE_API_KEY',
        label: 'Brave API Key',
        type: 'env',
        target: 'BRAVE_API_KEY',
        placeholder: 'BSAxxxxxxxxxxxx',
        description: 'Get at brave.com/search/api/',
        required: true,
        secret: true,
      },
    ],
    homepageUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/brave-search',
    popularity: 88,
    tags: ['web', 'search'],
  },
  {
    slug: 'fetch',
    name: 'Fetch',
    icon: '🌐',
    category: 'web',
    description:
      'Fetch web pages and convert HTML to markdown for the agent. The official @modelcontextprotocol/server-fetch. No auth required.',
    shortDesc: 'Fetch + markdown-ify URLs.',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-fetch'],
    requiresAuth: false,
    homepageUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/fetch',
    popularity: 85,
    tags: ['web', 'official'],
  },
  {
    slug: 'puppeteer',
    name: 'Puppeteer (browser)',
    icon: '🎭',
    category: 'web',
    description:
      'Drive a headless Chrome browser via Puppeteer. Useful for scraping JS-heavy pages, taking screenshots, and filling out forms.',
    shortDesc: 'Headless Chrome automation.',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-puppeteer'],
    requiresAuth: false,
    homepageUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/puppeteer',
    popularity: 75,
    tags: ['web', 'browser', 'scraping'],
    notes: 'Downloads Chromium on first run (~120MB).',
  },

  // ─── Productivity ────────────────────────────────────────────────────────
  {
    slug: 'notion',
    name: 'Notion',
    icon: '📝',
    category: 'productivity',
    description:
      'Search + read Notion pages and databases. Requires a Notion integration token.',
    shortDesc: 'Read Notion pages + DBs.',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-notion'],
    requiresAuth: true,
    authFields: [
      {
        key: 'OPENAPI_MCP_HEADERS',
        label: 'Notion integration headers (JSON)',
        type: 'env',
        target: 'OPENAPI_MCP_HEADERS',
        placeholder: '{"Authorization":"Bearer secret_xxx","Notion-Version":"2022-06-28"}',
        description: 'Create an integration at notion.so/my-integrations and pass headers as JSON.',
        required: true,
        secret: true,
      },
    ],
    homepageUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/notion',
    popularity: 78,
    tags: ['productivity', 'notes'],
  },
  {
    slug: 'google-drive',
    name: 'Google Drive',
    icon: '📁',
    category: 'productivity',
    description:
      'Search + read Google Drive files. Requires Google OAuth credentials.',
    shortDesc: 'Search Google Drive.',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-google-drive'],
    requiresAuth: true,
    authFields: [
      {
        key: 'GOOGLE_OAUTH_CREDENTIALS',
        label: 'Google OAuth credentials JSON',
        type: 'env',
        target: 'GOOGLE_OAUTH_CREDENTIALS',
        placeholder: '{"installed":{"client_id":"...","client_secret":"..."}}',
        description: 'OAuth client credentials from Google Cloud Console.',
        required: true,
        secret: true,
      },
    ],
    homepageUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/google-drive',
    popularity: 72,
    tags: ['productivity', 'google'],
  },

  // ─── Messaging ───────────────────────────────────────────────────────────
  {
    slug: 'slack',
    name: 'Slack',
    icon: '💬',
    category: 'messaging',
    description:
      'List channels, post messages, read history. Requires a Slack bot token (xoxb-...).',
    shortDesc: 'Slack channels + messages.',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-slack'],
    requiresAuth: true,
    authFields: [
      {
        key: 'SLACK_BOT_TOKEN',
        label: 'Slack Bot Token',
        type: 'env',
        target: 'SLACK_BOT_TOKEN',
        placeholder: 'xoxb-xxxxxxxxxxxx',
        description: 'Create at api.slack.com/apps → OAuth & Permissions.',
        required: true,
        secret: true,
      },
    ],
    homepageUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/slack',
    popularity: 80,
    tags: ['messaging', 'chat'],
  },

  // ─── AI / Reasoning ──────────────────────────────────────────────────────
  {
    slug: 'sequential-thinking',
    name: 'Sequential Thinking',
    icon: '🧠',
    category: 'ai',
    description:
      'A structured reasoning tool that helps the agent break down complex problems step-by-step. No auth required.',
    shortDesc: 'Step-by-step reasoning aid.',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sequential-thinking'],
    requiresAuth: false,
    homepageUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/sequentialthinking',
    popularity: 70,
    tags: ['ai', 'reasoning', 'official'],
  },
  {
    slug: 'memory',
    name: 'Memory',
    icon: '🧩',
    category: 'ai',
    description:
      'Persistent key-value memory the agent can use across runs. Backed by a local JSON file.',
    shortDesc: 'Persistent agent memory.',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-memory'],
    requiresAuth: false,
    homepageUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/memory',
    popularity: 68,
    tags: ['ai', 'memory', 'official'],
  },

  // ─── Cloud ───────────────────────────────────────────────────────────────
  {
    slug: 'aws',
    name: 'AWS',
    icon: '☁️',
    category: 'cloud',
    description:
      'Manage AWS resources via the AWS SDK. Requires AWS credentials with the appropriate IAM permissions.',
    shortDesc: 'Manage AWS resources.',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-aws'],
    requiresAuth: true,
    authFields: [
      {
        key: 'AWS_ACCESS_KEY_ID',
        label: 'AWS Access Key ID',
        type: 'env',
        target: 'AWS_ACCESS_KEY_ID',
        placeholder: 'AKIA...',
        required: true,
        secret: true,
      },
      {
        key: 'AWS_SECRET_ACCESS_KEY',
        label: 'AWS Secret Access Key',
        type: 'env',
        target: 'AWS_SECRET_ACCESS_KEY',
        placeholder: '••••••••',
        required: true,
        secret: true,
      },
      {
        key: 'AWS_REGION',
        label: 'AWS Region',
        type: 'env',
        target: 'AWS_REGION',
        placeholder: 'us-east-1',
        required: false,
        secret: false,
      },
    ],
    homepageUrl: 'https://github.com/modelcontextprotocol/servers',
    popularity: 60,
    tags: ['cloud', 'aws'],
  },
  {
    slug: 'cloudflare',
    name: 'Cloudflare',
    icon: '🌅',
    category: 'cloud',
    description:
      'Manage Cloudflare accounts: DNS, Workers, R2, KV. Requires a Cloudflare API token + account ID.',
    shortDesc: 'Cloudflare DNS, Workers, R2.',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-cloudflare'],
    requiresAuth: true,
    authFields: [
      {
        key: 'CLOUDFLARE_API_TOKEN',
        label: 'Cloudflare API Token',
        type: 'env',
        target: 'CLOUDFLARE_API_TOKEN',
        placeholder: '••••••••',
        required: true,
        secret: true,
      },
      {
        key: 'CLOUDFLARE_ACCOUNT_ID',
        label: 'Cloudflare Account ID',
        type: 'env',
        target: 'CLOUDFLARE_ACCOUNT_ID',
        placeholder: 'abcdef1234567890',
        required: true,
        secret: false,
      },
    ],
    homepageUrl: 'https://github.com/modelcontextprotocol/servers',
    popularity: 55,
    tags: ['cloud', 'cloudflare'],
  },

  // ─── Local / OS ──────────────────────────────────────────────────────────
  {
    slug: 'time',
    name: 'Time',
    icon: '🕒',
    category: 'local',
    description:
      'Get the current time in any timezone. Useful for agents that need to reason about dates + schedules.',
    shortDesc: 'Current time + timezones.',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-time'],
    requiresAuth: false,
    homepageUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/time',
    popularity: 50,
    tags: ['local', 'time', 'official'],
  },
  {
    slug: 'execute-command',
    name: 'Execute Command',
    icon: '⌨️',
    category: 'local',
    description:
      'Run arbitrary shell commands on the local machine. POWERFUL AND DANGEROUS — only install on machines you trust.',
    shortDesc: 'Run shell commands (dangerous!).',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-command'],
    requiresAuth: false,
    homepageUrl: 'https://github.com/modelcontextprotocol/servers',
    popularity: 45,
    tags: ['local', 'shell', 'dangerous'],
    notes:
      'This gives the agent full shell access. Only install on isolated or trusted machines.',
  },

  // ─── Media ───────────────────────────────────────────────────────────────
  {
    slug: 'everart',
    name: 'EverArt (image gen)',
    icon: '🎨',
    category: 'media',
    description:
      'Generate images via the EverArt API. Requires an EverArt API key.',
    shortDesc: 'AI image generation.',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-everart'],
    requiresAuth: true,
    authFields: [
      {
        key: 'EVERART_API_KEY',
        label: 'EverArt API Key',
        type: 'env',
        target: 'EVERART_API_KEY',
        placeholder: 'evrt_xxxxxxxxxxxx',
        required: true,
        secret: true,
      },
    ],
    homepageUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/everart',
    popularity: 40,
    tags: ['media', 'image-gen'],
  },

  // ─── Databases ───────────────────────────────────────────────────────────
  {
    slug: 'postgres',
    name: 'PostgreSQL',
    icon: '🐘',
    category: 'database',
    description:
      'Run read-only SQL queries against a PostgreSQL database. Requires a connection string.',
    shortDesc: 'Query Postgres (read-only).',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-postgres', 'postgresql://user:pass@host:5432/db'],
    requiresAuth: true,
    authFields: [
      {
        key: 'connection_string',
        label: 'PostgreSQL connection string',
        type: 'env',
        target: 'DATABASE_URL',
        placeholder: 'postgresql://user:pass@host:5432/db',
        description: 'Passed as the first positional arg to the server.',
        required: true,
        secret: true,
      },
    ],
    homepageUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/postgres',
    popularity: 82,
    tags: ['database', 'sql'],
    notes:
      'The connection string is passed as a positional arg, not an env var. Apical substitutes it into args[2] at install time.',
  },
]

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Get a single directory entry by slug, or undefined. */
export function getDirectoryEntry(slug: string): McpDirectoryEntry | undefined {
  return MCP_DIRECTORY.find((e) => e.slug === slug)
}

/** Search/filter the directory. Empty query returns all entries (sorted by popularity). */
export function searchDirectory(query: string, category?: string): McpDirectoryEntry[] {
  const q = query.trim().toLowerCase()
  const filtered = MCP_DIRECTORY.filter((e) => {
    if (category && e.category !== category) return false
    if (!q) return true
    return (
      e.name.toLowerCase().includes(q) ||
      e.description.toLowerCase().includes(q) ||
      e.shortDesc.toLowerCase().includes(q) ||
      e.tags.some((t) => t.toLowerCase().includes(q))
    )
  })
  // Sort by popularity (desc), then name (asc) for stable order.
  return filtered.sort((a, b) => {
    if (b.popularity !== a.popularity) return b.popularity - a.popularity
    return a.name.localeCompare(b.name)
  })
}

/** Build the install config (McpServerConfig) from a directory entry + user-provided auth values. */
export function buildInstallConfig(
  entry: McpDirectoryEntry,
  authValues: Record<string, string>,
): {
  transport: 'stdio' | 'http' | 'sse'
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  headers?: Record<string, string>
  bearerToken?: string
} {
  if (entry.transport === 'stdio') {
    const env: Record<string, string> = {}
    let args = [...(entry.args || [])]
    for (const field of entry.authFields || []) {
      const val = authValues[field.key]?.trim() || ''
      if (!val) continue
      if (field.type === 'env') {
        // Special case: postgres passes the connection string as a positional
        // arg, not an env var. The field's `target` is 'DATABASE_URL' but we
        // detect this case via the field's `key` matching 'connection_string'.
        if (field.key === 'connection_string') {
          // Replace the placeholder arg (if any) with the real value.
          const placeholderIdx = args.findIndex(
            (a) => a.includes('postgresql://') || a.includes('user:pass'),
          )
          if (placeholderIdx >= 0) {
            args[placeholderIdx] = val
          } else {
            args.push(val)
          }
        } else if (field.target) {
          env[field.target] = val
        }
      }
    }
    return {
      transport: 'stdio',
      command: entry.command,
      args,
      env: Object.keys(env).length > 0 ? env : undefined,
    }
  }
  // http / sse
  const headers: Record<string, string> = {}
  let bearerToken: string | undefined
  for (const field of entry.authFields || []) {
    const val = authValues[field.key]?.trim() || ''
    if (!val) continue
    if (field.type === 'bearer') {
      bearerToken = val
    } else if (field.type === 'header' && field.target) {
      headers[field.target] = val
    }
  }
  return {
    transport: entry.transport,
    url: entry.url,
    headers: Object.keys(headers).length > 0 ? headers : undefined,
    bearerToken,
  }
}
