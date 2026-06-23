"use client";

import * as React from "react";
import { motion } from "framer-motion";
import {
  agentInitials,
  agentAvatarLightness,
  relativeTime,
  formatDuration,
} from "@/lib/apical";
import { cn } from "@/lib/utils";
import {
  Activity,
  CheckCircle2,
  Clock,
  AlertTriangle,
  ShieldCheck,
  ChevronDown,
  Brain,
  Wrench,
  Lock,
  Filter,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

type ActivityStatus = "completed" | "running" | "flagged" | "gate";

interface TraceStep {
  label: string;
  kind: "tool" | "reason" | "gate" | "spawn";
  status: "ok" | "flagged" | "waiting" | "running";
  note?: string;
}

interface ActivityEntry {
  id: string;
  agent: string;
  action: string;
  status: ActivityStatus;
  when: string; // ISO
  items: number;
  auto: number; // auto-resolved
  flagged: number;
  durationMs: number;
  trace: TraceStep[];
}

// ─── Demo data ───────────────────────────────────────────────────────────────

const HOUR = 3600_000;
const DAY = 86_400_000;
const now = Date.now();
const iso = (msAgo: number) => new Date(now - msAgo).toISOString();

const ENTRIES: ActivityEntry[] = [
  {
    id: "a1",
    agent: "Compass",
    action: "Sorted 32 PDFs from /Scan Inbox into client folders",
    status: "completed",
    when: iso(0.2 * HOUR),
    items: 32,
    auto: 30,
    flagged: 2,
    durationMs: 4200,
    trace: [
      { label: "List /Scan Inbox", kind: "tool", status: "ok" },
      { label: "OCR + identify client", kind: "reason", status: "ok" },
      { label: "Confirm new client: Acme Corp", kind: "gate", status: "waiting", note: "You approved" },
      { label: "Move to /Clients/<name>/", kind: "tool", status: "ok", note: "Hardened · no AI call" },
    ],
  },
  {
    id: "a2",
    agent: "Sentinel",
    action: "Detected Rival.io Pro tier price change (+$5/mo)",
    status: "flagged",
    when: iso(0.6 * HOUR),
    items: 6,
    auto: 5,
    flagged: 1,
    durationMs: 1800,
    trace: [
      { label: "Fetch competitor pages", kind: "tool", status: "ok" },
      { label: "Diff vs last snapshot", kind: "reason", status: "flagged", note: "20.8% increase on Pro tier" },
      { label: "Slack #competitors", kind: "tool", status: "ok" },
    ],
  },
  {
    id: "a3",
    agent: "Tally",
    action: "Audited 14 expense reports against policy",
    status: "gate",
    when: iso(1.1 * HOUR),
    items: 14,
    auto: 11,
    flagged: 3,
    durationMs: 6400,
    trace: [
      { label: "Pull new expense reports", kind: "tool", status: "ok" },
      { label: "Check line items vs policy", kind: "reason", status: "flagged", note: "3 over $500 threshold" },
      { label: "Approve flagged items", kind: "gate", status: "waiting", note: "Awaiting your approval" },
      { label: "Auto-approve the rest", kind: "tool", status: "ok" },
    ],
  },
  {
    id: "a4",
    agent: "Atlas",
    action: "Drafted weekly client updates for 8 clients",
    status: "completed",
    when: iso(2.3 * HOUR),
    items: 8,
    auto: 8,
    flagged: 0,
    durationMs: 9100,
    trace: [
      { label: "Pull last week's activity", kind: "tool", status: "ok" },
      { label: "Draft per-client summary", kind: "reason", status: "ok" },
      { label: "Approve drafts", kind: "gate", status: "waiting", note: "You approved all 8" },
      { label: "Schedule in Gmail", kind: "tool", status: "ok" },
    ],
  },
  {
    id: "a5",
    agent: "Compass",
    action: "Sorting 12 new PDFs from /Scan Inbox",
    status: "running",
    when: iso(0.05 * HOUR),
    items: 12,
    auto: 11,
    flagged: 1,
    durationMs: 0,
    trace: [
      { label: "List /Scan Inbox", kind: "tool", status: "ok" },
      { label: "OCR + identify client", kind: "reason", status: "running" },
      { label: "Confirm move", kind: "gate", status: "waiting" },
      { label: "Move to /Clients/<name>/", kind: "tool", status: "ok" },
    ],
  },
  {
    id: "a6",
    agent: "Beacon",
    action: "Scanned contracts DB — 1 expiry in next 30 days",
    status: "completed",
    when: iso(4 * HOUR),
    items: 18,
    auto: 18,
    flagged: 0,
    durationMs: 1200,
    trace: [
      { label: "Scan calendar + contracts", kind: "tool", status: "ok" },
      { label: "Flag expiries <30d", kind: "reason", status: "ok", note: "Globex MSA — July 10" },
      { label: "Create renewal tasks", kind: "tool", status: "ok" },
    ],
  },
  {
    id: "a7",
    agent: "Scout",
    action: "Found 14 new prospects matching ICP",
    status: "completed",
    when: iso(6 * HOUR),
    items: 14,
    auto: 12,
    flagged: 2,
    durationMs: 14700,
    trace: [
      { label: "Search LinkedIn for ICP", kind: "reason", status: "ok" },
      { label: "Enrich with Clearbit", kind: "tool", status: "ok" },
      { label: "Review list", kind: "gate", status: "waiting", note: "2 rejected — too small" },
      { label: "Add to HubSpot", kind: "tool", status: "ok" },
    ],
  },
  {
    id: "a8",
    agent: "Tally",
    action: "Auto-approved 9 expense reports under threshold",
    status: "completed",
    when: iso(7.5 * HOUR),
    items: 9,
    auto: 9,
    flagged: 0,
    durationMs: 800,
    trace: [
      { label: "Pull new reports", kind: "tool", status: "ok" },
      { label: "Check vs policy", kind: "reason", status: "ok" },
      { label: "Auto-approve", kind: "tool", status: "ok", note: "Hardened · no AI call" },
    ],
  },
  {
    id: "a9",
    agent: "Sentinel",
    action: "Competitor watch — no changes detected",
    status: "completed",
    when: iso(9 * HOUR),
    items: 6,
    auto: 6,
    flagged: 0,
    durationMs: 900,
    trace: [
      { label: "Fetch competitor pages", kind: "tool", status: "ok" },
      { label: "Diff vs last snapshot", kind: "reason", status: "ok", note: "No changes" },
    ],
  },
  {
    id: "a10",
    agent: "Compass",
    action: "Sorted 18 PDFs — 1 OCR failure queued for retry",
    status: "completed",
    when: iso(11 * HOUR),
    items: 18,
    auto: 17,
    flagged: 1,
    durationMs: 3600,
    trace: [
      { label: "List /Scan Inbox", kind: "tool", status: "ok" },
      { label: "OCR + identify client", kind: "reason", status: "flagged", note: "1 unreadable — queued" },
      { label: "Move to /Clients/<name>/", kind: "tool", status: "ok" },
    ],
  },
  {
    id: "a11",
    agent: "Atlas",
    action: "Onboarding sequence drafted for 3 new signups",
    status: "completed",
    when: iso(14 * HOUR),
    items: 9,
    auto: 9,
    flagged: 0,
    durationMs: 8200,
    trace: [
      { label: "Pull new signups", kind: "tool", status: "ok" },
      { label: "Draft 3-email sequence", kind: "reason", status: "ok" },
      { label: "Approve drafts", kind: "gate", status: "waiting", note: "Auto-approved (trusted sender)" },
      { label: "Schedule in Gmail", kind: "tool", status: "ok" },
    ],
  },
  {
    id: "a12",
    agent: "Beacon",
    action: "SSL cert renewed: api.apical.dev",
    status: "completed",
    when: iso(20 * HOUR),
    items: 1,
    auto: 1,
    flagged: 0,
    durationMs: 2100,
    trace: [
      { label: "Scan cert store", kind: "tool", status: "ok" },
      { label: "Flag expiries <14d", kind: "reason", status: "ok" },
      { label: "Auto-renew Let's Encrypt", kind: "tool", status: "ok", note: "Hardened · no AI call" },
    ],
  },
  {
    id: "a13",
    agent: "Tally",
    action: "Escalated Acme Corp invoice #4821 (37 days overdue)",
    status: "flagged",
    when: iso(1.2 * DAY),
    items: 1,
    auto: 0,
    flagged: 1,
    durationMs: 400,
    trace: [
      { label: "Pull unpaid invoices", kind: "tool", status: "ok" },
      { label: "Bucket by days overdue", kind: "reason", status: "flagged", note: "$12,400 · 37 days" },
      { label: "Approve escalation", kind: "gate", status: "waiting", note: "Awaiting your approval" },
    ],
  },
  {
    id: "a14",
    agent: "Compass",
    action: "Daily inbox triage — 47 threads categorized",
    status: "completed",
    when: iso(1.4 * DAY),
    items: 47,
    auto: 44,
    flagged: 3,
    durationMs: 6800,
    trace: [
      { label: "Pull inbox since 6am", kind: "tool", status: "ok" },
      { label: "Categorize each thread", kind: "reason", status: "ok" },
      { label: "Approve draft replies", kind: "gate", status: "waiting", note: "You approved 12 drafts" },
      { label: "File newsletters", kind: "tool", status: "ok" },
    ],
  },
  {
    id: "a15",
    agent: "Sentinel",
    action: "Outwork v2 launch detected — new pricing page",
    status: "completed",
    when: iso(1.8 * DAY),
    items: 6,
    auto: 5,
    flagged: 1,
    durationMs: 1600,
    trace: [
      { label: "Fetch competitor pages", kind: "tool", status: "ok" },
      { label: "Diff vs last snapshot", kind: "reason", status: "ok", note: "New v2 product page" },
      { label: "Slack #competitors", kind: "tool", status: "ok" },
    ],
  },
  {
    id: "a16",
    agent: "Atlas",
    action: "Weekly summary generated for Jordan",
    status: "completed",
    when: iso(2.1 * DAY),
    items: 1,
    auto: 1,
    flagged: 0,
    durationMs: 5400,
    trace: [
      { label: "Pull all agent activity", kind: "tool", status: "ok" },
      { label: "Draft weekly summary", kind: "reason", status: "ok" },
      { label: "Approve summary", kind: "gate", status: "waiting", note: "You approved" },
    ],
  },
  {
    id: "a17",
    agent: "Scout",
    action: "Weekly prospect list — 20 companies queued for review",
    status: "completed",
    when: iso(3 * DAY),
    items: 20,
    auto: 16,
    flagged: 4,
    durationMs: 19200,
    trace: [
      { label: "Search LinkedIn for ICP", kind: "reason", status: "ok" },
      { label: "Enrich with Clearbit", kind: "tool", status: "ok" },
      { label: "Review list", kind: "gate", status: "waiting", note: "4 rejected — wrong stage" },
      { label: "Add to HubSpot", kind: "tool", status: "ok" },
    ],
  },
  {
    id: "a18",
    agent: "Compass",
    action: "Sorted 22 PDFs — all auto-filed (no gates needed)",
    status: "completed",
    when: iso(3.4 * DAY),
    items: 22,
    auto: 22,
    flagged: 0,
    durationMs: 2800,
    trace: [
      { label: "List /Scan Inbox", kind: "tool", status: "ok" },
      { label: "OCR + identify client", kind: "reason", status: "ok" },
      { label: "Move to /Clients/<name>/", kind: "tool", status: "ok", note: "Hardened · no AI call" },
    ],
  },
  {
    id: "a19",
    agent: "Tally",
    action: "Policy violation — receipt missing on $1899 hardware claim",
    status: "flagged",
    when: iso(4.2 * DAY),
    items: 1,
    auto: 0,
    flagged: 1,
    durationMs: 600,
    trace: [
      { label: "Pull new reports", kind: "tool", status: "ok" },
      { label: "Check vs policy", kind: "reason", status: "flagged", note: "Missing receipt" },
      { label: "Approve flagged items", kind: "gate", status: "waiting", note: "Awaiting your approval" },
    ],
  },
  {
    id: "a20",
    agent: "Beacon",
    action: "License renewal reminder — Stripe (renews Jul 22)",
    status: "completed",
    when: iso(5 * DAY),
    items: 1,
    auto: 1,
    flagged: 0,
    durationMs: 900,
    trace: [
      { label: "Scan calendar + contracts", kind: "tool", status: "ok" },
      { label: "Flag expiries <30d", kind: "reason", status: "ok" },
      { label: "Create renewal tasks", kind: "tool", status: "ok" },
    ],
  },
];

// ─── Status metadata ─────────────────────────────────────────────────────────

const STATUS_META: Record<
  ActivityStatus,
  { color: string; ring: string; icon: React.ComponentType<{ className?: string }>; label: string }
> = {
  completed: {
    color: "bg-emerald-500",
    ring: "bg-emerald-500/10 text-emerald-600",
    icon: CheckCircle2,
    label: "Completed",
  },
  running: {
    color: "bg-primary",
    ring: "bg-primary/10 text-primary",
    icon: Clock,
    label: "Running",
  },
  flagged: {
    color: "bg-gate",
    ring: "bg-gate/15 text-gate-foreground",
    icon: AlertTriangle,
    label: "Flagged",
  },
  gate: {
    color: "bg-amber-500",
    ring: "bg-amber-500/10 text-amber-700",
    icon: ShieldCheck,
    label: "Awaiting gate",
  },
};

type FilterKey = "all" | "today" | "week" | "flagged";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "today", label: "Today" },
  { key: "week", label: "This week" },
  { key: "flagged", label: "Flagged" },
];

