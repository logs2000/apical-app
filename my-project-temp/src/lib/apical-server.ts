// Apical domain helpers — parsing workflow JSON, step-kind metadata, examples.

import type {
  WorkflowJSON,
  WorkflowStep,
  StepKind,
  Integration,
  ToolDef,
  Department,
} from './types'

// ---------------- Agent naming ----------------
// Two styles, controlled per-user via UserProfile.agentNameStyle:
//   • 'evocative'   — short, friendly, non-human (Nomi, Vexa, Kiro).
//   • 'descriptive' — derived from the job description (SortAgent, InvoiceAgent).
//
// `generateAgentName(style, jobDescription, existingNames?)` picks a name in
// the chosen style, avoiding any name already in use in the workspace.

export const EVOCATIVE_NAMES = [
  'Nomi', 'Vexa', 'Kiro', 'Mavo', 'Sova', 'Lumo', 'Talo', 'Vero',
  'Oryn', 'Nexo', 'Kova', 'Arvo', 'Zylo', 'Vilo', 'Runa', 'Kovo',
] as const

export type AgentNameStyle = 'evocative' | 'descriptive'

/** Words that should never be turned into a descriptive name on their own. */
const DESCRIPTIVE_STOPWORDS = new Set([
  'the', 'a', 'an', 'my', 'your', 'our', 'this', 'that', 'and', 'or',
  'with', 'for', 'to', 'of', 'in', 'on', 'at', 'by', 'is', 'are',
  'i', 'we', 'us', 'me', 'please', 'need', 'want', 'would', 'should',
  'could', 'can', 'do', 'does', 'did', 'will', 'shall', 'may', 'might',
  'into', 'from', 'over', 'under', 'about', 'when', 'where', 'who',
  'what', 'which', 'how', 'why', 'every', 'each', 'all', 'any', 'some',
])

/**
 * Derive a descriptive agent name from a job description.
 *   "sort the PDFs my scanner dumps"     → "SortAgent"
 *   "chase overdue invoices daily"        → "InvoiceAgent"
 *   "audit new expense reports"           → "AuditAgent"
 *   "post new invoices to twitter"        → "InvoiceAgent"
 * Picks the most "noun-like" or "verb-like" content word and Capitalizes it.
 */
function descriptiveNameFromJob(job: string): string {
  const cleaned = job
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!cleaned) return 'Agent'

  // Strip leading verbs (sort/chase/audit/send/post/list/draft/check/file)
  // so the descriptive name is the *thing*, not the action. This matches the
  // examples in the brief: "sort PDFs" → "SortAgent"? The brief shows BOTH
  // "SortAgent" (verb) and "InvoiceAgent" (noun). We pick verb-first when the
  // first word is a known action verb; otherwise noun-first.
  const ACTION_VERBS = new Set([
    'sort', 'chase', 'audit', 'send', 'post', 'list', 'draft', 'check',
    'file', 'read', 'watch', 'monitor', 'notify', 'extract', 'classify',
    'review', 'flag', 'approve', 'process', 'pull', 'scan', 'sync',
  ])

  const words = cleaned.split(' ').filter((w) => w && !DESCRIPTIVE_STOPWORDS.has(w))
  if (words.length === 0) return 'Agent'

  // Prefer the first action verb if the sentence starts with one — "Sort PDFs" → "Sort".
  if (ACTION_VERBS.has(words[0])) {
    const w = words[0]
    return capitalize(w) + 'Agent'
  }

  // Otherwise pick the longest content word (likely the noun): "overdue invoices" → "Invoice".
  const longest = [...words].sort((a, b) => b.length - a.length)[0]
  // Singularize naive: strip trailing 's' if length > 3.
  let stem = longest
  if (stem.length > 3 && stem.endsWith('s') && !stem.endsWith('ss')) {
    stem = stem.slice(0, -1)
  }
  return capitalize(stem) + 'Agent'
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/**
 * Pick an unused evocative name (deterministic-ish — shuffles once, then walks).
 * If every name is taken, append a number to the first available.
 */
function pickUnusedEvocative(existing: Set<string>): string {
  // Shuffle deterministically per call so two rapid calls don't always pick the
  // same name. (We don't have a per-call seed; Math.random is fine for this.)
  const shuffled = [...EVOCATIVE_NAMES].sort(() => Math.random() - 0.5)
  for (const n of shuffled) {
    if (!existing.has(n)) return n
  }
  // All taken — pick the first and append a counter.
  const base = EVOCATIVE_NAMES[0]
  let i = 2
  while (existing.has(`${base}${i}`)) i++
  return `${base}${i}`
}

