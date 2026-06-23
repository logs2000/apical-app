// Apical — OpenAPI 3.x spec parser.
//
// Fetches an OpenAPI spec (JSON or YAML) from a URL or accepts a raw string,
// normalizes it to a common shape, and emits one `ToolDef` per operation
// (GET/POST/PUT/PATCH/DELETE on each path). This is the engine behind "paste
// an OpenAPI URL → get a real integration with real tools" — no per-connector
// code required.
//
// Designed to be tolerant: many real-world specs are slightly broken (missing
// operationId, missing summary, mixed v2/v3 fields). We always emit a tool
// with a sensible name + description + JSON-Schema-shaped inputSchema so the
// agent can call it, even if the spec is messy.
//
// Used by:
//   - POST /api/integrations — when `specUrl` is provided, we parse it and
//     replace the category-derived stub tools with real ones.
//   - POST /api/integrations/ingest-spec — on-demand ingestion used by the
//     research agent mid-flight (the agent discovers a spec URL while
//     researching a user's job and immediately turns it into a tool surface).
//
// We do NOT validate against the OpenAPI JSON Schema — that's strict and
// rejects many real-world specs. Instead, we extract what we can and degrade
// gracefully.

import yaml from 'js-yaml'
import type { ToolDef } from './types'

// ─── Types ──────────────────────────────────────────────────────────────────

/** The subset of OpenAPI 3.x we read. Fields we don't use are omitted. */
interface OpenApiSpec {
  openapi?: string
  swagger?: string // v2
  info?: {
    title?: string
    description?: string
    version?: string
  }
  servers?: Array<{ url: string; description?: string }>
  host?: string // v2
  basePath?: string // v2
  schemes?: string[] // v2
  paths?: Record<string, Record<string, OpenApiOperation>>
  components?: {
    schemas?: Record<string, OpenApiSchema>
    securitySchemes?: Record<string, OpenApiSecurityScheme>
  }
  // v2: securityDefinitions (renamed to securitySchemes in v3)
  securityDefinitions?: Record<string, OpenApiSecurityScheme>
  definitions?: Record<string, OpenApiSchema> // v2
  security?: Array<Record<string, string[]>>
}

/**
 * OpenAPI security scheme (v3) / security definition (v2).
 *
 * Per A2: OpenAPI ingestion is a DISCOVERY mechanism, ORTHOGONAL to auth.
 * We extract the declared security schemes and route them through F1/F2:
 *   - apiKey / http (basic/bearer) → vault static injection (F2)
 *   - oauth2 → F1 OAuth engine with BYOC client credentials (A3)
 *   - openIdConnect → F1 OAuth engine (treated as oauth2 with discovery)
 *
 * The auth resolution happens at integration-freeze time, NOT at parse time.
 * The parser just surfaces what the spec declares.
 */
export interface OpenApiSecurityScheme {
  type: 'apiKey' | 'http' | 'oauth2' | 'openIdConnect' | 'mutualTLS'
  description?: string
  // apiKey
  name?: string // header/query/cookie name
  in?: 'query' | 'header' | 'cookie'
  // http
  scheme?: string // "basic" | "bearer" | "digest" | ...
  bearerFormat?: string
  // oauth2
  flows?: {
    implicit?: OAuthFlow
    password?: OAuthFlow
    clientCredentials?: OAuthFlow
    authorizationCode?: OAuthFlow
  }
  // openIdConnect
  openIdConnectUrl?: string
}

export interface OAuthFlow {
  authorizationUrl?: string
  tokenUrl?: string
  refreshUrl?: string
  scopes?: Record<string, string>
}

type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete' | 'head' | 'options'

interface OpenApiOperation {
  operationId?: string
  summary?: string
  description?: string
  tags?: string[]
  deprecated?: boolean
  parameters?: OpenApiParameter[]
  requestBody?: OpenApiRequestBody
  /** Per-operation security overrides (v3). */
  security?: Array<Record<string, string[]>>
  // responses — we don't read these (the agent doesn't need them to call)
}

interface OpenApiParameter {
  name: string
  in: 'query' | 'header' | 'path' | 'cookie'
  description?: string
  required?: boolean
  deprecated?: boolean
  schema?: OpenApiSchema
  // v2 inline shape
  type?: string
  format?: string
  enum?: unknown[]
  default?: unknown
}

interface OpenApiRequestBody {
  description?: string
  required?: boolean
  content?: Record<string, { schema?: OpenApiSchema; example?: unknown }>
}

