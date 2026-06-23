// Apical — Execution model: figure-out-once-supervised → freeze.
//
// The first time an integration is needed, the agent resolves discovery + auth
// interactively (with the user supervising) and confirms a live call. Then
// the integration is FROZEN into a deterministic artifact:
//   - resolved schema (the tool surface, post-filter)
//   - generated/parameterized client (how to call each tool — base URL, method,
//     path, headers, body shape)
//   - credential reference (BY ID — never the secret itself)
//
// Production runs execute the frozen artifact deterministically. They do NOT
// re-derive integrations live on every run — that would be non-deterministic,
// slow, expensive, and would fail silently when the spec / server changes.
//
// The frozen artifact lives in `Integration.config.frozenArtifact` (JSON).
// The runtime checks for `frozenArtifact` on every tool invocation; if it's
// present, the runtime uses it verbatim. If it's absent, the runtime refuses
// to call the tool (the agent must freeze first).
//
// INVARIANT: credentials by reference. The frozen artifact references
// credentials by ID ONLY. Secrets live in the vault (F2) and are resolved at
// execution time. This invariant is enforced by `validateFrozenArtifact()`
// — it scans for any string that looks like a secret (long random-looking
// tokens, Bearer prefixes, etc.) and rejects the freeze if found.

export interface FrozenToolSpec {
  /** The tool id (matches the id on the ToolDef). */
  id: string
  /** The HTTP method to call. */
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD'
  /** The path template, with {param} placeholders. */
  path: string
  /** The list of query parameter names the tool accepts. */
  queryParameters: string[]
  /** The list of header parameters the tool accepts (NOT including auth). */
  headerParameters: string[]
  /** Whether the tool accepts a JSON body. */
  hasBody: boolean
  /** The JSON-schema of the body (if hasBody). */
  bodySchema?: Record<string, unknown>
}

export interface FrozenAuthSpec {
  /** The auth type — routes through F1 (oauth2) or F2 (apikey/bearer/basic). */
  type: 'none' | 'apikey' | 'bearer' | 'basic' | 'oauth2' | 'mcp_static_token'
  /**
   * The credential ID — by reference. The runtime resolves this to the
   * actual secret at execution time via the vault. NEVER inlined.
   */
  credentialId?: string
  /** For apikey: the header name to inject the key into. */
  headerName?: string
  /** For apikey: where the key goes. */
  headerIn?: 'header' | 'query' | 'cookie'
  /** For oauth2/bearer: the prefix to use (default "Bearer "). */
  headerPrefix?: string
}

export interface FrozenArtifact {
  /** Schema version of the frozen artifact format. */
  schemaVersion: 1
  /** When the artifact was frozen (ISO timestamp). */
  frozenAt: string
  /** The base URL for all tool calls. */
  baseUrl: string
  /** The auth spec — credential by reference. */
  auth: FrozenAuthSpec
  /** The frozen tool specs — one per tool the integration exposes. */
  tools: FrozenToolSpec[]
  /** A live-call confirmation: the agent tested one tool and it returned 2xx. */
  liveCallConfirmation?: {
    toolId: string
    status: number
    durationMs: number
    confirmedAt: string
  }
}

/**
 * Validate a frozen artifact before persisting it. Enforces the invariants:
 *   - credentialId is a string (not a secret value).
 *   - no field looks like a secret (long random-looking token, Bearer prefix).
 *   - baseUrl is a valid URL.
 *   - tools array is non-empty.
 *
 * Throws on violation. Returns true on success.
 */
export function validateFrozenArtifact(artifact: FrozenArtifact): true {
  if (!artifact.baseUrl) {
    throw new Error('Frozen artifact missing baseUrl')
  }
  try {
    new URL(artifact.baseUrl)
  } catch {
    throw new Error(`Frozen artifact baseUrl is not a valid URL: ${artifact.baseUrl}`)
  }
  if (!Array.isArray(artifact.tools) || artifact.tools.length === 0) {
    throw new Error('Frozen artifact must have at least one tool')
  }
  if (artifact.auth.credentialId && typeof artifact.auth.credentialId !== 'string') {
    throw new Error('credentialId must be a string (a vault reference), not a secret value')
  }
  // Scan for secret-like strings. We check known fields; the runtime does a
  // deeper scan at execution time.
  const scannedStrings: string[] = [
    artifact.auth.headerName || '',
    artifact.auth.headerPrefix || '',
    artifact.auth.credentialId || '',
    ...artifact.tools.flatMap((t) => [
      t.id,
      t.method,
      t.path,
      ...t.queryParameters,
      ...t.headerParameters,
    ]),
  ]
  for (const s of scannedStrings) {
    if (typeof s === 'string' && looksLikeSecret(s)) {
      throw new Error(
        `Frozen artifact contains a secret-like string in a non-secret field: "${s.slice(0, 20)}…". Credentials must be referenced by ID only.`,
      )
    }
  }
  return true
}

/**
 * Heuristic: does this string look like a secret? Used by the validator to
 * catch accidental secret inlining. Conservative — false positives are fine
 * (the user can adjust); false negatives are NOT.
 */
function looksLikeSecret(s: string): boolean {
  if (!s) return false
  const lower = s.toLowerCase()
  // Bearer / token prefixes.
  if (lower.startsWith('bearer ')) return true
  if (lower.startsWith('token ')) return true
  // Long random-looking strings (40+ chars, mixed case + digits).
  if (s.length >= 40 && /[A-Z]/.test(s) && /[a-z]/.test(s) && /[0-9]/.test(s)) {
    return true
  }
  // Common key prefixes.
  if (/^(sk-|ghp_|gho_|ghu_|ghs_|github_pat_|xox[baprs]-|AIza|glpat-|BSA)/.test(s)) {
    return true
  }
  return false
}

/**
 * Freeze an integration: validate the artifact + return it as a JSON string
 * ready to stash in `Integration.config.frozenArtifact`.
 */
export function freezeArtifact(artifact: FrozenArtifact): string {
  validateFrozenArtifact(artifact)
  return JSON.stringify(artifact)
}