// ─── Activity view ───────────────────────────────────────────────────────────

export function ActivityView() {
  const [filter, setFilter] = React.useState<FilterKey>("all");
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());

  const stats = React.useMemo(() => {
    const todayCutoff = now - DAY;
    const weekCutoff = now - 7 * DAY;
    const today = ENTRIES.filter((e) => new Date(e.when).getTime() >= todayCutoff);
    const week = ENTRIES.filter((e) => new Date(e.when).getTime() >= weekCutoff);
    return {
      runsToday: today.length,
      itemsToday: today.reduce((a, e) => a + e.items, 0),
      autoResolved: week.reduce((a, e) => a + e.auto, 0),
      flagged: week.reduce((a, e) => a + e.flagged, 0),
    };
  }, []);

  const filtered = React.useMemo(() => {
    const todayCutoff = now - DAY;
    const weekCutoff = now - 7 * DAY;
    return ENTRIES.filter((e) => {
      const t = new Date(e.when).getTime();
      if (filter === "today") return t >= todayCutoff;
      if (filter === "week") return t >= weekCutoff;
      if (filter === "flagged") return e.status === "flagged" || e.status === "gate";
      return true;
    }).sort((a, b) => new Date(b.when).getTime() - new Date(a.when).getTime());
  }, [filter]);

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="h-full min-h-0 overflow-y-auto overscroll-contain">
      <div className="mx-auto max-w-3xl px-4 py-5 md:px-6">
        {/* Header */}
        <div className="mb-4">
          <h1 className="flex items-center gap-2 text-base font-semibold tracking-tight">
            <Activity className="h-4 w-4 text-muted-foreground" /> Activity
          </h1>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Every run, every flag, every gate — chronologically. Click a row to see the
            step-by-step trace.
          </p>
        </div>

        {/* Stats summary */}
        <div className="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
          <StatTile
            label="Runs today"
            value={stats.runsToday.toString()}
            icon={Activity}
            accent="bg-primary/10 text-primary"
          />
          <StatTile
            label="Items processed"
            value={stats.itemsToday.toString()}
            icon={CheckCircle2}
            accent="bg-emerald-500/10 text-emerald-600"
          />
          <StatTile
            label="Auto-resolved"
            value={stats.autoResolved.toString()}
            icon={Lock}
            accent="bg-hardened/15 text-hardened"
          />
          <StatTile
            label="Flagged (7d)"
            value={stats.flagged.toString()}
            icon={AlertTriangle}
            accent="bg-gate/15 text-gate-foreground"
          />
        </div>

        {/* Filter bar */}
        <div className="mb-4 flex items-center gap-1.5">
          <Filter className="h-3 w-3 text-muted-foreground" />
          <div className="flex items-center gap-0.5 rounded-lg border border-border bg-muted/30 p-0.5">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors",
                  filter === f.key
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
          <span className="ml-auto text-[10px] text-muted-foreground">
            {filtered.length} {filtered.length === 1 ? "entry" : "entries"}
          </span>
        </div>

        {/* Timeline */}
        {filtered.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-10 text-center">
            <Activity className="mx-auto mb-2 h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm font-medium">No activity matches this filter</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Try a wider time range, or check back after an agent runs.
            </p>
          </div>
        ) : (
          <div className="relative">
            {/* vertical line */}
            <div className="absolute bottom-2 left-[15px] top-2 w-px bg-border" />
            <motion.div
              className="space-y-2"
              initial="hidden"
              animate="show"
              variants={{
                hidden: {},
                show: { transition: { staggerChildren: 0.03 } },
              }}
            >
              {filtered.map((entry) => (
                <motion.div
                  key={entry.id}
                  variants={{
                    hidden: { opacity: 0, x: -6 },
                    show: { opacity: 1, x: 0 },
                  }}
                  transition={{ duration: 0.2, ease: "easeOut" }}
                >
                  <ActivityRow
                    entry={entry}
                    expanded={expanded.has(entry.id)}
                    onToggle={() => toggle(entry.id)}
                  />
                </motion.div>
              ))}
            </motion.div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Activity row ────────────────────────────────────────────────────────────

function ActivityRow({
  entry,
  expanded,
  onToggle,
}: {
  entry: ActivityEntry;
  expanded: boolean;
  onToggle: () => void;
}) {
  const meta = STATUS_META[entry.status];
  const StatusIcon = meta.icon;
  const isRunning = entry.status === "running";

  return (
    <div className="relative pl-9">
      {/* Timeline dot */}
      <div
        className={cn(
          "absolute left-2 top-3 z-10 flex h-3.5 w-3.5 items-center justify-center rounded-full border-2 border-background",
          meta.color,
          isRunning && "animate-pulse",
        )}
      />

      <div
        className={cn(
          "rounded-lg border bg-card transition-colors",
          expanded ? "border-primary/30" : "border-border hover:border-border/80",
        )}
      >
        <button
          onClick={onToggle}
          className="flex w-full items-start gap-3 p-3 text-left"
        >
          {/* Agent avatar */}
          <div
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-primary-foreground"
            style={{ backgroundColor: `oklch(${agentAvatarLightness(entry.agent)} 0.06 155)` }}
          >
            {agentInitials(entry.agent)}
          </div>

          {/* Body */}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-medium">{entry.agent}</span>
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[9px] font-medium",
                  meta.ring,
                )}
              >
                <StatusIcon className="h-2.5 w-2.5" /> {meta.label}
              </span>
            </div>
            <p className="mt-0.5 text-[11px] leading-relaxed text-foreground/90">
              {entry.action}
            </p>
            <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground">
              <span>{relativeTime(entry.when)}</span>
              <span>·</span>
              <span>{entry.items} items</span>
              {entry.flagged > 0 && (
                <>
                  <span>·</span>
                  <span className="text-gate-foreground">{entry.flagged} flagged</span>
                </>
              )}
              {entry.durationMs > 0 && (
                <>
                  <span>·</span>
                  <span className="font-mono">{formatDuration(entry.durationMs)}</span>
                </>
              )}
            </div>
          </div>

          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
              expanded && "rotate-180",
            )}
          />
        </button>

        {/* Expanded trace */}
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="border-t border-border px-3 py-2.5"
          >
            <div className="mb-1.5 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
              Step trace
            </div>
            <div className="space-y-1">
              {entry.trace.map((step, i) => {
                const Icon =
                  step.kind === "reason"
                    ? Brain
                    : step.kind === "gate"
                      ? ShieldCheck
                      : step.kind === "spawn"
                        ? Brain
                        : Wrench;
                const stepColor =
                  step.kind === "reason"
                    ? "text-reason"
                    : step.kind === "gate"
                      ? "text-gate-foreground"
                      : "text-tool-foreground";
                return (
                  <div key={i} className="flex items-start gap-2 text-[10px]">
                    <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border border-border bg-muted/40 font-mono text-[8px] font-bold text-muted-foreground">
                      {i + 1}
                    </span>
                    <Icon className={cn("mt-0.5 h-3 w-3 shrink-0", stepColor)} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-foreground/90">{step.label}</span>
                        <StepStatusPill status={step.status} />
                      </div>
                      {step.note && (
                        <div className="mt-0.5 text-[9px] text-muted-foreground">
                          {step.note}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
}

function StepStatusPill({ status }: { status: TraceStep["status"] }) {
  const map: Record<TraceStep["status"], { label: string; cls: string }> = {
    ok: { label: "ok", cls: "bg-emerald-500/10 text-emerald-600" },
    flagged: { label: "flagged", cls: "bg-gate/15 text-gate-foreground" },
    waiting: { label: "waiting", cls: "bg-amber-500/10 text-amber-700" },
    running: { label: "running", cls: "bg-primary/10 text-primary" },
  };
  const m = map[status];
  return (
    <span className={cn("rounded px-1 py-0.5 text-[8px] font-medium", m.cls)}>{m.label}</span>
  );
}

// ─── Stat tile ───────────────────────────────────────────────────────────────

function StatTile({
  label,
  value,
  icon: Icon,
  accent,
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  accent: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </div>
          <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
        </div>
        <div className={cn("flex h-7 w-7 items-center justify-center rounded-md", accent)}>
          <Icon className="h-3.5 w-3.5" />
        </div>
      </div>
    </div>
  );
}
