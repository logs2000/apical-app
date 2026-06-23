/**
 * Apical domain helpers + demo data.
 * Ported from the production Apical app — used by the logged-in AppShell.
 */

export type StepKind = "tool" | "reason" | "gate" | "spawn";
export type AgentRuntime = "local" | "hosted";
export type WorkflowStatus = "draft" | "active" | "paused";
export type RunStatus = "running" | "completed" | "failed" | "awaiting_gate" | "cancelled";

export interface WorkflowStep {
  id: string;
  kind: StepKind;
  label: string;
  tool?: string;
  prompt?: string;
  hardened?: boolean;
  note?: string;
}

export interface WorkflowJSON {
  version: 1;
  steps: WorkflowStep[];
}

export interface Workflow {
  id: string;
  name: string;
  description: string;
  steps: WorkflowJSON;
  trigger: "manual" | "schedule";
  schedule?: string | null;
  status: WorkflowStatus;
  department: string;
  title?: string | null;
  runtime: AgentRuntime;
  runsCount: number;
  itemsProcessed: number;
  automaticCount: number;
  flaggedCount: number;
  aiCallsSaved: number;
  estCostSavedCents: number;
  createdAt: string;
  updatedAt: string;
}

export interface Conversation {
  id: string;
  title: string;
  pinned: boolean;
  /** The agent (workflow) this conversation belongs to. */
  workflowId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "agent";
  content: string;
  workflowProposal?: {
    name: string;
    description: string;
    department: string;
    title?: string;
    steps: WorkflowJSON;
  };
  /** A live execution trace — shown when the agent "does it once" before automating. */
  executionTrace?: ExecutionStep[];
  /** An offer to convert a completed trace into a reusable workflow. */
  automateOffer?: {
    traceId: string;
    summary: string;
    steps: WorkflowJSON;
    name: string;
    department: string;
  };
  createdAt: string;
}

// ─── Execution trace (learn-first mode) ──────────────────────────────────────

export type ExecutionStatus = "running" | "done" | "flagged" | "gate" | "error";

export interface ExecutionStep {
  id: string;
  /** What the agent did — plain English, e.g. "Listed 12 files in /Scan Inbox" */
  action: string;
  /** The tool or capability used, e.g. "files.list", "ocr.read", "gmail.send" */
  tool?: string;
  status: ExecutionStatus;
  /** Wall-clock duration in ms */
  durationMs?: number;
  /** What the step produced — a short result snippet */
  result?: string;
  /** If flagged/gated, what the agent needs from the human */
  question?: string;
  timestamp: string;
}

// ─── Step-kind metadata ─────────────────────────────────────────────────────

export const STEP_KIND_META: Record<
  StepKind,
  { label: string; short: string; color: string; description: string }
> = {
  tool: {
    label: "Tool",
    short: "T",
    color: "tool",
    description: "Mechanical. Calls one tool with fixed inputs. No AI, near-instant, basically free.",
  },
  reason: {
    label: "Reason",
    short: "R",
    color: "reason",
    description: "Judgment. The AI reads input, may call a tool or two, returns a structured answer.",
  },
  gate: {
    label: "Gate",
    short: "G",
    color: "gate",
    description: "Stop sign. Pauses and waits for a human to approve before anything irreversible.",
  },
  spawn: {
    label: "Spawn",
    short: "S",
    color: "reason",
    description: "Delegate. Spins up a temporary subagent to handle a subtask, collects the result.",
  },
};

// ─── Agent naming + avatars ─────────────────────────────────────────────────