/**
 * Generate an agent name in the user's preferred style.
 *
 * @param style           'evocative' or 'descriptive' (from UserProfile.agentNameStyle).
 * @param jobDescription  The user's job description (used for descriptive names).
 * @param existingNames   Optional list of names already in use in this workspace
 *                        (so evocative names don't collide). Descriptive names are
 *                        derived from the job and only de-duped when they collide.
 */
export function generateAgentName(
  style: AgentNameStyle,
  jobDescription: string,
  existingNames: string[] = [],
): string {
  const existingSet = new Set(existingNames.map((n) => n.trim().toLowerCase()))

  if (style === 'descriptive') {
    const base = descriptiveNameFromJob(jobDescription || '')
    if (!existingSet.has(base.toLowerCase())) return base
    // Collision — append a number.
    let i = 2
    while (existingSet.has(`${base}${i}`.toLowerCase())) i++
    return `${base}${i}`
  }

  // evocative — pick an unused name from the list.
  const casedExisting = new Set(existingNames.map((n) => n.trim()))
  return pickUnusedEvocative(casedExisting)
}


export const STEP_KIND_META: Record<
  StepKind,
  { label: string; short: string; color: string; description: string }
> = {
  tool: {
    label: 'Tool',
    short: 'T',
    color: 'tool',
    description: 'Mechanical. Calls one tool with fixed inputs. No AI, near-instant, basically free.',
  },
  reason: {
    label: 'Reason',
    short: 'R',
    color: 'reason',
    description: 'Judgment. The AI reads input, may call a tool or two, returns a structured answer.',
  },
  gate: {
    label: 'Gate',
    short: 'G',
    color: 'gate',
    description: 'Stop sign. Pauses and waits for a human to approve before anything irreversible.',
  },
  spawn: {
    label: 'Spawn',
    short: 'S',
    color: 'reason',
    description: 'Delegate. Spins up a temporary subagent to handle a subtask, collects the result.',
  },
}

export function parseWorkflowJSON(raw: string): WorkflowJSON {
  try {
    const parsed = JSON.parse(raw)
    return { version: 1, steps: Array.isArray(parsed?.steps) ? parsed.steps : [] }
  } catch {
    return { version: 1, steps: [] }
  }
}

export function serializeWorkflowJSON(wf: WorkflowJSON): string {
  return JSON.stringify(wf, null, 2)
}

export function parseTools(raw: string): ToolDef[] {
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function parseConfig<T = unknown>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

/** Resolve {{stepId.field.path}} references against step outputs. */
export function resolveRefs(
  value: unknown,
  outputs: Record<string, unknown>,
): unknown {
  if (typeof value === 'string') {
    return value.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, path: string) => {
      const parts = path.split('.')
      let cur: unknown = outputs
      for (const p of parts) {
        cur = (cur as Record<string, unknown>)?.[p]
        if (cur === undefined) return ''
      }
      return typeof cur === 'object' ? JSON.stringify(cur) : String(cur)
    })
  }
  if (Array.isArray(value)) {
    return value.map((v) => resolveRefs(v, outputs))
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) {
      out[k] = resolveRefs(v, outputs)
    }
    return out
  }
  return value
}

export function countKinds(steps: WorkflowStep[]): {
  tool: number
  reason: number
  gate: number
  hardened: number
} {
  return steps.reduce(
    (acc, s) => {
      acc[s.kind] += 1
      if (s.hardened) acc.hardened += 1
      return acc
    },
    { tool: 0, reason: 0, gate: 0, hardened: 0 },
  )
}

export function formatCurrency(cents: number): string {
  if (cents < 100) return `${cents}¢`
  return `$${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`
}

export function relativeTime(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso
  const diff = Date.now() - d.getTime()
  const s = Math.floor(diff / 1000)
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const days = Math.floor(h / 24)
  if (days < 7) return `${days}d ago`
  return d.toLocaleDateString()
}

// (EXAMPLE_PROMPTS is defined as an alias of DEFAULT_PROMPTS below.)

