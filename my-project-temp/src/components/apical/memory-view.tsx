"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useAppStore } from "@/lib/apical/store";
import {
  DEMO_WORKFLOWS,
  agentInitials,
  agentAvatarLightness,
  type Workflow,
} from "@/lib/apical";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Brain,
  Sparkles,
  Trash2,
  Boxes,
  Heart,
  AlertCircle,
  TrendingUp,
  Lock,
  Info,
} from "lucide-react";

// ─── Memory types ────────────────────────────────────────────────────────────

type MemoryKind = "entity" | "preference" | "correction" | "pattern";

interface MemoryEntry {
  id: string;
  kind: MemoryKind;
  text: string;
  source: string;
  confidence: number; // 0–100
  /** Hardening progress for pattern entries (e.g. 47/50 consistent runs). */
  hardening?: { current: number; target: number };
}

interface AgentMemory {
  agentId: string;
  entries: MemoryEntry[];
}

// ─── Demo memory data ────────────────────────────────────────────────────────

const MEMORY: AgentMemory[] = [
  {
    agentId: "w1", // Compass
    entries: [
      { id: "w1-e1", kind: "entity", text: "Client “Acme Corp” → /Clients/Acme Corp/", source: "Learned from run #1284", confidence: 99 },
      { id: "w1-e2", kind: "entity", text: "Client “North Industries” → /Clients/North Industries/", source: "Learned from run #1284", confidence: 99 },
      { id: "w1-e3", kind: "entity", text: "Client “Globex” → /Clients/Globex/", source: "Learned from run #1284", confidence: 99 },
      { id: "w1-e4", kind: "entity", text: "Client “Initech” → /Clients/Initech/", source: "Learned from run #1284", confidence: 99 },
      { id: "w1-e5", kind: "preference", text: "Jordan prefers PDFs sorted by date, not filename.", source: "Corrected by Jordan on Jun 18", confidence: 95 },
      { id: "w1-e6", kind: "preference", text: "Undated scans go to /Clients/_Unsorted/, not the trash.", source: "Corrected by Jordan on Jun 18", confidence: 92 },
      { id: "w1-e7", kind: "correction", text: "Don't auto-create client folders from OCR alone — always gate first.", source: "Corrected by Jordan on Jun 12", confidence: 88 },
      { id: "w1-e8", kind: "correction", text: "Re-OCR failed reads overnight before flagging.", source: "Corrected by Jordan on Jun 10", confidence: 90 },
      { id: "w1-e9", kind: "pattern", text: "“files.move” step is consistent. Ready to harden (no AI needed).", source: "47/50 consistent runs", confidence: 94, hardening: { current: 47, target: 50 } },
      { id: "w1-e10", kind: "pattern", text: "Invoices from “billing@” senders are always billing category.", source: "Learned from run #1284", confidence: 86 },
    ],
  },
  {
    agentId: "w2", // Atlas
    entries: [
      { id: "w2-e1", kind: "entity", text: "Onboarding sequence = welcome (day 0) + day-3 + day-7.", source: "Learned from run #47", confidence: 97 },
      { id: "w2-e2", kind: "entity", text: "“Priya” is the CSM for enterprise accounts >$10k MRR.", source: "Learned from run #47", confidence: 91 },
      { id: "w2-e3", kind: "preference", text: "Jordan likes a casual tone — “Hey {{first_name}},” not “Dear”.", source: "Corrected by Jordan on Jun 14", confidence: 93 },
      { id: "w2-e4", kind: "preference", text: "Keep emails under 120 words. Bullet points > paragraphs.", source: "Corrected by Jordan on Jun 14", confidence: 90 },
      { id: "w2-e5", kind: "correction", text: "Don't schedule sends on weekends — hold for Monday 9am.", source: "Corrected by Jordan on Jun 20", confidence: 89 },
      { id: "w2-e6", kind: "pattern", text: "“gmail.schedule” step is consistent. Ready to harden.", source: "32/50 consistent runs", confidence: 78, hardening: { current: 32, target: 50 } },
    ],
  },
  {
    agentId: "w3", // Sentinel
    entries: [
      { id: "w3-e1", kind: "entity", text: "Watching 6 competitors: Rival.io, Competa, Outwork, +3.", source: "Learned from run #89", confidence: 98 },
      { id: "w3-e2", kind: "entity", text: "Rival.io pricing page: rival.io/pricing (Pro + Team tiers).", source: "Learned from run #89", confidence: 96 },
      { id: "w3-e3", kind: "preference", text: "Jordan wants Slack pings only for changes >5% — not noise.", source: "Corrected by Jordan on Jun 19", confidence: 94 },
      { id: "w3-e4", kind: "preference", text: "Group changes into one daily digest instead of pinging live.", source: "Corrected by Jordan on Jun 19", confidence: 91 },
      { id: "w3-e5", kind: "correction", text: "Don't flag seat-count changes as “price changes” — separate.", source: "Corrected by Jordan on Jun 16", confidence: 87 },
      { id: "w3-e6", kind: "pattern", text: "“http.fetch” step is consistent. Hardened — no AI needed.", source: "89/89 consistent runs · hardened", confidence: 99, hardening: { current: 89, target: 50 } },
      { id: "w3-e7", kind: "pattern", text: "Competitor pages rarely change structure week-to-week.", source: "Learned from run #89", confidence: 82 },
    ],
  },
  {
    agentId: "w4", // Tally
    entries: [
      { id: "w4-e1", kind: "entity", text: "Policy: flag any line item over $500.", source: "Configured at setup", confidence: 100 },
      { id: "w4-e2", kind: "entity", text: "Policy: require receipt for any meal over $75.", source: "Configured at setup", confidence: 100 },
      { id: "w4-e3", kind: "entity", text: "Approvers: Jordan (Eng), Sam (Sales), Priya (Ops).", source: "Learned from run #23", confidence: 95 },
      { id: "w4-e4", kind: "preference", text: "Jordan wants hardware claims auto-approved under $300.", source: "Corrected by Jordan on Jun 17", confidence: 92 },
      { id: "w4-e5", kind: "correction", text: "Don't flag subscription renewals — they're recurring.", source: "Corrected by Jordan on Jun 15", confidence: 90 },
      { id: "w4-e6", kind: "correction", text: "Conference travel >$1000 needs VP approval, not just manager.", source: "Corrected by Jordan on Jun 13", confidence: 88 },
      { id: "w4-e7", kind: "pattern", text: "“expensify.approve” step is consistent. Hardened.", source: "23/23 consistent runs · hardened", confidence: 99, hardening: { current: 23, target: 50 } },
    ],
  },
  {
    agentId: "w5", // Beacon
    entries: [
      { id: "w5-e1", kind: "entity", text: "Tracking 18 licenses + contracts across vendors.", source: "Learned from run #30", confidence: 97 },
      { id: "w5-e2", kind: "entity", text: "Stripe renews Jul 22 ($284/mo). Alert at 30d + 7d.", source: "Learned from run #30", confidence: 96 },
      { id: "w5-e3", kind: "entity", text: "Globex MSA expires Jul 10. Renewal draft ready.", source: "Learned from run #30", confidence: 95 },
      { id: "w5-e4", kind: "preference", text: "Jordan wants 30-day + 7-day reminders, not just one.", source: "Corrected by Jordan on Jun 11", confidence: 93 },
      { id: "w5-e5", kind: "correction", text: "Don't create tasks for auto-renewing Let's Encrypt certs.", source: "Corrected by Jordan on Jun 11", confidence: 91 },
      { id: "w5-e6", kind: "pattern", text: "“calendar.scan” step is consistent. Hardened.", source: "30/30 consistent runs · hardened", confidence: 99, hardening: { current: 30, target: 50 } },
    ],
  },
  {
    agentId: "w6", // Scout
    entries: [
      { id: "w6-e1", kind: "entity", text: "ICP: fintech, 50–200 employees, US-based, hiring.", source: "Configured at setup", confidence: 100 },
      { id: "w6-e2", kind: "entity", text: "Enrichment source: Clearbit (company size + industry).", source: "Learned from run #4", confidence: 94 },
      { id: "w6-e3", kind: "preference", text: "Jordan rejects companies with <50 employees — too small.", source: "Corrected by Jordan on Jun 18", confidence: 92 },
      { id: "w6-e4", kind: "preference", text: "Prioritize companies hiring Eng + Sales (growing).", source: "Corrected by Jordan on Jun 18", confidence: 89 },
      { id: "w6-e5", kind: "correction", text: "Don't add prospects to HubSpot until reviewed — gate first.", source: "Corrected by Jordan on Jun 17", confidence: 90 },
      { id: "w6-e6", kind: "pattern", text: "“clearbit.enrich” step is consistent. Ready to harden.", source: "12/50 consistent runs", confidence: 65, hardening: { current: 12, target: 50 } },
      { id: "w6-e7", kind: "pattern", text: "LinkedIn search results drift ~15% week-to-week.", source: "Learned from run #4", confidence: 70 },
    ],
  },
];

