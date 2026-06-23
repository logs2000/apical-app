// Apical — external data plugins.
//
// A registry of supported external data stores: Supabase, Airtable, Postgres,
// MySQL, Google Sheets, Notion (and a local-SQLite placeholder kind for
// forward-compat). Each plugin defines:
//   - kind: the discriminator stored on `DataConnection.kind`
//   - name + icon + description: for the UI catalog
//   - configFields: the form schema for the connect dialog (with `secret`
//     flags so the API can mask secrets on read)
//   - validate(config): shape/required-field check (returns an error string
//     or null). Called on the server before encrypting + persisting.
//   - testConnection(config): best-effort HTTP probe. There is no direct TCP
//     from a Next.js route handler, so each plugin calls the vendor's REST
//     API with `fetch`. Returns { ok, detail, tables? }.
//
// Plugins are stateless + pure: they take a decrypted config object and
// return results. The API routes own persistence + encryption.

import { maskKey } from './vault'

// ---------------- Types ----------------

export type DataPluginKind =
  | 'supabase'
  | 'airtable'
  | 'postgres'
  | 'mysql'
  | 'sqlite_local'
  | 'google_sheets'
  | 'notion'

export type ConfigFieldType = 'text' | 'password' | 'number' | 'url'

export interface ConfigField {
  key: string
  label: string
  type: ConfigFieldType
  placeholder?: string
  required?: boolean
  secret?: boolean
  help?: string
  /** Optional default value (used for `port` selects). */
  defaultValue?: string | number
}

export interface TestResult {
  ok: boolean
  detail: string
  /** Names of accessible tables/bases/spreadsheets, if the probe returned them. */
  tables?: string[]
}

export interface DataPlugin {
  kind: DataPluginKind
  name: string
  icon: string
  description: string
  category: 'sql' | 'nosql' | 'sheets' | 'notes'
  configFields: ConfigField[]
  /** Validate the config shape. Returns a human error string or null. */
  validate: (config: Record<string, unknown>) => string | null
  /** Best-effort live connection test. Never throws. */
  testConnection: (config: Record<string, unknown>) => Promise<TestResult>
  /**
   * Build the non-secret metadata blob stored on DataConnection.metaJson.
   * Defaults to { } — plugins override to surface e.g. host, baseName.
   */
  buildMeta?: (config: Record<string, unknown>) => Record<string, unknown>
}

// ---------------- Helpers ----------------

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0
}

function missingFields(
  config: Record<string, unknown>,
  fields: ConfigField[],
): string[] {
  const missing: string[] = []
  for (const f of fields) {
    if (!f.required) continue
    const v = config[f.key]
    if (!isNonEmptyString(v)) missing.push(f.label)
  }
  return missing
}

// ---------------- Plugin: Supabase ----------------

