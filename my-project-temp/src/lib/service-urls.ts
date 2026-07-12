// Central base URLs for the bundled mini-services (run-relay, desktop-bridge,
// agent-worker). They default to localhost — the single-box / desktop-local
// topology the whole system is designed around (Caddy + Next + the services
// co-located). Override per deployment via env so the services can live on
// other hosts without touching code. See the deploy runbook.
//
// Previously these were hardcoded `http://localhost:300x` literals scattered
// across the codebase, which silently broke any non-co-located deploy.

function clean(url: string): string {
  return url.replace(/\/+$/, '')
}

export interface ServiceUrls {
  RELAY_URL: string
  BRIDGE_URL: string
  BRIDGE_INVOKE_URL: string
  AGENT_WORKER_URL: string
}

/** Pure resolver (testable): compute service URLs from an env map. */
export function resolveServiceUrls(env: Record<string, string | undefined> = process.env): ServiceUrls {
  const RELAY_URL = clean(env.RELAY_URL || 'http://localhost:3003')
  // `DESKTOP_BRIDGE_URL` is honored for back-compat with the older name.
  const BRIDGE_URL = clean(env.BRIDGE_URL || env.DESKTOP_BRIDGE_URL || 'http://localhost:3005')
  const AGENT_WORKER_URL = clean(env.AGENT_WORKER_URL || 'http://localhost:3006')
  return { RELAY_URL, BRIDGE_URL, BRIDGE_INVOKE_URL: `${BRIDGE_URL}/invoke`, AGENT_WORKER_URL }
}

const resolved = resolveServiceUrls()

/** run-relay base (socket.io fan-out of run/step events). */
export const RELAY_URL = resolved.RELAY_URL
/** desktop-bridge base. */
export const BRIDGE_URL = resolved.BRIDGE_URL
/** desktop-bridge tool-invoke endpoint. */
export const BRIDGE_INVOKE_URL = resolved.BRIDGE_INVOKE_URL
/** agent-worker base (durable runs + browser sessions). */
export const AGENT_WORKER_URL = resolved.AGENT_WORKER_URL