export function agentInitials(name: string): string {
  const n = name.trim();
  if (!n.includes(" ")) return n.slice(0, 2).toUpperCase();
  const parts = n.split(/\s+/);
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function agentAvatarLightness(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return 0.45 + (h % 100) / 380;
}

// ─── Time / currency formatting ─────────────────────────────────────────────

export function relativeTime(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const diff = Date.now() - d.getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString();
}

export function formatCurrency(cents: number): string {
  if (cents < 100) return `${cents}¢`;
  return `$${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

// ─── Default prompts ────────────────────────────────────────────────────────

export const DEFAULT_PROMPTS = [
  {
    title: "Sort my scanner PDFs",
    prompt:
      "Sort the PDFs my scanner dumps into /Scan Inbox by client, and file them. Ask me if anything is unclear.",
    reason: "A common starting point.",
  },
  {
    title: "Weekly client updates",
    prompt:
      "Every Monday, draft a short summary email to each client about last week. Send me the drafts first.",
    reason: "Recurring client comms.",
  },
  {
    title: "Chase overdue invoices",
    prompt:
      "Check unpaid invoices every day. Send a polite reminder if 7 days late; if 30 days, draft an escalation for me to approve.",
    reason: "Cash flow.",
  },
  {
    title: "Audit expense reports",
    prompt:
      "Audit new expense reports against our policy. Flag anything over $500 or missing a receipt for me; auto-approve the rest.",
    reason: "Policy enforcement.",
  },
];

// ─── Demo data ──────────────────────────────────────────────────────────────

const now = Date.now();
const hoursAgo = (h: number) => new Date(now - h * 3600_000).toISOString();
const daysAgo = (d: number) => new Date(now - d * 86_400_000).toISOString();

export const DEMO_CONVERSATIONS: Conversation[] = [
  // The Orchestrator — pinned at the top of the left rail. General context,
  // aware of all agents. Has no workflowId (it's not an agent itself).
  { id: "orchestrator", title: "Orchestrator", pinned: true, workflowId: undefined, createdAt: daysAgo(30), updatedAt: hoursAgo(0.05) },
  { id: "c1", title: "Compass", pinned: true, workflowId: "w1", createdAt: hoursAgo(2), updatedAt: hoursAgo(0.1) },
  { id: "c2", title: "Atlas", pinned: true, workflowId: "w2", createdAt: daysAgo(1), updatedAt: hoursAgo(3) },
  { id: "c3", title: "Sentinel", pinned: false, workflowId: "w3", createdAt: daysAgo(2), updatedAt: hoursAgo(8) },
  { id: "c4", title: "Tally", pinned: false, workflowId: "w4", createdAt: daysAgo(3), updatedAt: daysAgo(1) },
  { id: "c5", title: "Beacon", pinned: false, workflowId: "w5", createdAt: daysAgo(5), updatedAt: daysAgo(2) },
  { id: "c6", title: "Scout", pinned: false, workflowId: "w6", createdAt: daysAgo(7), updatedAt: daysAgo(3) },
];

export const DEMO_WORKFLOWS: Workflow[] = [
  {
    id: "w1",
    name: "Compass",
    description: "Sorts scans, invoices, and documents into client folders automatically.",
    steps: {
      version: 1,
      steps: [
        { id: "s1", kind: "tool", label: "List /Scan Inbox", tool: "files.list" },
        { id: "s2", kind: "reason", label: "Identify client from filename + OCR", prompt: "Read the filename and OCR the first page to identify the client." },
        { id: "s3", kind: "gate", label: "Confirm move (if new client)" },
        { id: "s4", kind: "tool", label: "Move to /Clients/{{s2.client}}/", tool: "files.move", hardened: true, note: "Hardened after 50 consistent runs" },
      ],
    },
    trigger: "schedule",
    schedule: "every 15 min",
    status: "active",
    department: "Filing",
    title: "Sorter",
    runtime: "local",
    runsCount: 1284,
    itemsProcessed: 8472,
    automaticCount: 8120,
    flaggedCount: 352,
    aiCallsSaved: 7800,
    estCostSavedCents: 94000,
    createdAt: daysAgo(30),
    updatedAt: hoursAgo(0.1),
  },
  {
    id: "w2",
    name: "Atlas",
    description: "Drafts personalized onboarding sequences from CRM data.",
    steps: {
      version: 1,
      steps: [
        { id: "s1", kind: "tool", label: "Pull new signups", tool: "crm.list" },
        { id: "s2", kind: "reason", label: "Draft welcome + day-3 + day-7 emails", prompt: "Draft a 3-email onboarding sequence personalized to each signup." },
        { id: "s3", kind: "gate", label: "Approve drafts before send" },
        { id: "s4", kind: "tool", label: "Schedule in Gmail", tool: "gmail.schedule" },
      ],
    },
    trigger: "schedule",
    schedule: "daily 9am",
    status: "active",
    department: "Client",
    title: "Onboarding Writer",
    runtime: "hosted",
    runsCount: 47,
    itemsProcessed: 312,
    automaticCount: 280,
    flaggedCount: 32,
    aiCallsSaved: 280,
    estCostSavedCents: 8400,
    createdAt: daysAgo(14),
    updatedAt: hoursAgo(3),
  },
  {
    id: "w3",
    name: "Sentinel",
    description: "Knows when a competitor changes their pricing or launches something new.",
    steps: {
      version: 1,
      steps: [
        { id: "s1", kind: "tool", label: "Fetch competitor pricing pages", tool: "http.fetch" },
        { id: "s2", kind: "reason", label: "Diff against last snapshot", prompt: "Compare each page to yesterday's snapshot. Flag any price changes." },
        { id: "s3", kind: "tool", label: "Slack #competitors if change detected", tool: "slack.post" },
      ],
    },
    trigger: "schedule",
    schedule: "every 6h",
    status: "active",
    department: "Dispatch",
    title: "Watcher",
    runtime: "hosted",
    runsCount: 89,
    itemsProcessed: 534,
    automaticCount: 534,
    flaggedCount: 12,
    aiCallsSaved: 480,
    estCostSavedCents: 14400,
    createdAt: daysAgo(21),
    updatedAt: hoursAgo(8),
  },
  {
    id: "w4",
    name: "Tally",
    description: "Audits reports against your policy and flags the ones that need a look.",
    steps: {
      version: 1,
      steps: [
        { id: "s1", kind: "tool", label: "Pull new expense reports", tool: "expensify.list" },
        { id: "s2", kind: "reason", label: "Check each line item against policy", prompt: "Flag any item over $500 or missing a receipt." },
        { id: "s3", kind: "gate", label: "Approve flagged items" },
        { id: "s4", kind: "tool", label: "Auto-approve the rest", tool: "expensify.approve", hardened: true },
      ],
    },
    trigger: "manual",
    schedule: null,
    status: "active",
    department: "Finance",
    title: "Auditor",
    runtime: "hosted",
    runsCount: 23,
    itemsProcessed: 487,
    automaticCount: 412,
    flaggedCount: 75,
    aiCallsSaved: 412,
    estCostSavedCents: 12360,
    createdAt: daysAgo(10),
    updatedAt: daysAgo(1),
  },
  {
    id: "w5",
    name: "Beacon",
    description: "Never lets a license, contract, or deadline expire again.",
    steps: {
      version: 1,
      steps: [
        { id: "s1", kind: "tool", label: "Scan calendar + contracts db", tool: "calendar.scan" },
        { id: "s2", kind: "reason", label: "Flag expiries in next 30 days", prompt: "Find any licenses/contracts expiring in the next 30 days." },
        { id: "s3", kind: "tool", label: "Create renewal tasks", tool: "tasks.create" },
      ],
    },
    trigger: "schedule",
    schedule: "daily 8am",
    status: "active",
    department: "Dispatch",
    title: "Reminder",
    runtime: "hosted",
    runsCount: 30,
    itemsProcessed: 18,
    automaticCount: 18,
    flaggedCount: 0,
    aiCallsSaved: 18,
    estCostSavedCents: 540,
    createdAt: daysAgo(45),
    updatedAt: hoursAgo(20),
  },
  {
    id: "w6",
    name: "Scout",
    description: "Finds potential customers and keeps your list fresh without lifting a finger.",
    steps: {
      version: 1,
      steps: [
        { id: "s1", kind: "reason", label: "Search LinkedIn for ICP matches", prompt: "Find 20 companies matching our ICP: fintech, 50-200 employees, US." },
        { id: "s2", kind: "tool", label: "Enrich with Clearbit", tool: "clearbit.enrich" },
        { id: "s3", kind: "gate", label: "Review list before adding to CRM" },
        { id: "s4", kind: "tool", label: "Add to HubSpot", tool: "hubspot.create" },
      ],
    },
    trigger: "schedule",
    schedule: "weekly Mon",
    status: "paused",
    department: "Client",
    title: "Prospector",
    runtime: "hosted",
    runsCount: 4,
    itemsProcessed: 80,
    automaticCount: 64,
    flaggedCount: 16,
    aiCallsSaved: 64,
    estCostSavedCents: 1920,
    createdAt: daysAgo(14),
    updatedAt: daysAgo(3),
  },
];

export const DEMO_MESSAGES: ChatMessage[] = [
  {
    id: "m1",
    role: "agent",
    content:
      "Hi Jordan — I'm Compass, your filing agent. I've sorted 32 invoices into client folders this morning. 2 needed your attention (new client: Acme Corp, missing date on a receipt). Want me to handle them?",
    createdAt: hoursAgo(2),
  },
  {
    id: "m2",
    role: "user",
    content: "Yes — create a folder for Acme Corp and file the one without a date under 'Unsorted' for now.",
    createdAt: hoursAgo(1.9),
  },
  {
    id: "m3",
    role: "agent",
    content:
      "Done. Created `/Clients/Acme Corp/` and filed 1 invoice there. The undated one is in `/Clients/_Unsorted/`. I'll OCR it again tonight to try to recover the date.\n\nWant me to set up a daily summary of what I sorted?",
    workflowProposal: {
      name: "Compass",
      description: "Sort scans + invoices into client folders. Auto-creates new client folders.",
      department: "Filing",
      title: "Sorter",
      steps: {
        version: 1,
        steps: [
          { id: "s1", kind: "tool", label: "List /Scan Inbox", tool: "files.list" },
          { id: "s2", kind: "reason", label: "Identify client from filename + OCR", prompt: "Read the filename and OCR the first page to identify the client." },
          { id: "s3", kind: "gate", label: "Confirm move (if new client)" },
          { id: "s4", kind: "tool", label: "Move to /Clients/{{s2.client}}/", tool: "files.move", hardened: true, note: "Hardened after 50 consistent runs" },
        ],
      },
    },
    createdAt: hoursAgo(1.8),
  },
  {
    id: "m4",
    role: "user",
    content: "Yes please. Run it every 15 minutes.",
    createdAt: hoursAgo(0.2),
  },
];

// ─── Per-agent message generators ───────────────────────────────────────────
//
// Each agent gets its own conversation tailored to its role. This fixes the
// "all agent chats show the same DEMO_MESSAGES" bug — switching agents now
// loads a role-specific thread.

export function messagesForAgent(agent: Workflow): ChatMessage[] {
  const now = Date.now()
  const ago = (h: number) => new Date(now - h * 3600_000).toISOString()

  // Role-specific openers + threads.
  const roleThreads: Record<string, ChatMessage[]> = {
    Compass: [
      {
        id: 'cm1',
        role: 'agent',
        content: `Hi Jordan — I'm Compass, your filing agent. I've sorted 32 invoices into client folders this morning. 2 needed your attention (new client: Acme Corp, missing date on a receipt). Want me to handle them?`,
        createdAt: ago(2),
      },
      {
        id: 'cm2',
        role: 'user',
        content: `Yes — create a folder for Acme Corp and file the one without a date under 'Unsorted' for now.`,
        createdAt: ago(1.9),
      },
      {
        id: 'cm3',
        role: 'agent',
        content: `Done. Created \`/Clients/Acme Corp/\` and filed 1 invoice there. The undated one is in \`/Clients/_Unsorted/\`. I'll OCR it again tonight to try to recover the date.`,
        createdAt: ago(1.8),
      },
    ],
    Atlas: [
      {
        id: 'am1',
        role: 'agent',
        content: `Morning Jordan — Atlas here. I drafted 12 onboarding emails yesterday (4 welcome, 4 day-3, 4 day-7). All personalized from the CRM data. 3 are ready to send; the other 9 are queued for their scheduled days. Want to review the 3 ready ones?`,
        createdAt: ago(3),
      },
      {
        id: 'am2',
        role: 'user',
        content: `Yes, show me the ready ones.`,
        createdAt: ago(2.8),
      },
      {
        id: 'am3',
        role: 'agent',
        content: `Here are the 3 ready drafts:\n\n1. **Sarah Chen** (signed up Tue) — welcome email referencing her fintech background\n2. **Marcus Webb** (signed up Wed) — welcome + a case study from a similar-size company\n3. **Priya Patel** (signed up Thu) — welcome + invite to a product webinar next week\n\nAll three are in Gmail drafts. Approve to schedule?`,
        createdAt: ago(2.7),
      },
    ],
    Sentinel: [
      {
        id: 'sm1',
        role: 'agent',
        content: `Jordan — Sentinel here. Two competitor changes since you last checked:\n\n1. **Acme Co** dropped their Pro tier price from $49 → $39 (−20%)\n2. **Globex** launched a new "Teams" feature\n\nI posted both to #competitors. The Acme price drop is significant — want me to draft a counter-positioning doc?`,
        createdAt: ago(8),
      },
      {
        id: 'sm2',
        role: 'user',
        content: `Yes, draft the doc. Focus on value vs price.`,
        createdAt: ago(7.5),
      },
      {
        id: 'sm3',
        role: 'agent',
        content: `Drafting now. I'll pull our feature comparison + 3 case studies showing ROI. Should be ready in ~10 min.`,
        createdAt: ago(7.4),
      },
    ],
    Tally: [
      {
        id: 'tm1',
        role: 'agent',
        content: `Jordan — Tally here. I audited 23 expense reports this week. 18 auto-approved (within policy), 5 flagged for your review:\n\n1. $640 dinner (over $500 limit) — Marcus\n2. Missing receipt — Priya\n3. $1,200 software (unusual category) — David\n4. Personal charge on corp card — Sarah\n5. Duplicate submission — Tom\n\nWant to handle them one by one or batch-approve/reject?`,
        createdAt: ago(24),
      },
      {
        id: 'tm2',
        role: 'user',
        content: `One by one. Start with Marcus.`,
        createdAt: ago(23.5),
      },
    ],
    Beacon: [
      {
        id: 'bm1',
        role: 'agent',
        content: `Jordan — Beacon here. No urgent expiries this week. Next up: your SSL cert renews in 18 days (auto-renewed — just a heads up). The Acme contract expires in 47 days — I'll remind you 2 weeks out.`,
        createdAt: ago(20),
      },
    ],
    Scout: [
      {
        id: 'scm1',
        role: 'agent',
        content: `Jordan — Scout here, currently paused. Last run found 14 prospects matching your ICP (fintech, 50-200 employees, US). 8 were enriched with Clearbit data and added to HubSpot. 6 are awaiting your review before adding. Want me to resume?`,
        createdAt: ago(72),
      },
    ],
  }

  return roleThreads[agent.name] ?? [
    {
      id: 'dm1',
      role: 'agent' as const,
      content: `Hi Jordan — I'm ${agent.name}, your ${agent.title ?? 'agent'} in ${agent.department}. I've been running ${agent.runsCount} times and processed ${agent.itemsProcessed.toLocaleString()} items. ${agent.flaggedCount > 0 ? `${agent.flaggedCount} items need your review.` : 'Nothing flagged right now.'} What do you need?`,
      createdAt: ago(1),
    },
  ]
}