const supabasePlugin: DataPlugin = {
  kind: 'supabase',
  name: 'Supabase',
  icon: '🟩',
  description: 'Postgres + storage + auth. Query tables via the REST API.',
  category: 'sql',
  configFields: [
    {
      key: 'url',
      label: 'Project URL',
      type: 'url',
      placeholder: 'https://xyzcompany.supabase.co',
      required: true,
      help: 'Found in Project Settings → API.',
    },
    {
      key: 'serviceKey',
      label: 'Service role key',
      type: 'password',
      placeholder: 'eyJhbGciOiJIUzI1NiIsInR5cCI6…',
      required: true,
      secret: true,
      help: 'Server-only key. Never expose in the browser.',
    },
  ],
  validate(config) {
    const missing = missingFields(config, supabasePlugin.configFields)
    if (missing.length) return `Missing: ${missing.join(', ')}`
    const url = String(config.url).trim()
    if (!/^https?:\/\//.test(url)) return 'Project URL must start with http(s)://'
    return null
  },
  async testConnection(config) {
    const url = String(config.url || '').trim().replace(/\/$/, '')
    const key = String(config.serviceKey || '').trim()
    if (!url || !key) return { ok: false, detail: 'Missing url or serviceKey' }
    try {
      const res = await fetch(`${url}/rest/v1/`, {
        method: 'GET',
        headers: { apikey: key, Authorization: `Bearer ${key}` },
        // Don't abort on a 404 — Supabase returns 404 for `/rest/v1/` but
        // a valid apikey proves the key is good. We treat 2xx + 4xx (except
        // 401/403) as "the API accepted our credentials".
        signal: AbortSignal.timeout(8000),
      })
      if (res.status === 401 || res.status === 403) {
        return { ok: false, detail: `Auth rejected (HTTP ${res.status}).` }
      }
      // Try to list a known table for a richer probe.
      let tables: string[] | undefined
      try {
        const openRes = await fetch(`${url}/rest/v1/`, {
          method: 'GET',
          headers: { apikey: key, Authorization: `Bearer ${key}` },
          signal: AbortSignal.timeout(8000),
        })
        const body = (await openRes.json().catch(() => null)) as
          | Record<string, unknown>
          | null
        if (body && typeof body === 'object') {
          tables = Object.keys(body)
        }
      } catch {
        // ignore
      }
      return {
        ok: true,
        detail: `Connected (HTTP ${res.status}).`,
        tables,
      }
    } catch (err) {
      return {
        ok: false,
        detail: err instanceof Error ? err.message : 'Network error',
      }
    }
  },
  buildMeta(config) {
    const url = String(config.url || '').trim()
    let host = url
    try {
      host = new URL(url).host
    } catch {
      /* keep raw */
    }
    return { host, urlMasked: url }
  },
}

// ---------------- Plugin: Airtable ----------------

const airtablePlugin: DataPlugin = {
  kind: 'airtable',
  name: 'Airtable',
  icon: '🟦',
  description: 'Spreadsheet-database hybrid. List + read your bases.',
  category: 'nosql',
  configFields: [
    {
      key: 'apiKey',
      label: 'Personal access token',
      type: 'password',
      placeholder: 'patXxx…',
      required: true,
      secret: true,
      help: 'Create one at airtable.com/create/tokens (scopes: data.records:read, schema.bases:read).',
    },
    {
      key: 'baseId',
      label: 'Base ID',
      type: 'text',
      placeholder: 'appXXXXXXXXXXXXXX',
      required: true,
      help: 'Found in the Airtable API docs for your base.',
    },
  ],
  validate(config) {
    const missing = missingFields(config, airtablePlugin.configFields)
    if (missing.length) return `Missing: ${missing.join(', ')}`
    return null
  },
  async testConnection(config) {
    const apiKey = String(config.apiKey || '').trim()
    const baseId = String(config.baseId || '').trim()
    if (!apiKey) return { ok: false, detail: 'Missing personal access token' }
    try {
      // List bases — verifies the token works.
      const res = await fetch('https://api.airtable.com/v0/meta/bases', {
        method: 'GET',
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(8000),
      })
      if (!res.ok) {
        if (res.status === 401 || res.status === 403)
          return { ok: false, detail: `Auth rejected (HTTP ${res.status}).` }
        return { ok: false, detail: `HTTP ${res.status}` }
      }
      const body = (await res.json().catch(() => null)) as
        | { bases?: Array<{ id?: string; name?: string }> }
        | null
      const bases = body?.bases ?? []
      const tables = bases.map((b) => b.name).filter(Boolean) as string[]
      const baseMatched = baseId
        ? bases.some((b) => b.id === baseId)
        : false
      if (baseId && !baseMatched) {
        return {
          ok: true,
          detail: `Token works, but base ${baseId} isn't accessible to it.`,
          tables,
        }
      }
      return {
        ok: true,
        detail: baseId
          ? `Connected to base ${baseId}.`
          : `Connected — ${tables.length} bases visible.`,
        tables,
      }
    } catch (err) {
      return {
        ok: false,
        detail: err instanceof Error ? err.message : 'Network error',
      }
    }
  },
  buildMeta(config) {
    const baseId = String(config.baseId || '').trim()
    return { baseId }
  },
}

// ---------------- Plugin: Postgres ----------------

function buildSqlConfigFields(label: string): ConfigField[] {
  return [
    {
      key: 'host',
      label: 'Host',
      type: 'text',
      placeholder: 'db.example.com',
      required: true,
    },
    {
      key: 'port',
      label: 'Port',
      type: 'number',
      placeholder: '5432',
      defaultValue: label === 'postgres' ? 5432 : 3306,
      required: true,
    },
    {
      key: 'database',
      label: 'Database',
      type: 'text',
      placeholder: 'app_db',
      required: true,
    },
    {
      key: 'user',
      label: 'User',
      type: 'text',
      placeholder: 'app',
      required: true,
    },
    {
      key: 'password',
      label: 'Password',
      type: 'password',
      placeholder: '••••••••',
      required: true,
      secret: true,
    },
  ]
}

function validateSqlConfig(
  config: Record<string, unknown>,
  fields: ConfigField[],
): string | null {
  const missing = missingFields(config, fields)
  if (missing.length) return `Missing: ${missing.join(', ')}`
  const port = Number(config.port)
  if (!Number.isFinite(port) || port < 1 || port > 65535) {
    return 'Port must be a number between 1 and 65535'
  }
  return null
}

// We cannot directly open a TCP socket from a Next.js route handler. For
// postgres/mysql we build a connection string + verify it parses. A real
// round-trip requires the desktop bridge or a mini-service — we surface that
// honestly to the user.
function buildSqlMeta(config: Record<string, unknown>): Record<string, unknown> {
  return {
    host: String(config.host || '').trim(),
    port: Number(config.port) || null,
    database: String(config.database || '').trim(),
    user: String(config.user || '').trim(),
  }
}

const postgresPlugin: DataPlugin = {
  kind: 'postgres',
  name: 'PostgreSQL',
  icon: '🐘',
  description: 'Open-source relational DB. (Live probe needs a TCP bridge.)',
  category: 'sql',
  configFields: buildSqlConfigFields('postgres'),
  validate(config) {
    return validateSqlConfig(config, postgresPlugin.configFields)
  },
  async testConnection(config) {
    const err = postgresPlugin.validate(config)
    if (err) return { ok: false, detail: err }
    const host = String(config.host).trim()
    const port = Number(config.port)
    // Best-effort: ensure the host's DNS resolves + port is set. No TCP.
    try {
      const dnsOk = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(host)}&type=A`, {
        signal: AbortSignal.timeout(6000),
      })
        .then((r) => r.json().catch(() => null))
        .catch(() => null)
      const hasAnswer =
        !!dnsOk &&
        Array.isArray((dnsOk as { Answer?: unknown[] }).Answer) &&
        ((dnsOk as { Answer?: unknown[] }).Answer?.length ?? 0) > 0
      return {
        ok: true,
        detail: hasAnswer
          ? `Config OK — ${host}:${port} resolves. Live query needs a TCP bridge.`
          : `Config OK — ${host}:${port}. (DNS probe inconclusive; live query needs a TCP bridge.)`,
      }
    } catch {
      return {
        ok: true,
        detail: `Config OK — ${host}:${port}. Live query needs a TCP bridge.`,
      }
    }
  },
  buildMeta: buildSqlMeta,
}

const mysqlPlugin: DataPlugin = {
  kind: 'mysql',
  name: 'MySQL',
  icon: '🐬',
  description: 'Popular relational DB. (Live probe needs a TCP bridge.)',
  category: 'sql',
  configFields: buildSqlConfigFields('mysql'),
  validate(config) {
    return validateSqlConfig(config, mysqlPlugin.configFields)
  },
  async testConnection(config) {
    const err = mysqlPlugin.validate(config)
    if (err) return { ok: false, detail: err }
    const host = String(config.host).trim()
    const port = Number(config.port)
    return {
      ok: true,
      detail: `Config OK — ${host}:${port}. Live query needs a TCP bridge.`,
    }
  },
  buildMeta: buildSqlMeta,
}

// ---------------- Plugin: Google Sheets ----------------

const googleSheetsPlugin: DataPlugin = {
  kind: 'google_sheets',
  name: 'Google Sheets',
  icon: '📗',
  description: 'Read + append rows to a spreadsheet via the Sheets API.',
  category: 'sheets',
  configFields: [
    {
      key: 'apiKey',
      label: 'API key',
      type: 'password',
      placeholder: 'AIza…',
      required: true,
      secret: true,
      help: 'Create one in the Google Cloud Console (Sheets API enabled).',
    },
    {
      key: 'spreadsheetId',
      label: 'Spreadsheet ID',
      type: 'text',
      placeholder: '1A2B3C…',
      required: true,
      help: 'The long ID in the spreadsheet URL: /d/<ID>/edit',
    },
  ],
  validate(config) {
    const missing = missingFields(config, googleSheetsPlugin.configFields)
    if (missing.length) return `Missing: ${missing.join(', ')}`
    return null
  },
  async testConnection(config) {
    const apiKey = String(config.apiKey || '').trim()
    const spreadsheetId = String(config.spreadsheetId || '').trim()
    if (!apiKey || !spreadsheetId)
      return { ok: false, detail: 'Missing apiKey or spreadsheetId' }
    try {
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
        spreadsheetId,
      )}?key=${encodeURIComponent(apiKey)}&fields=sheets.properties.title`
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
      if (!res.ok) {
        if (res.status === 401 || res.status === 403)
          return { ok: false, detail: `Auth rejected (HTTP ${res.status}).` }
        if (res.status === 404)
          return { ok: false, detail: 'Spreadsheet not found (check the ID).' }
        return { ok: false, detail: `HTTP ${res.status}` }
      }
      const body = (await res.json().catch(() => null)) as
        | { sheets?: Array<{ properties?: { title?: string } }> }
        | null
      const sheets =
        body?.sheets
          ?.map((s) => s.properties?.title)
          .filter((t): t is string => typeof t === 'string' && t.length > 0) ??
        []
      return {
        ok: true,
        detail: `Connected — ${sheets.length} sheet(s) visible.`,
        tables: sheets,
      }
    } catch (err) {
      return {
        ok: false,
        detail: err instanceof Error ? err.message : 'Network error',
      }
    }
  },
  buildMeta(config) {
    return { spreadsheetId: String(config.spreadsheetId || '').trim() }
  },
}

