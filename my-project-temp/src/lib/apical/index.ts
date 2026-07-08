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
  version: 1 | 2;
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
  origin?: "agent" | "manual" | "chat";
  runtime: AgentRuntime;
  modelPreference?: string | null;
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

import type {
  AgentEvent,
  ApiDiscoveryCandidate,
  ClarificationQuestion,
  ResearchPlan,
  ResearchResult,
} from '@/lib/types'

export interface ChatAttachment {
  id: string;
  name: string;
  mimeType: string;
  kind: "image" | "file" | "folder" | "code";
  url: string;
  localPath?: string | null;
  sizeBytes?: number;
  source?: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "agent";
  content: string;
  /** Files, folders, images, or artifacts attached to this message. */
  attachments?: ChatAttachment[];
  workflowProposal?: {
    name: string;
    description: string;
    title?: string;
    steps: WorkflowJSON;
  };
  /** Agent reasoning steps from a completed turn. */
  trace?: { label: string; detail?: string }[];
  /** Glass-box events from /api/agents/[id]/chat. */
  events?: AgentEvent[];
  /** Claude extended-thinking chain-of-thought (streamed). */
  thinking?: string;
  clarification?: ClarificationQuestion;
  apiDiscovery?: ApiDiscoveryCandidate[];
  research?: ResearchResult;
  researchPlan?: ResearchPlan;
  suggestions?: { title: string; prompt: string; reason: string }[];
  /** A live execution trace — shown when the agent "does it once" before automating. */
  executionTrace?: ExecutionStep[];
  /** Post-run LLM review — success check + workflow improvement suggestions. */
  runAnalysis?: RunAnalysis;
  /** An offer to convert a completed trace into a reusable workflow. */
  automateOffer?: {
    traceId: string;
    summary: string;
    steps: WorkflowJSON;
    name: string;
  };
  /** When the agent updated its OWN workflow (vs. proposing a new agent). */
  workflowSaved?: { agentName: string };
  /** When an agent created a sibling agent — UI opens it automatically. */
  createdAgent?: { agentId: string; agentName: string };
  /** When the agent needs API keys — renders one inline, secure vault box per request.
   *  Persisted with the message; each box stays until saved or dismissed. */
  credentialRequests?: CredentialRequestState[];
  /** The server row id once persisted — used to PATCH interactive-card state. */
  serverId?: string;
  /** The agent's live checklist (from update_plan) — rendered above the answer. */
  checklist?: PlanItem[];
  /** A multiple-choice question the user answers by clicking (from ask_clarification). */
  clarificationRequest?: ClarificationRequestInfo;
  /** Marked true once the user answers a clarificationRequest (buttons disabled). */
  clarificationAnswered?: boolean;
  /** Shown when a user message failed to send / get a response. */
  deliveryError?: { message: string; retryable: boolean };
  /** Original send payload — used by Retry on deliveryError messages. */
  retryPayload?: { text: string; attachments?: ChatAttachment[] };
  /** Set when a turn ended before finishing (user stopped it, or an error /
   *  disconnect / token-limit cut it off). The partial answer + trace are kept
   *  and a "Continue" affordance resumes from where it left off. Round-trips
   *  through the persisted runAnalysis so it survives reloads. */
  interrupted?: { reason: "stopped" | "error"; message?: string };
  createdAt: string;
}

/** A single item in the agent's live checklist (from update_plan). */
export interface PlanItem {
  id: string;
  label: string;
  status: "pending" | "in_progress" | "done";
}

/** A multiple-choice card the agent shows: a clarifying question
 *  (ask_clarification) or an approval gate (request_review). */
export interface ClarificationRequestInfo {
  id: string;
  question: string;
  options: Array<{ key: string; label: string; description?: string }>;
  multiple?: boolean;
  /** Show a free-text "Other" input so the user can type a custom answer. */
  allowFreeText?: boolean;
  /** Placeholder for the free-text input. */
  freeTextPlaceholder?: string;
  /** 'clarification' = disambiguate; 'review' = approval gate. */
  kind?: "clarification" | "review";
}

/** A credential request + its lifecycle state (persists until saved/dismissed). */
export interface CredentialRequestState extends CredentialRequestInfo {
  status?: "pending" | "saved" | "dismissed";
}