// ─── Apical (orchestrator) welcome message ──────────────────────────────────
//
// Generates a time-of-day greeting + a summary of what's changed, needs
// review, and any updates since the user was last gone. Pulled from the
// live agent roster so it stays accurate.

export function apicalWelcomeMessage(opts: {
  user: { name: string } | null
  agents: Workflow[]
  lastSeenAgoHours: number
}): ChatMessage {
  const now = new Date()
  const hour = now.getHours()
  let greeting = 'Welcome back'
  if (hour < 12) greeting = 'Good morning'
  else if (hour < 18) greeting = 'Good afternoon'
  else greeting = 'Good evening'

  const name = opts.user?.name?.split(' ')[0] ?? 'Jordan'

  // Summarize: total flagged across all agents, agents that ran, anything new.
  const totalFlagged = opts.agents.reduce((s, a) => s + a.flaggedCount, 0)
  const activeAgents = opts.agents.filter((a) => a.status === 'active')
  const pausedAgents = opts.agents.filter((a) => a.status === 'paused')
  const ranWhileGone = opts.agents.filter((a) => a.runsCount > 0)

  const lines: string[] = []
  lines.push(`${greeting}, ${name}.`)

  if (totalFlagged > 0) {
    lines.push(`\n**${totalFlagged} item${totalFlagged === 1 ? '' : 's'} need your review** across your agents:`)
    for (const a of opts.agents.filter((a) => a.flaggedCount > 0)) {
      lines.push(`• ${a.name} (${a.department}) — ${a.flaggedCount} flagged`)
    }
  } else {
    lines.push(`\nNothing needs your review right now. All clear.`)
  }

  if (ranWhileGone.length > 0) {
    lines.push(`\nWhile you were gone (${opts.lastSeenAgoHours}h), ${ranWhileGone.length} agent${ranWhileGone.length === 1 ? '' : 's'} ran:`)
    for (const a of ranWhileGone.slice(0, 4)) {
      lines.push(`• ${a.name} — ${a.itemsProcessed.toLocaleString()} items processed`)
    }
    if (ranWhileGone.length > 4) lines.push(`• and ${ranWhileGone.length - 4} more…`)
  }

  if (pausedAgents.length > 0) {
    lines.push(`\n${pausedAgents.length} agent${pausedAgents.length === 1 ? '' : 's'} paused: ${pausedAgents.map((a) => a.name).join(', ')}.`)
  }

  lines.push(`\nWhat would you like to do? You can ask me to coordinate across agents, set up a new one, or dig into anything above.`)

  return {
    id: 'apical-welcome',
    role: 'agent',
    content: lines.join('\n'),
    createdAt: new Date().toISOString(),
  }
}