export function integrationFromRow(row: {
  id: string
  name: string
  kind: string
  description: string
  category: string
  color: string
  status: string
  config: string
  tools: string
  source?: string | null
  visibility?: string | null
  authorLabel?: string | null
  installs?: number | null
  createdAt: Date
  updatedAt: Date
}): Integration {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind as Integration['kind'],
    description: row.description,
    category: row.category,
    color: row.color,
    status: row.status as Integration['status'],
    config: parseConfig(row.config, {}),
    tools: parseTools(row.tools),
    source: (row.source ?? 'builtin') as Integration['source'],
    visibility: (row.visibility ?? 'private') as Integration['visibility'],
    authorLabel: row.authorLabel ?? null,
    installs: row.installs ?? 0,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

// ---------------- Departments (dynamic) ----------------
// Departments are NOT a fixed enum — the agent creates them naturally. We just
// pick a lucide icon for a department name based on keywords, defaulting to a
// generic box. The workspace groups agents by their `department` string.

export interface DepartmentMeta {
  name: string
  icon: string // lucide icon name
  blurb: string
}

const DEPARTMENT_ICON_RULES: Array<{ match: RegExp; icon: string; blurb: string }> = [
  { match: /fil|sort|archive|record|document|scan/i, icon: 'FolderArchive', blurb: 'Sorting & records.' },
  { match: /mail|inbox|email|messag|chat|comms/i, icon: 'Mail', blurb: 'Messages & email.' },
  { match: /financ|invoic|bill|payment|expense|book|account|payroll/i, icon: 'Banknote', blurb: 'Money & books.' },
  { match: /dispatch|monitor|watch|alert|patrol|schedule/i, icon: 'Radio', blurb: 'Scheduled monitoring.' },
  { match: /report|digest|summ|analytics|insight/i, icon: 'BarChart3', blurb: 'Reporting & analysis.' },
  { match: /client|customer|crm|contact|sales/i, icon: 'Users', blurb: 'Client-facing.' },
  { match: /hr|people|staff|onboard/i, icon: 'UserCog', blurb: 'People ops.' },
  { match: /legal|contract|compliance|audit/i, icon: 'Scale', blurb: 'Legal & compliance.' },
  { match: /intake|reception|front|triage/i, icon: 'ConciergeBell', blurb: 'Intake & triage.' },
  { match: /deploy|dev|api|build|ship/i, icon: 'Code2', blurb: 'Build & ship.' },
]

export function departmentMeta(name: string): DepartmentMeta {
  const rule = DEPARTMENT_ICON_RULES.find((r) => r.match.test(name))
  return { name, icon: rule?.icon ?? 'Boxes', blurb: rule?.blurb ?? 'A group of agents.' }
}

/** Group workflows into departments dynamically (by their `department` string). */
export function groupByDepartment<T extends { department: string }>(
  items: T[],
): Array<{ department: string; meta: DepartmentMeta; items: T[] }> {
  const map = new Map<string, T[]>()
  for (const it of items) {
    const key = it.department || 'General'
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(it)
  }
  return Array.from(map.entries())
    .map(([department, items]) => ({ department, meta: departmentMeta(department), items }))
    .sort((a, b) => a.department.localeCompare(b.department))
}

// ---------------- Agent avatars ----------------
export function agentInitials(name: string): string {
  const n = name.trim()
  // For single-word evocative names (e.g. "Compass"), use first 2 letters.
  if (!n.includes(' ')) return n.slice(0, 2).toUpperCase()
  const parts = n.split(/\s+/)
  return (parts[0][0] + parts[1][0]).toUpperCase()
}

/** A stable lightness offset for monotone avatar differentiation. */
export function agentAvatarLightness(name: string): number {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  // vary lightness between 0.45 and 0.72 along the primary hue — monotone
  return 0.45 + (h % 100) / 380
}

// Keep the old names as aliases for backward compat with existing components.
export const employeeInitials = agentInitials
export function employeeAvatarColor(_name: string): string {
  return 'emerald'
}

// ---------------- Suggestions ----------------
/** Default example prompts (used before the user has a profile). */
export const DEFAULT_PROMPTS = [
  { title: 'Sort my scanner PDFs', prompt: 'Sort the PDFs my scanner dumps into /Scan Inbox by client, and file them. Ask me if anything is unclear.', reason: 'A common starting point.' },
  { title: 'Weekly client updates', prompt: 'Every Monday, draft a short summary email to each client about last week. Send me the drafts first.', reason: 'Recurring client comms.' },
  { title: 'Chase overdue invoices', prompt: 'Check unpaid invoices every day. Send a polite reminder if 7 days late; if 30 days, draft an escalation for me to approve.', reason: 'Cash flow.' },
  { title: 'Audit expense reports', prompt: 'Audit new expense reports against our policy. Flag anything over $500 or missing a receipt for me; auto-approve the rest.', reason: 'Policy enforcement.' },
]
// Backward-compat alias.
export const EXAMPLE_PROMPTS = DEFAULT_PROMPTS