// ---------------- Plugin: Notion ----------------

const notionPlugin: DataPlugin = {
  kind: 'notion',
  name: 'Notion',
  icon: '📝',
  description: 'Search + read pages/databases via the Notion API.',
  category: 'notes',
  configFields: [
    {
      key: 'token',
      label: 'Internal integration token',
      type: 'password',
      placeholder: 'secret_xxxxx…',
      required: true,
      secret: true,
      help: 'Create an internal integration at notion.so/my-integrations.',
    },
  ],
  validate(config) {
    const missing = missingFields(config, notionPlugin.configFields)
    if (missing.length) return `Missing: ${missing.join(', ')}`
    return null
  },
  async testConnection(config) {
    const token = String(config.token || '').trim()
    if (!token) return { ok: false, detail: 'Missing token' }
    try {
      const res = await fetch('https://api.notion.com/v1/search', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ page_size: 20 }),
        signal: AbortSignal.timeout(8000),
      })
      if (!res.ok) {
        if (res.status === 401 || res.status === 403)
          return { ok: false, detail: `Auth rejected (HTTP ${res.status}).` }
        return { ok: false, detail: `HTTP ${res.status}` }
      }
      const body = (await res.json().catch(() => null)) as
        | { results?: Array<{ object?: string; id?: string }> }
        | null
      const results = body?.results ?? []
      return {
        ok: true,
        detail: `Connected — ${results.length} accessible page(s)/database(s).`,
        tables: results
          .map((r) => r.id)
          .filter((id): id is string => typeof id === 'string'),
      }
    } catch (err) {
      return {
        ok: false,
        detail: err instanceof Error ? err.message : 'Network error',
      }
    }
  },
}

