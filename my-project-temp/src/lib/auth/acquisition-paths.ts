// Apical — Acquisition method decisions (A3 / A4 / A5).
//
// This module documents the strategic decisions for A3, A4, and A5 in code
// (not just comments) so they're queryable at runtime + flagged for review.
// See the governing architecture in the conversation transcript for the full
// rationale.
//
// A3 — First-party OAuth apps for Google Workspace / Microsoft 365 / Slack.
//   DECISION (v1 default): BYOC for these providers. The user registers their
//   own OAuth app and pastes client_id/secret. Honest per-provider UX about
//   friction — trivial for Slack/Notion/Linear/GitHub, painful for Google/Meta
//   (consent screen, scopes, possible verification of the user's own app).
//   First-party apps EXPLICITLY DEFERRED — flagged below for user confirmation
//   before the v1 ship cut. Do NOT silently register first-party apps; do NOT
//   silently hardcode either choice.
//
// A4 — Unified-API adapters (Merge / Paragon / Apideck / Vessel).
//   DECISION (v1 default): NOT shipped. Opt-in cloud adapter ONLY, never a
//   default. If implemented, it's behind APICAL_UNIFIED_API_ENABLED=true AND
//   the user explicitly provides their own adapter account credentials. A
//   self-hosted Apical must work fully without it. Rationale: per-call pricing
//   is hostile to high-volume automation; routing through a third-party cloud
//   violates local-first; category-scoped (CRM/HR/accounting) not generic.
//
// A5 — Browser session reuse (Playwright/Puppeteer).
//   DECISION (v1 default): NOT shipped. Last-resort, opt-in ONLY. Requires
//   explicit per-integration user acknowledgement of the risks (ToS violation,
//   theft target, brittleness). Never marketed as a feature; never auto-selected.

/** A3 deferral: first-party OAuth apps for the highest-friction providers. */
export const A3_FIRST_PARTY_OAUTH_DEFERRED = true

/**
 * The list of providers for which first-party OAuth apps would be strategic
 * (per A3). When A3 is flipped off (first-party apps registered), these
 * providers get the first-party treatment; BYOC remains the fallback for
 * everything else.
 *
 * FLAGGED FOR USER CONFIRMATION: do not register first-party apps for these
 * without an explicit decision. The current default is BYOC.
 */
export const A3_STRATEGIC_PROVIDERS = [
  'google', // Google Workspace (Gmail, Drive, Calendar, Sheets)
  'microsoft', // Microsoft 365 (Outlook, OneDrive, Teams)
  'slack', // Slack (the one with the most friction variance)
] as const

/** A4 flag: unified-API adapters. Default OFF. */
export const A4_UNIFIED_API_ENABLED =
  (process.env.APICAL_UNIFIED_API_ENABLED || '').toLowerCase() === 'true'

/**
 * A4 risk label. Surfaced in the UI when the user enables the unified-API
 * adapter so they understand what they're opting into.
 */
export const A4_RISK_LABEL =
  'Cloud dependency: routing API calls through a third-party unified-API service (Merge/Paragon/Apideck/Vessel). Per-call pricing applies. Not local-first.'

/** A5 flag: browser session reuse. Default OFF. */
export const A5_BROWSER_SESSION_ENABLED =
  (process.env.APICAL_BROWSER_SESSION_ENABLED || '').toLowerCase() === 'true'

/**
 * A5 risk label. Surfaced in the UI when the user enables browser session
 * reuse. Requires EXPLICIT per-integration acknowledgement — never auto-select.
 */
export const A5_RISK_LABEL =
  'High-risk: persisting logged-in browser sessions is a ToS violation for most platforms. Stored session cookies are a high-value theft target. Bot detection makes it brittle. For use only when no API exists and the user explicitly accepts the risk.'

/**
 * Resolve which acquisition path Apical should use for a given target
 * integration. Per the resolution order in the governing architecture:
 *
 *   1. Is there a usable MCP server? → A1.
 *   2. Else, is there an OpenAPI spec (or known API)? → A2: ingest for tools,
 *      resolve auth via declared scheme (static → F2; oauth2 → F1 + BYOC).
 *   3. For Google / Microsoft / Slack specifically → per the A3 decision
 *      (default BYOC in v1).
 *   4. Only if the user has explicitly enabled it → A4 cloud adapter.
 *   5. Only if there is no API at all and the user accepts the risk → A5.
 *
 * Returns the recommended path + a reason (for the UI to surface to the user).
 */
export function resolveAcquisitionPath(opts: {
  hasMcpServer?: boolean
  hasOpenApiSpec?: boolean
  /** The provider key, if known (e.g. "google", "slack"). */
  providerKey?: string
  /** Has the user explicitly enabled A4 (unified-API adapter)? */
  a4Enabled?: boolean
  /** Has the user explicitly enabled A5 (browser session reuse)? */
  a5Enabled?: boolean
  /** Does the target have any API at all? */
  hasAnyApi?: boolean
}): {
  path: 'A1' | 'A2' | 'A3' | 'A4' | 'A5' | 'NONE'
  reason: string
} {
  // 1. MCP server — primary surface.
  if (opts.hasMcpServer) {
    return {
      path: 'A1',
      reason: 'A usable MCP server exists. Apical connects via the MCP client (OAuth 2.1 or static token).',
    }
  }

  // 2. OpenAPI spec or known API.
  if (opts.hasOpenApiSpec || opts.hasAnyApi) {
    // 3. Strategic provider check.
    if (
      opts.providerKey &&
      A3_STRATEGIC_PROVIDERS.includes(
        opts.providerKey as (typeof A3_STRATEGIC_PROVIDERS)[number],
      )
    ) {
      return {
        path: 'A3',
        reason: `Strategic provider (${opts.providerKey}). Per A3 v1 decision: BYOC. The user registers their own OAuth app and pastes client_id/secret. First-party apps are deferred.`,
      }
    }
    return {
      path: 'A2',
      reason: 'OpenAPI spec or known API. Ingest the spec for tools; resolve auth via declared scheme (static → F2 vault; oauth2 → F1 + BYOC).',
    }
  }

  // 4. Unified-API adapter (opt-in only).
  if (opts.a4Enabled && A4_UNIFIED_API_ENABLED) {
    return {
      path: 'A4',
      reason: `Unified-API adapter (opt-in). ${A4_RISK_LABEL}`,
    }
  }

  // 5. Browser session reuse (last resort, opt-in only).
  if (opts.a5Enabled && A5_BROWSER_SESSION_ENABLED) {
    return {
      path: 'A5',
      reason: `Browser session reuse (last resort). ${A5_RISK_LABEL}`,
    }
  }

  return {
    path: 'NONE',
    reason: 'No viable acquisition path. The target has no MCP server, no API, and no opt-in adapters are enabled.',
  }
}