// ─── Kind metadata ───────────────────────────────────────────────────────────

const KIND_META: Record<
  MemoryKind,
  { label: string; icon: React.ComponentType<{ className?: string }>; color: string }
> = {
  entity: { label: "Entities", icon: Boxes, color: "text-primary" },
  preference: { label: "Preferences", icon: Heart, color: "text-reason" },
  correction: { label: "Corrections", icon: AlertCircle, color: "text-gate-foreground" },
  pattern: { label: "Patterns", icon: TrendingUp, color: "text-hardened" },
};

const KIND_ORDER: MemoryKind[] = ["entity", "preference", "correction", "pattern"];

// ─── Memory view ─────────────────────────────────────────────────────────────

export function MemoryView() {
  const [selectedId, setSelectedId] = React.useState<string>(DEMO_WORKFLOWS[0]?.id ?? "");
  const deleted = useAppStore((s) => s.deletedMemory);

  const selectedAgent = DEMO_WORKFLOWS.find((w) => w.id === selectedId);
  const agentMemory = MEMORY.find((m) => m.agentId === selectedId);

  const visibleEntries = React.useMemo(() => {
    if (!agentMemory) return [];
    const removed = new Set(deleted[selectedId] ?? []);
    return agentMemory.entries.filter((e) => !removed.has(e.id));
  }, [agentMemory, deleted, selectedId]);

  const grouped = React.useMemo(() => {
    const g: Record<MemoryKind, MemoryEntry[]> = {
      entity: [],
      preference: [],
      correction: [],
      pattern: [],
    };
    for (const e of visibleEntries) g[e.kind].push(e);
    return g;
  }, [visibleEntries]);

  const totalEntries = MEMORY.reduce((a, m) => a + m.entries.length, 0);
  const totalDeleted = Object.values(deleted).reduce((a, arr) => a + arr.length, 0);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Explainer banner */}
      <div className="shrink-0 border-b border-border bg-gradient-to-r from-primary/5 via-card to-card px-4 py-2.5 md:px-6">
        <div className="mx-auto flex max-w-5xl items-start gap-2">
          <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Info className="h-3.5 w-3.5" />
          </div>
          <div className="min-w-0 flex-1">
            <span className="text-xs font-medium">Memory helps agents get smarter over time.</span>
            <span className="ml-1 text-[11px] text-muted-foreground">
              Every run, correction, and approval teaches the agent your preferences.
              Consistent patterns auto-harden into tool calls (no AI, near-free).
            </span>
          </div>
          <Badge variant="outline" className="shrink-0 border-primary/30 bg-primary/5 text-primary">
            <Sparkles className="h-2.5 w-2.5" /> {totalEntries - totalDeleted} memories
          </Badge>
        </div>
      </div>

      {/* Two-pane layout */}
      <div className="flex min-h-0 flex-1">
        {/* Left: agent list */}
        <div className="w-56 shrink-0 overflow-y-auto overscroll-contain border-r border-border bg-muted/20 p-2">
          <div className="mb-2 px-2 pt-1">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold tracking-tight">
              <Brain className="h-3.5 w-3.5 text-muted-foreground" /> Memory
            </h2>
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              Pick an agent to see what it remembers.
            </p>
          </div>
          <div className="space-y-0.5">
            {DEMO_WORKFLOWS.map((agent) => {
              const mem = MEMORY.find((m) => m.agentId === agent.id);
              const count = mem
                ? mem.entries.length - (deleted[agent.id]?.length ?? 0)
                : 0;
              return (
                <AgentListItem
                  key={agent.id}
                  agent={agent}
                  count={count}
                  active={selectedId === agent.id}
                  onClick={() => setSelectedId(agent.id)}
                />
              );
            })}
          </div>
        </div>

        {/* Right: memory entries */}
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain">
          {selectedAgent && (
            <AgentMemoryPanel
              agent={selectedAgent}
              grouped={grouped}
              totalCount={visibleEntries.length}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Agent list item (left pane) ─────────────────────────────────────────────

function AgentListItem({
  agent,
  count,
  active,
  onClick,
}: {
  agent: Workflow;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
        active
          ? "bg-primary/10 text-foreground"
          : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
      )}
    >
      <div
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold text-primary-foreground"
        style={{ backgroundColor: `oklch(${agentAvatarLightness(agent.name)} 0.06 155)` }}
      >
        {agentInitials(agent.name)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[11px] font-medium">{agent.name}</div>
        <div className="truncate text-[9px] text-muted-foreground">{agent.department}</div>
      </div>
      <span
        className={cn(
          "shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-medium tabular-nums",
          active ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
        )}
      >
        {count}
      </span>
    </button>
  );
}

// ─── Agent memory panel (right pane) ─────────────────────────────────────────

function AgentMemoryPanel({
  agent,
  grouped,
  totalCount,
}: {
  agent: Workflow;
  grouped: Record<MemoryKind, MemoryEntry[]>;
  totalCount: number;
}) {
  return (
    <div className="mx-auto max-w-2xl px-4 py-4 md:px-6">
      {/* Agent header */}
      <div className="mb-4 flex items-center gap-3">
        <div
          className="flex h-10 w-10 items-center justify-center rounded-full text-xs font-semibold text-primary-foreground"
          style={{ backgroundColor: `oklch(${agentAvatarLightness(agent.name)} 0.06 155)` }}
        >
          {agentInitials(agent.name)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold">{agent.name}</h2>
            <span className="text-[10px] text-muted-foreground">{agent.department}</span>
          </div>
          <p className="truncate text-[11px] text-muted-foreground">{agent.description}</p>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Memories
          </div>
          <div className="text-sm font-semibold tabular-nums">{totalCount}</div>
        </div>
      </div>

      <Separator className="mb-4" />

      {totalCount === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-8 text-center">
          <Brain className="mx-auto mb-2 h-8 w-8 text-muted-foreground/50" />
          <p className="text-sm font-medium">No memories left for {agent.name}.</p>
          <p className="mt-1 text-xs text-muted-foreground">
            You've deleted all of this agent's learned context. It will start fresh on the
            next run.
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {KIND_ORDER.map((kind) => {
            const entries = grouped[kind];
            if (entries.length === 0) return null;
            const meta = KIND_META[kind];
            const Icon = meta.icon;
            return (
              <MemorySection
                key={kind}
                agentId={agent.id}
                icon={Icon}
                label={meta.label}
                color={meta.color}
                entries={entries}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Memory section (grouped by kind) ────────────────────────────────────────

function MemorySection({
  agentId,
  icon: Icon,
  label,
  color,
  entries,
}: {
  agentId: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  color: string;
  entries: MemoryEntry[];
}) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-1.5">
        <Icon className={cn("h-3.5 w-3.5", color)} />
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </h3>
        <span className="text-[10px] text-muted-foreground">· {entries.length}</span>
      </div>
      <motion.div
        className="space-y-1.5"
        initial="hidden"
        animate="show"
        variants={{ hidden: {}, show: { transition: { staggerChildren: 0.03 } } }}
      >
        <AnimatePresence mode="popLayout">
          {entries.map((entry) => (
            <motion.div
              key={entry.id}
              layout
              variants={{
                hidden: { opacity: 0, y: 6 },
                show: { opacity: 1, y: 0 },
                exit: { opacity: 0, x: 8 },
              }}
              transition={{ duration: 0.18, ease: "easeOut" }}
            >
              <MemoryEntryRow agentId={agentId} entry={entry} />
            </motion.div>
          ))}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}

// ─── Single memory entry ─────────────────────────────────────────────────────

function MemoryEntryRow({
  agentId,
  entry,
}: {
  agentId: string;
  entry: MemoryEntry;
}) {
  const deleteMemoryEntry = useAppStore((s) => s.deleteMemoryEntry);

  const isHardened =
    entry.hardening && entry.hardening.current >= entry.hardening.target;

  return (
    <div className="group flex items-start gap-2.5 rounded-lg border border-border bg-card p-2.5 transition-colors hover:border-border/80">
      <div className="min-w-0 flex-1">
        <p className="text-[11px] leading-relaxed text-foreground/90">{entry.text}</p>
        <div className="mt-1 flex items-center gap-2 text-[9px] text-muted-foreground">
          <span>{entry.source}</span>
          <span>·</span>
          <span className="inline-flex items-center gap-0.5">
            <span
              className={cn(
                "font-medium tabular-nums",
                entry.confidence >= 90
                  ? "text-emerald-600"
                  : entry.confidence >= 70
                    ? "text-primary"
                    : "text-gate-foreground",
              )}
            >
              {entry.confidence}%
            </span>
            confidence
          </span>
        </div>
        {/* Hardening progress bar */}
        {entry.hardening && (
          <div className="mt-1.5">
            <div className="mb-0.5 flex items-center gap-1.5 text-[9px]">
              {isHardened ? (
                <span className="inline-flex items-center gap-0.5 font-medium text-hardened">
                  <Lock className="h-2.5 w-2.5" /> Hardened — auto-converts reason → tool
                </span>
              ) : (
                <span className="text-muted-foreground">
                  {entry.hardening.current}/{entry.hardening.target} consistent runs to harden
                </span>
              )}
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-muted">
              <div
                className={cn(
                  "h-full rounded-full transition-all",
                  isHardened ? "bg-hardened" : "bg-primary",
                )}
                style={{
                  width: `${Math.min(100, (entry.hardening.current / entry.hardening.target) * 100)}%`,
                }}
              />
            </div>
          </div>
        )}
      </div>
      <Button
        size="sm"
        variant="ghost"
        className="h-6 shrink-0 px-1.5 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
        onClick={() => deleteMemoryEntry(agentId, entry.id)}
        title="Forget this"
      >
        <Trash2 className="h-3 w-3" />
      </Button>
    </div>
  );
}