// ---------------- Plugin: SQLite (local, placeholder) ----------------

const sqliteLocalPlugin: DataPlugin = {
  kind: 'sqlite_local',
  name: 'Local SQLite',
  icon: '🪶',
  description: 'Reference a file on disk. (Desktop bridge only.)',
  category: 'sql',
  configFields: [
    {
      key: 'path',
      label: 'File path',
      type: 'text',
      placeholder: '/Users/me/data.sqlite',
      required: true,
      help: 'Absolute path to a .sqlite/.db file accessible to the Apical desktop bridge.',
    },
  ],
  validate(config) {
    const missing = missingFields(config, sqliteLocalPlugin.configFields)
    if (missing.length) return `Missing: ${missing.join(', ')}`
    return null
  },
  async testConnection(config) {
    const err = sqliteLocalPlugin.validate(config)
    if (err) return { ok: false, detail: err }
    return {
      ok: true,
      detail:
        'Config saved. The desktop bridge opens the file when a workflow queries it.',
    }
  },
  buildMeta(config) {
    return { path: String(config.path || '').trim() }
  },
}

// ---------------- Registry ----------------

export const DATA_PLUGINS: DataPlugin[] = [
  supabasePlugin,
  airtablePlugin,
  postgresPlugin,
  mysqlPlugin,
  googleSheetsPlugin,
  notionPlugin,
  sqliteLocalPlugin,
]

export function getPlugin(kind: string): DataPlugin | undefined {
  return DATA_PLUGINS.find((p) => p.kind === kind)
}

/**
 * Mask secret fields in a config object for safe return to the browser.
 * Non-secret fields pass through unchanged. Returns a shallow copy.
 */
export function maskConfig(
  kind: string,
  config: Record<string, unknown>,
): Record<string, unknown> {
  const plugin = getPlugin(kind)
  const out: Record<string, unknown> = {}
  if (!plugin) {
    // Unknown plugin — be conservative and mask anything that looks like a secret.
    for (const [k, v] of Object.entries(config)) {
      if (typeof v === 'string' && v.length > 4) out[k] = maskKey(v)
      else out[k] = v
    }
    return out
  }
  for (const f of plugin.configFields) {
    const v = config[f.key]
    if (v === undefined) continue
    if (f.secret) {
      out[f.key] = typeof v === 'string' && v.length > 4 ? maskKey(v) : '••••'
    } else {
      out[f.key] = v
    }
  }
  // Carry any extras (shouldn't happen, but be permissive).
  for (const [k, v] of Object.entries(config)) {
    if (!(k in out)) out[k] = v
  }
  return out
}
