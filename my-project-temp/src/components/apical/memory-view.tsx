"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { agentInitials, agentAvatarSurface } from "@/lib/apical";
import {
  useWorkflows,
  useWorkflow,
  useMemories,
  useDeleteMemory,
  type AgentMemoryEntry,
} from "@/lib/queries";
import type { Workflow } from "@/lib/types";
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
  Loader2,
} from "lucide-react";

// ─── Kind metadata ───────────────────────────────────────────────────────────

type MemoryKind = "entity" | "preference" | "correction" | "pattern";

const KIND_META: Record<
  MemoryKind,
  { label: string; icon: React.ComponentType<{ className?: string }>; color: string }
> = {
  entity: { label: "Entities", icon: Boxes, color: "text-foreground" },
  preference: { label: "Preferences", icon: Heart, color: "text-reason" },
  correction: { label: "Corrections", icon: AlertCircle, color: "text-gate-foreground" },
  pattern: { label: "Patterns", icon: TrendingUp, color: "text-hardened" },
};

const KIND_ORDER: MemoryKind[] = ["entity", "preference", "correction", "pattern"];

function asKind(kind: string): MemoryKind {
  return (KIND_ORDER as string[]).includes(kind) ? (kind as MemoryKind) : "entity";
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return "";
  }
}

// ─── Memory view ─────────────────────────────────────────────────────────────