interface OpenApiSchema {
  type?: string
  format?: string
  description?: string
  $ref?: string
  // array
  items?: OpenApiSchema
  // object
  properties?: Record<string, OpenApiSchema>
  required?: string[]
  additionalProperties?: boolean | OpenApiSchema
  // enum
  enum?: unknown[]
  default?: unknown
  // v2 containers
  oneOf?: OpenApiSchema[]
  anyOf?: OpenApiSchema[]
  allOf?: OpenApiSchema[]
}

// ─── Fetching ───────────────────────────────────────────────────────────────

const SPEC_FETCH_TIMEOUT_MS = 15_000
const SPEC_MAX_BYTES = 5 * 1024 * 1024 // 5 MB cap

/**
 * Fetch a spec from a URL with a timeout + size cap. Returns the raw text.
 * Throws on non-2xx, timeout, or oversize.
 */
export async function fetchSpecText(specUrl: string): Promise<string> {
  let url: URL
  try {
    url = new URL(specUrl)
  } catch {
    throw new Error(`Invalid spec URL: ${specUrl}`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Spec URL must be http/https: ${specUrl}`)
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), SPEC_FETCH_TIMEOUT_MS)
  try {
    const resp = await fetch(specUrl, {
      signal: controller.signal,
      headers: { Accept: 'application/json, application/yaml, text/yaml, */*' },
      redirect: 'follow',
    })
    if (!resp.ok) {
      throw new Error(`Spec fetch failed: HTTP ${resp.status} ${resp.statusText}`)
    }
    // Cap the body size — large specs are usually a sign of a misconfigured
    // endpoint serving HTML or a giant download.
    const contentLength = parseInt(resp.headers.get('content-length') || '0', 10)
    if (contentLength && contentLength > SPEC_MAX_BYTES) {
      throw new Error(
        `Spec too large: ${contentLength} bytes (max ${SPEC_MAX_BYTES})`,
      )
    }
    const text = await resp.text()
    if (text.length > SPEC_MAX_BYTES) {
      throw new Error(
        `Spec too large: ${text.length} bytes (max ${SPEC_MAX_BYTES})`,
      )
    }
    return text
  } finally {
    clearTimeout(timer)
  }
}

// ─── Parsing ────────────────────────────────────────────────────────────────

/**
 * Parse a raw spec string (JSON or YAML) into a normalized OpenApiSpec.
 * Throws on completely unparseable input. Missing fields are tolerated.
 */
export function parseSpecText(text: string): OpenApiSpec {
  const trimmed = text.trim()
  if (!trimmed) throw new Error('Empty spec')

  // Try JSON first (strict, fast).
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.parse(trimmed) as OpenApiSpec
    } catch {
      // fall through to YAML
    }
  }

  // YAML (which is a superset of JSON, so this also handles JSON-as-YAML).
  try {
    return yaml.load(trimmed) as OpenApiSpec
  } catch (err) {
    throw new Error(
      `Spec is neither valid JSON nor YAML: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
}

// ─── $ref resolution ────────────────────────────────────────────────────────

/**
 * Resolve a `$ref` pointer like `#/components/schemas/Pet` against the spec.
 * Returns the resolved schema, or null if the pointer can't be followed.
 * Supports v2 (`#/definitions/...`) and v3 (`#/components/schemas/...`).
 */
function resolveRef(spec: OpenApiSpec, ref: string): OpenApiSchema | null {
  if (!ref.startsWith('#/')) return null
  const parts = ref.slice(2).split('/')
  let current: unknown = spec
  for (const part of parts) {
    if (current && typeof current === 'object' && part in (current as Record<string, unknown>)) {
      current = (current as Record<string, unknown>)[part]
    } else {
      return null
    }
  }
  return current as OpenApiSchema
}

/**
 * Inline-resolve all $ref pointers in a schema, with a depth cap to prevent
 * infinite recursion on self-referential schemas (e.g. tree nodes).
 */
const MAX_REF_DEPTH = 8
function derefSchema(
  spec: OpenApiSpec,
  schema: OpenApiSchema | undefined,
  depth = 0,
): OpenApiSchema | undefined {
  if (!schema || depth > MAX_REF_DEPTH) return schema
  if (schema.$ref) {
    const resolved = resolveRef(spec, schema.$ref)
    if (!resolved) return schema
    return derefSchema(spec, resolved, depth + 1)
  }
  // Recurse into common containers.
  const out: OpenApiSchema = { ...schema }
  if (schema.items) {
    out.items = derefSchema(spec, schema.items, depth + 1)
  }
  if (schema.properties) {
    out.properties = {}
    for (const [k, v] of Object.entries(schema.properties)) {
      out.properties[k] = derefSchema(spec, v, depth + 1) || v
    }
  }
  if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
    out.additionalProperties = derefSchema(spec, schema.additionalProperties, depth + 1)
  }
  if (schema.oneOf) out.oneOf = schema.oneOf.map((s) => derefSchema(spec, s, depth + 1) || s)
  if (schema.anyOf) out.anyOf = schema.anyOf.map((s) => derefSchema(spec, s, depth + 1) || s)
  if (schema.allOf) {
    // Merge allOf members into a single object schema (common pattern).
    const merged: OpenApiSchema = { type: 'object', properties: {}, required: [] }
    for (const member of schema.allOf) {
      const r = derefSchema(spec, member, depth + 1)
      if (r?.properties) {
        merged.properties = { ...merged.properties, ...r.properties }
      }
      if (r?.required) {
        merged.required = [...(merged.required || []), ...r.required]
      }
    }
    return merged
  }
  return out
}

// ─── JSON Schema emission ───────────────────────────────────────────────────

/**
 * Convert an OpenApiSchema into a plain JSON-Schema object suitable for the
 * `inputSchema` field on a ToolDef. We strip $refs, allOf merging, and
 * oneOf/anyOf (keeping only the first arm — agents can't pick branches).
 */
function schemaToJsonSchema(
  spec: OpenApiSpec,
  schema: OpenApiSchema | undefined,
): Record<string, unknown> | undefined {
  if (!schema) return undefined
  const r = derefSchema(spec, schema)
  if (!r) return undefined
  // Build a clean JSON-Schema object.
  const out: Record<string, unknown> = { type: r.type || 'object' }
  if (r.description) out.description = r.description
  if (r.format) out.format = r.format
  if (r.enum) out.enum = r.enum
  if (r.default !== undefined) out.default = r.default
  if (r.items) {
    const itemSchema = schemaToJsonSchema(spec, r.items)
    if (itemSchema) out.items = itemSchema
  }
  if (r.properties) {
    const props: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(r.properties)) {
      const sub = schemaToJsonSchema(spec, v)
      if (sub) props[k] = sub
    }
    out.properties = props
  }
  if (r.required && r.required.length > 0) out.required = r.required
  return out
}

