// Boot-time environment validation. Many subsystems here fail CLOSED and
// SILENT when their env is missing — the scheduler/relay/bridge just never do
// their job, agents return NO_LLM_PROVIDER_ERROR, web auth throws only when a
// user tries to log in. That makes a misconfigured deploy look "up" while
// being broken. assertEnv() surfaces the whole picture once, loudly, at boot:
// a grouped checklist of what's set vs missing, and in production it THROWS if
// a hard-required var is absent so the process fails fast instead of serving a
// broken app.
//
// Called from src/instrumentation.ts register() (server boot only — never at
// build time, never in the browser).

interface EnvGroup {
  title: string
  vars: string[]
  /** True → a missing var in this group is fatal in production. */
  hardRequired: boolean
  /** Skip this group entirely when this predicate is true. */
  skipWhen?: () => boolean
}

const isDesktopLocal = () => process.env.DESKTOP_LOCAL === 'true'

function anySet(names: string[]): boolean {
  return names.some((n) => !!process.env[n]?.trim())
}

const GROUPS: EnvGroup[] = [
  {
    title: 'Core (database + secrets)',
    vars: ['DATABASE_URL', 'DIRECT_URL', 'APICAL_VAULT_KEY', 'NEXTAUTH_SECRET'],
    hardRequired: true,
  },
  {
    title: 'Web authentication (Supabase)',
    vars: ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'],
    // Desktop-local uses the NextAuth credentials path, not Supabase.
    hardRequired: true,
    skipWhen: isDesktopLocal,
  },
  {
    title: 'Mini-service auth (hosted features: live streaming, schedules, bridge, worker)',
    vars: ['APICAL_RELAY_SECRET', 'APICAL_SCHEDULER_SECRET', 'APICAL_BRIDGE_SECRET', 'AGENT_WORKER_SECRET'],
    // In desktop-local the scheduler/bridge run in-process; the relay/worker
    // are optional. Not fatal, but strongly recommended for a hosted deploy.
    hardRequired: false,
  },
]

export interface EnvReport {
  ok: boolean
  missingHard: string[]
  lines: string[]
}

/** Build the env report without side effects (used by /api/health too). */
export function checkEnv(): EnvReport {
  const lines: string[] = []
  const missingHard: string[] = []
  for (const g of GROUPS) {
    if (g.skipWhen?.()) continue
    const missing = g.vars.filter((v) => !process.env[v]?.trim())
    const status = missing.length === 0 ? 'OK' : `MISSING: ${missing.join(', ')}`
    lines.push(`  [${missing.length === 0 ? '✓' : g.hardRequired ? '✗' : '!'}] ${g.title} — ${status}`)
    if (g.hardRequired) missingHard.push(...missing)
  }

  // At least one way to reach a model, else agents are inert. Recommended, not fatal.
  const hasLlm =
    anySet(['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GOOGLE_API_KEY', 'XAI_API_KEY', 'APICAL_PAT']) ||
    !!process.env.OLLAMA_BASE_URL?.trim()
  lines.push(
    `  [${hasLlm ? '✓' : '!'}] LLM provider — ${hasLlm ? 'OK' : 'none set (agents will error until a provider key, cloud PAT, or local model is configured)'}`,
  )
  // Optional integrations — informational only.
  lines.push(`  [${anySet(['SMTP_URI']) ? '✓' : '!'}] Email (SMTP_URI) — ${anySet(['SMTP_URI']) ? 'OK' : 'log-only (emails not sent)'}`)
  lines.push(`  [${anySet(['STRIPE_SECRET_KEY']) ? '✓' : '!'}] Billing (STRIPE_SECRET_KEY) — ${anySet(['STRIPE_SECRET_KEY']) ? 'OK' : 'demo mode (no real charges)'}`)

  return { ok: missingHard.length === 0, missingHard, lines }
}

/**
 * Demo OAuth "connections" mint a fake-but-active credential with no real
 * provider handshake (src/app/api/oauth/demo-connect). That's handy in a
 * dev/preview instance but dishonest in a launched product — a user would see a
 * provider as "Connected" when nothing is. So demo connections are OFF in
 * production unless a deploy explicitly opts in with ALLOW_DEMO_OAUTH=true
 * (e.g. a sales-demo instance).
 */
export function demoOAuthAllowed(): boolean {
  if (process.env.ALLOW_DEMO_OAUTH === 'true') return true
  return process.env.NODE_ENV !== 'production'
}

/**
 * Validate env at boot. Logs the grouped checklist; in production, throws when
 * a hard-required var is missing so the process fails fast.
 */
export function assertEnv(): void {
  const report = checkEnv()
  const header = '[env] configuration check:'
  console.log([header, ...report.lines].join('\n'))
  if (!report.ok) {
    const msg = `[env] missing required environment variables: ${report.missingHard.join(', ')}`
    if (process.env.NODE_ENV === 'production') {
      throw new Error(msg)
    }
    console.warn(`${msg} (non-production — continuing, but the app will not function fully)`)
  }
}