/** A request from an agent for the user to save an API key / token to the vault. */
export interface CredentialRequestInfo {
  service: string;
  label: string;
  instructions?: string;
  docsUrl?: string;
  headerName?: string;
  headerPrefix?: string;
  fields: Array<{
    key: string;
    label: string;
    type?: "text" | "password" | "apikey";
    placeholder?: string;
    required?: boolean;
  }>;
}

// ─── Execution trace (learn-first mode) ──────────────────────────────────────

export type ExecutionStatus = "running" | "done" | "flagged" | "gate" | "error";

export type ChatRunStatus = "running" | "completed" | "failed" | "stopped" | "analyzing";

/** Post-run review produced by the analyze-run model. */
export interface RunAnalysis {
  success: boolean;
  outcomeAchieved?: boolean;
  summary: string;
  efficiencyNotes?: string;
  workflowSuggestions?: string[];
  /** True when the server auto-saved a workflow from a successful first run. */
  workflowAutoSaved?: boolean;
}

/** One agent think-loop execution — shown as a thin timeline line in chat. */
export interface ChatRun {
  id: string;
  status: ChatRunStatus;
  startedAt: string;
  finishedAt?: string;
  steps: ExecutionStep[];
  goal?: string;
  analysis?: RunAnalysis;
  /** True while the analyze-run model is still working. */
  analyzing?: boolean;
}

export interface ExecutionStep {
  id: string;
  /** What the agent did — plain English, e.g. "Listed 12 files in /Scan Inbox" */
  action: string;
  /** Whether this step is the agent thinking or running a tool. New field —
   *  legacy steps rely on `tool === "reason"` and are handled by `stepKind`. */
  kind?: "thought" | "tool";
  /** The tool or capability used, e.g. "files.list", "ocr.read", "gmail.send" */
  tool?: string;
  /** Full tool arguments captured at call time (for workflow replay). */
  toolInput?: Record<string, unknown>;
  status: ExecutionStatus;
  /** Wall-clock duration in ms */
  durationMs?: number;
  /** What the step produced — a short result snippet */
  result?: string;
  /** If flagged/gated, what the agent needs from the human */
  question?: string;
  timestamp: string;
}

/** Classify a step as thinking vs a tool call, tolerating legacy rows that
 *  only set `tool: "reason"` for thoughts. */
export function stepKind(s: ExecutionStep): "thought" | "tool" {
  return s.kind ?? (s.tool === "reason" ? "thought" : "tool");
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

/** Consistent light-gray avatars with dark initials (readable in light + dark UI). */
export function agentAvatarStyle(name: string): {
  backgroundColor: string
  color: string
} {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  const lightness = 74 + (h % 10) // 74–83% neutral gray
  return {
    backgroundColor: `hsl(0, 0%, ${lightness}%)`,
    color: '#171717',
  }
}

/** Neutral avatar surface (replaces green-tinted oklch). */
export function agentAvatarSurface(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  const l = 0.88 + (h % 80) / 500;
  return `oklch(${l.toFixed(3)} 0 0)`;
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

/** Blank-state welcome for an agent with no persisted chat history. */
export function agentWelcomeMessage(
  agent: Workflow,
  user?: { name?: string | null } | null,
): ChatMessage {
  const firstName = user?.name?.trim().split(/\s+/)[0] || 'there'
  const lines: string[] = []
  lines.push(`Hi ${firstName} — I'm **${agent.name}**.`)

  const desc = agent.description?.trim()
  if (desc && !/^tell apical what repetitive job/i.test(desc)) {
    lines.push(`\n${desc}`)
  } else {
    lines.push(
      `\nAsk me anything — I have full context on your workspace. Or describe a job to automate and I'll take it over.`,
    )
  }

  lines.push(`\n**What would you like done?**`)

  return {
    id: 'agent-welcome',
    role: 'agent',
    content: lines.join('\n'),
    suggestions: DEFAULT_PROMPTS,
    createdAt: new Date().toISOString(),
  }
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

  const name = opts.user?.name?.split(' ')[0] ?? 'there'

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
      lines.push(`• ${a.name} — ${a.flaggedCount} flagged`)
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