export function MemoryView() {
  const { data: workflows, isLoading: agentsLoading } = useWorkflows();
  const { data: memories, isLoading: memoriesLoading } = useMemories();

  const [pickedId, setPickedId] = React.useState<string | null>(null);

  // Derive the selection: the user's pick when it still exists, else the first
  // agent once the list loads (no effect needed).
  const selectedId =
    pickedId && workflows?.some((w) => w.id === pickedId)
      ? pickedId
      : (workflows?.[0]?.id ?? null);

  const selectedAgent = workflows?.find((w) => w.id === selectedId) ?? null;

  const byAgent = React.useMemo(() => {
    const map = new Map<string, AgentMemoryEntry[]>();
    for (const m of memories ?? []) {
      const list = map.get(m.agentId);
      if (list) list.push(m);
      else map.set(m.agentId, [m]);
    }
    return map;
  }, [memories]);

  const visibleEntries = selectedId ? (byAgent.get(selectedId) ?? []) : [];

  const grouped = React.useMemo(() => {
    const g: Record<MemoryKind, AgentMemoryEntry[]> = {
      entity: [],
      preference: [],
      correction: [],
      pattern: [],
    };
    for (const e of visibleEntries) g[asKind(e.kind)].push(e);
    return g;
  }, [visibleEntries]);

  const totalEntries = memories?.length ?? 0;
  const loading = agentsLoading || memoriesLoading;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Explainer banner */}
      <div className="shrink-0 border-b border-border bg-gradient-to-r from-brand/5 via-card to-card px-4 py-2.5 md:px-6">
        <div className="mx-auto flex max-w-5xl items-start gap-2">
          <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-accent text-foreground">
            <Info className="h-3.5 w-3.5" />
          </div>
          <div className="min-w-0 flex-1">
            <span className="text-xs font-medium">Memory helps agents get smarter over time.</span>
            <span className="ml-1 text-[11px] text-muted-foreground">
              Agents save durable facts, preferences, and corrections as they work
              — and read them back at the start of every run. Deleting one here
              removes it from the agent&apos;s context for good.
            </span>
          </div>
          <Badge variant="outline" className="shrink-0 border-border bg-muted text-foreground">
            <Sparkles className="h-2.5 w-2.5" /> {totalEntries} {totalEntries === 1 ? "memory" : "memories"}
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
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-8 text-[11px] text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
            </div>
          ) : !workflows || workflows.length === 0 ? (
            <div className="px-2 py-6 text-center text-[11px] text-muted-foreground">
              No agents yet. Create one from the Agents tab — its memories will
              show up here.
            </div>
          ) : (
            <div className="space-y-0.5">
              {workflows.map((agent) => (
                <AgentListItem
                  key={agent.id}
                  agent={agent}
                  count={byAgent.get(agent.id)?.length ?? 0}
                  active={selectedId === agent.id}
                  onClick={() => setPickedId(agent.id)}
                />
              ))}
            </div>
          )}
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
          ? "bg-accent text-foreground"
          : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
      )}
    >
      <div
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold text-primary-foreground"
        style={{ backgroundColor: agentAvatarSurface(agent.name) }}
      >
        {agentInitials(agent.name)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[11px] font-medium">{agent.name}</div>
        <div className="truncate text-[9px] text-muted-foreground">Agent</div>
      </div>
      <span
        className={cn(
          "shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-medium tabular-nums",
          active ? "bg-accent text-foreground" : "bg-muted text-muted-foreground",
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
  grouped: Record<MemoryKind, AgentMemoryEntry[]>;
  totalCount: number;
}) {
  // Real step-hardening state for this agent (ExecutionPattern rows).
  const { data: detail } = useWorkflow(agent.id);
  const patterns = detail?.patterns ?? [];

  return (
    <div className="mx-auto max-w-2xl px-4 py-4 md:px-6">
      {/* Agent header */}
      <div className="mb-4 flex items-center gap-3">
        <div
          className="flex h-10 w-10 items-center justify-center rounded-full text-xs font-semibold text-primary-foreground"
          style={{ backgroundColor: agentAvatarSurface(agent.name) }}
        >
          {agentInitials(agent.name)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold">{agent.name}</h2>
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
          <p className="text-sm font-medium">No memories yet for {agent.name}.</p>
          <p className="mt-1 text-xs text-muted-foreground">
            As you chat and correct this agent, it saves what it learns — facts,
            preferences, and corrections will show up here.
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
                icon={Icon}
                label={meta.label}
                color={meta.color}
                entries={entries}
              />
            );
          })}
        </div>
      )}

      {/* Step hardening — real ExecutionPattern rows from this agent's runs. */}
      {patterns.length > 0 && (
        <div className="mt-6">
          <div className="mb-2 flex items-center gap-1.5">
            <Lock className="h-3.5 w-3.5 text-hardened" />
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Step hardening
            </h3>
            <span className="text-[10px] text-muted-foreground">· {patterns.length}</span>
          </div>
          <p className="mb-2 text-[10px] text-muted-foreground">
            Steps that produce the same output run after run get &quot;hardened&quot;
            into deterministic rules — no AI call needed.
          </p>
          <div className="space-y-1.5">
            {patterns.map((p) => (
              <div
                key={p.id}
                className="flex items-center gap-2.5 rounded-lg border border-border bg-card p-2.5"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[11px] text-foreground/90">
                    <span className="font-medium">{p.stepId}</span>
                    <span className="text-muted-foreground"> · {p.signature}</span>
                  </p>
                  <p className="mt-0.5 text-[9px] text-muted-foreground">
                    {p.occurrences} consistent {p.occurrences === 1 ? "run" : "runs"}
                  </p>
                </div>
                {p.hardened ? (
                  <Badge variant="outline" className="shrink-0 border-hardened/40 text-[9px] text-hardened">
                    <Lock className="mr-0.5 h-2.5 w-2.5" /> Hardened
                  </Badge>
                ) : (
                  <Badge variant="outline" className="shrink-0 text-[9px] text-muted-foreground">
                    Learning
                  </Badge>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Memory section (grouped by kind) ────────────────────────────────────────

function MemorySection({
  icon: Icon,
  label,
  color,
  entries,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  color: string;
  entries: AgentMemoryEntry[];
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
              <MemoryEntryRow entry={entry} />
            </motion.div>
          ))}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}

// ─── Single memory entry ─────────────────────────────────────────────────────

function MemoryEntryRow({ entry }: { entry: AgentMemoryEntry }) {
  const deleteMemory = useDeleteMemory();

  return (
    <div className="group flex items-start gap-2.5 rounded-lg border border-border bg-card p-2.5 transition-colors hover:border-border/80">
      <div className="min-w-0 flex-1">
        <p className="text-[11px] leading-relaxed text-foreground/90">{entry.text}</p>
        <div className="mt-1 flex items-center gap-2 text-[9px] text-muted-foreground">
          <span>{entry.source}</span>
          <span>·</span>
          <span>{formatDate(entry.createdAt)}</span>
        </div>
      </div>
      <Button
        size="sm"
        variant="ghost"
        className="h-6 shrink-0 px-1.5 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
        onClick={() => deleteMemory.mutate(entry.id)}
        disabled={deleteMemory.isPending}
        title="Forget this"
      >
        <Trash2 className="h-3 w-3" />
      </Button>
    </div>
  );
}