// ─── Tool emission ──────────────────────────────────────────────────────────

const HTTP_METHODS: HttpMethod[] = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options']

/**
 * Turn an HTTP method + path + operation into a stable tool id.
 * Prefers operationId; falls back to `<method>_<path-as-slug>`.
 */
function toolIdFor(method: HttpMethod, path: string, op: OpenApiOperation): string {
  if (op.operationId && /^[a-zA-Z0-9_]+$/.test(op.operationId)) {
    return op.operationId
  }
  // Slugify the path: /users/{id}/posts → users_id_posts
  const slug = path
    .replace(/[{}]/g, '')
    .split('/')
    .filter(Boolean)
    .join('_')
    .replace(/[^a-zA-Z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return `${method}_${slug || 'root'}`
}

/**
 * Build a human-readable tool name for display. Prefers the operation's
 * `summary`; falls back to operationId; falls back to "<METHOD> <path>".
 */
function toolNameFor(method: HttpMethod, path: string, op: OpenApiOperation): string {
  if (op.summary && op.summary.trim()) return op.summary.trim()
  if (op.operationId && op.operationId.trim()) return op.operationId.trim()
  return `${method.toUpperCase()} ${path}`
}

/**
 * Build a tool description. Combines the operation description, method, path,
 * and tags so the agent has enough context to pick the right tool.
 */
function toolDescriptionFor(
  method: HttpMethod,
  path: string,
  op: OpenApiOperation,
  baseUrl?: string,
): string {
  const parts: string[] = []
  parts.push(`${method.toUpperCase()} ${path}`)
  if (baseUrl) parts.push(`(base: ${baseUrl})`)
  if (op.description && op.description.trim()) {
    parts.push('— ' + op.description.trim())
  } else if (op.summary && op.summary.trim()) {
    parts.push('— ' + op.summary.trim())
  }
  if (op.tags && op.tags.length > 0) {
    parts.push(`[tags: ${op.tags.join(', ')}]`)
  }
  if (op.deprecated) parts.push('[DEPRECATED]')
  return parts.join(' ')
}

/**
 * Build the inputSchema for a tool from the operation's parameters + body.
 * Combines path/query/header params and a single body object into one
 * JSON-Schema object with `properties`, `required`, and `additionalProperties: false`.
 */
function inputSchemaFor(
  spec: OpenApiSpec,
  op: OpenApiOperation,
): Record<string, unknown> | undefined {
  const properties: Record<string, unknown> = {}
  const required: string[] = []

  // Parameters (path / query / header / cookie).
  for (const param of op.parameters || []) {
    if (!param.name) continue
    const sub: Record<string, unknown> = {
      type: param.schema?.type || param.type || 'string',
    }
    if (param.description) sub.description = param.description
    if (param.schema?.format || param.format) sub.format = param.schema?.format || param.format
    if (param.schema?.enum || param.enum) sub.enum = param.schema?.enum || param.enum
    if (param.schema?.default !== undefined) sub.default = param.schema.default
    else if (param.default !== undefined) sub.default = param.default
    // Annotate where the param lives so the runtime can place it correctly.
    sub.in = param.in
    properties[param.name] = sub
    if (param.required) required.push(param.name)
  }

  // Request body — we extract the first JSON-like content schema and merge its
  // properties under a `body` field. The runtime then sends the merged object
  // as the JSON body.
  if (op.requestBody?.content) {
    const jsonKey =
      Object.keys(op.requestBody.content).find((k) =>
        k.toLowerCase().includes('json'),
      ) || Object.keys(op.requestBody.content)[0]
    const bodySchema = jsonKey ? op.requestBody.content[jsonKey]?.schema : undefined
    if (bodySchema) {
      const dereffed = derefSchema(spec, bodySchema)
      if (dereffed?.properties) {
        // Wrap under `body`.
        const bodyProps: Record<string, unknown> = {}
        for (const [k, v] of Object.entries(dereffed.properties)) {
          bodyProps[k] = schemaToJsonSchema(spec, v) || { type: 'string' }
        }
        properties.body = {
          type: 'object',
          properties: bodyProps,
          required: dereffed.required || [],
          description: dereffed.description || 'Request body (JSON).',
        }
        if (op.requestBody.required) required.push('body')
      } else if (dereffed?.type) {
        // Body is a primitive or array — wrap as `body`.
        properties.body = schemaToJsonSchema(spec, dereffed) || { type: 'string' }
        if (op.requestBody.required) required.push('body')
      }
    }
  }

  if (Object.keys(properties).length === 0) return undefined
  return {
    type: 'object',
    properties,
    required: required.length > 0 ? required : undefined,
    additionalProperties: false,
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * The resolved auth scheme for an ingested spec. Per A2: OpenAPI ingestion is
 * a DISCOVERY mechanism, ORTHOGONAL to auth. The parser extracts what the
 * spec declares; the integration-freeze step then routes through F1/F2:
 *
 *   - apiKey / http (basic/bearer) → vault static injection (F2)
 *   - oauth2 → F1 OAuth engine with BYOC client credentials (A3)
 *   - openIdConnect → F1 OAuth engine (treated as oauth2 with discovery)
 *   - none / missing → no auth (public API)
 */
export interface ResolvedAuthScheme {
  /** The canonical auth type Apical will use at execution time. */
  type: 'none' | 'apikey' | 'bearer' | 'basic' | 'oauth2'
  /** The original scheme key from the spec (e.g. "ApiKeyAuth", "OAuth2"). */
  schemeName?: string
  /** For apikey: the header/query/cookie name to inject the key into. */
  headerName?: string
  /** For apikey: where the key goes ("header" | "query" | "cookie"). */
  headerIn?: 'header' | 'query' | 'cookie'
  /** For oauth2: the authorization URL (from flows.authorizationCode). */
  authorizationUrl?: string
  /** For oauth2: the token URL (from flows.authorizationCode). */
  tokenUrl?: string
  /** For oauth2: the refresh URL (from flows). */
  refreshUrl?: string
  /** For oauth2: the available scopes (space-joined). */
  scopes?: string
  /** The original OpenAPI security scheme object (for reference). */
  raw: OpenApiSecurityScheme
}

export interface OpenApiIngestResult {
  /** The spec title (from info.title). */
  title: string
  /** The spec description (from info.description). */
  description: string
  /** The spec version (from info.version). */
  version: string
  /** The base URL the API is served from (best-effort — first server.url). */
  baseUrl: string | undefined
  /** The detected spec version ("2.0" | "3.x" | "unknown"). */
  specVersion: string
  /** The number of operations parsed (before the cap). */
  totalOperations: number
  /** The tools emitted (capped at MAX_TOOLS_PER_SPEC). */
  tools: ToolDef[]
  /** The raw spec text (for debugging / storage). */
  rawSpec: string
  /**
   * The resolved auth schemes declared by the spec. Multiple schemes may be
   * declared; the integration-freeze step picks one (with the user/agent's
   * input). Empty array = spec declares no security (public API).
   */
  authSchemes: ResolvedAuthScheme[]
}

export const MAX_TOOLS_PER_SPEC = 200

// ─── Security scheme resolution ─────────────────────────────────────────────

/**
 * Resolve the security schemes declared in a spec into Apical's canonical
 * auth types. Per A2: OpenAPI ingestion is ORTHOGONAL to auth — we surface
 * what the spec declares, the freeze step picks one and routes through F1/F2.
 *
 * v3: spec.components.securitySchemes
 * v2: spec.securityDefinitions
 *
 * Returns an array (specs may declare multiple schemes). Empty = no security
 * declared (public API).
 */
export function resolveAuthSchemes(spec: OpenApiSpec): ResolvedAuthScheme[] {
  const raw = spec.components?.securitySchemes || spec.securityDefinitions || {}
  const out: ResolvedAuthScheme[] = []
  for (const [schemeName, scheme] of Object.entries(raw)) {
    if (!scheme || typeof scheme !== 'object') continue
    const resolved = resolveOneScheme(schemeName, scheme)
    if (resolved) out.push(resolved)
  }
  return out
}

function resolveOneScheme(
  schemeName: string,
  scheme: OpenApiSecurityScheme,
): ResolvedAuthScheme | null {
  switch (scheme.type) {
    case 'apiKey':
      return {
        type: 'apikey',
        schemeName,
        headerName: scheme.name,
        headerIn: scheme.in,
        raw: scheme,
      }
    case 'http':
      if (scheme.scheme === 'bearer') {
        return { type: 'bearer', schemeName, raw: scheme }
      }
      if (scheme.scheme === 'basic') {
        return { type: 'basic', schemeName, raw: scheme }
      }
      // Other http schemes (digest, etc.) — treat as bearer for injection.
      return { type: 'bearer', schemeName, raw: scheme }
    case 'oauth2': {
      // Prefer the authorizationCode flow (the only one we run interactively).
      const flow = scheme.flows?.authorizationCode
      if (!flow) return null
      const scopes = flow.scopes ? Object.keys(flow.scopes).join(' ') : ''
      return {
        type: 'oauth2',
        schemeName,
        authorizationUrl: flow.authorizationUrl,
        tokenUrl: flow.tokenUrl,
        refreshUrl: flow.refreshUrl,
        scopes,
        raw: scheme,
      }
    }
    case 'openIdConnect':
      // Treat as oauth2 with discovery — F1 handles OIDC discovery.
      return {
        type: 'oauth2',
        schemeName,
        raw: scheme,
      }
    case 'mutualTLS':
      // Not supported — skip.
      return null
    default:
      return null
  }
}

// ─── Tool filtering ─────────────────────────────────────────────────────────

/**
 * Filter a list of ingested tools to a selected subset. Per A2: a 400-endpoint
 * spec must NOT dump 400 tools into the agent's context. The user (or the
 * agent, supervised) picks the relevant subset, then we freeze it.
 *
 * Selection modes:
 *   - "all"      — return all tools (capped at MAX_TOOLS_PER_SPEC).
 *   - "by_id"    — return only the tools whose id is in `selectedIds`.
 *   - "by_tag"   — return only the tools whose description contains [tags: <tag>]
 *                  for at least one tag in `selectedTags`.
 *   - "by_path"  — return only the tools whose description starts with
 *                  "<METHOD> <path>" matching one of `selectedPathPrefixes`.
 *
 * Returns the filtered list + a count of how many were dropped.
 */
export interface ToolFilter {
  mode: 'all' | 'by_id' | 'by_tag' | 'by_path'
  selectedIds?: string[]
  selectedTags?: string[]
  selectedPathPrefixes?: string[]
}

export function filterTools(
  tools: ToolDef[],
  filter: ToolFilter,
): { tools: ToolDef[]; dropped: number } {
  if (filter.mode === 'all' || !filter) {
    return { tools, dropped: 0 }
  }
  if (filter.mode === 'by_id') {
    const ids = new Set(filter.selectedIds || [])
    const kept = tools.filter((t) => ids.has(t.id))
    return { tools: kept, dropped: tools.length - kept.length }
  }
  if (filter.mode === 'by_tag') {
    const tags = (filter.selectedTags || []).map((t) => t.toLowerCase())
    const kept = tools.filter((t) => {
      const m = t.description.match(/\[tags:\s*([^\]]+)\]/i)
      if (!m) return false
      const toolTags = m[1].split(',').map((s) => s.trim().toLowerCase())
      return toolTags.some((tt) => tags.includes(tt))
    })
    return { tools: kept, dropped: tools.length - kept.length }
  }
  if (filter.mode === 'by_path') {
    const prefixes = filter.selectedPathPrefixes || []
    const kept = tools.filter((t) =>
      prefixes.some((p) => t.description.includes(p)),
    )
    return { tools: kept, dropped: tools.length - kept.length }
  }
  return { tools, dropped: 0 }
}

// ─── Ingest ─────────────────────────────────────────────────────────────────

/**
 * Ingest an OpenAPI spec from a URL: fetch, parse, walk paths, emit tools.
 * Always returns a result object — never throws. On failure, `tools` is empty
 * and `error` is set.
 */
export async function ingestOpenApiSpec(
  specUrl: string,
): Promise<OpenApiIngestResult & { error?: string }> {
  let rawSpec: string
  try {
    rawSpec = await fetchSpecText(specUrl)
  } catch (err) {
    return {
      title: '',
      description: '',
      version: '',
      baseUrl: undefined,
      specVersion: 'unknown',
      totalOperations: 0,
      tools: [],
      rawSpec: '',
      authSchemes: [],
      error: err instanceof Error ? err.message : String(err),
    }
  }
  return ingestOpenApiSpecText(rawSpec, specUrl)
}

/**
 * Ingest an OpenAPI spec from a raw text string. Same as `ingestOpenApiSpec`
 * but skips the fetch step. The `sourceUrl` is stashed on each tool's
 * `description` for traceability.
 */
export function ingestOpenApiSpecText(
  rawSpec: string,
  sourceUrl?: string,
): OpenApiIngestResult & { error?: string } {
  let spec: OpenApiSpec
  try {
    spec = parseSpecText(rawSpec)
  } catch (err) {
    return {
      title: '',
      description: '',
      version: '',
      baseUrl: undefined,
      specVersion: 'unknown',
      totalOperations: 0,
      tools: [],
      rawSpec,
      authSchemes: [],
      error: err instanceof Error ? err.message : String(err),
    }
  }

  const specVersion = spec.openapi
    ? `3.x (${spec.openapi})`
    : spec.swagger
      ? `2.0 (${spec.swagger})`
      : 'unknown'

  const baseUrl =
    spec.servers && spec.servers.length > 0
      ? spec.servers[0].url
      : spec.schemes && spec.host
        ? `${spec.schemes[0] || 'https'}://${spec.host}${spec.basePath || ''}`
        : undefined

  const tools: ToolDef[] = []
  let totalOperations = 0

  const paths = spec.paths || {}
  for (const [path, methods] of Object.entries(paths)) {
    if (!methods || typeof methods !== 'object') continue
    for (const method of HTTP_METHODS) {
      const op = (methods as Record<string, unknown>)[method] as
        | OpenApiOperation
        | undefined
      if (!op || typeof op !== 'object') continue
      // Note: `parameters` (path-level) and `summary` are not in HTTP_METHODS,
      // so they're naturally skipped — no extra check needed.
      totalOperations++

      if (tools.length >= MAX_TOOLS_PER_SPEC) continue

      const id = toolIdFor(method, path, op)
      // Skip duplicates (some specs list the same operationId across paths).
      if (tools.some((t) => t.id === id)) continue

      const tool: ToolDef = {
        id,
        name: toolNameFor(method, path, op),
        description: toolDescriptionFor(method, path, op, baseUrl),
        integrationId: '',
        inputSchema: inputSchemaFor(spec, op),
      }
      // Stash the source URL on the description for traceability.
      if (sourceUrl) {
        tool.description += ` [spec: ${sourceUrl}]`
      }
      tools.push(tool)
    }
  }

  // Resolve auth schemes declared by the spec. The integration-freeze step
  // picks one and routes through F1/F2.
  const authSchemes = resolveAuthSchemes(spec)

  return {
    title: spec.info?.title || 'Untitled API',
    description: spec.info?.description || '',
    version: spec.info?.version || '0.0.0',
    baseUrl,
    specVersion,
    totalOperations,
    tools,
    rawSpec,
    authSchemes,
  }
}
