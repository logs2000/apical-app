"use client";

import * as React from "react";
import { motion } from "framer-motion";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  Brain,
  CheckCircle2,
  ChevronDown,
  Clock,
  Filter,
  Loader2,
  Lock,
  ShieldCheck,
  Square,
  Wrench,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  agentAvatarSurface,
  agentInitials,
  formatDuration,
  relativeTime,
} from "@/lib/apical";
import { useRuns } from "@/lib/queries";
import { useWorkflowRun } from "@/hooks/use-workflow-run";
import { useRunSocket } from "@/hooks/use-run-socket";
import type { Run, RunReportItem, RunStep } from "@/lib/types";
import { RunReviewPanel } from "./run-review-panel";

type SortKey = "newest" | "oldest" | "status" | "agent";
type StatusFilter = "all" | "running" | "completed" | "failed" | "cancelled";
type TimeFilter = "all" | "today" | "week" | "flagged";

const DAY = 86_400_000;

function statusMeta(status: string) {
  switch (status) {
    case "running":
      return {
        label: "Running",
        badge: "border-border bg-accent text-foreground",
        dot: "bg-primary",
        icon: Clock,
      };
    case "completed":
      return {
        label: "Success",
        badge: "border-border bg-muted text-emerald-600",
        dot: "bg-foreground",
        icon: CheckCircle2,
      };
    case "failed":
      return {
        label: "Failed",
        badge: "border-destructive/30 bg-destructive/10 text-destructive",
        dot: "bg-destructive",
        icon: AlertTriangle,
      };
    case "cancelled":
      return {
        label: "Stopped",
        badge: "border-muted-foreground/30 bg-muted text-muted-foreground",
        dot: "bg-muted-foreground",
        icon: Square,
      };
    default:
      return {
        label: status,
        badge: "border-border bg-muted/40 text-muted-foreground",
        dot: "bg-muted-foreground",
        icon: Activity,
      };
  }
}

function sortRuns(runs: Run[], sort: SortKey): Run[] {
  const copy = [...runs];
  switch (sort) {
    case "oldest":
      return copy.sort((a, b) => +new Date(a.startedAt) - +new Date(b.startedAt));
    case "status":
      return copy.sort((a, b) => a.status.localeCompare(b.status));
    case "agent":
      return copy.sort((a, b) => a.workflowName.localeCompare(b.workflowName));
    case "newest":
    default:
      return copy.sort((a, b) => +new Date(b.startedAt) - +new Date(a.startedAt));
  }
}

function filterByTime(runs: Run[], timeFilter: TimeFilter): Run[] {
  const now = Date.now();
  if (timeFilter === "today") {
    const cutoff = now - DAY;
    return runs.filter((r) => +new Date(r.startedAt) >= cutoff);
  }
  if (timeFilter === "week") {
    const cutoff = now - 7 * DAY;
    return runs.filter((r) => +new Date(r.startedAt) >= cutoff);
  }
  if (timeFilter === "flagged") {
    return runs.filter((r) => r.flaggedCount > 0 || r.status === "failed");
  }
  return runs;
}

function stepKindIcon(kind: string) {
  if (kind === "reason") return Brain;
  if (kind === "gate") return ShieldCheck;
  return Wrench;
}

function formatOutput(output: unknown): string {
  if (output == null) return "";
  if (typeof output === "string") return output;
  return JSON.stringify(output, null, 2);
}

function RunAuditMeta({ run }: { run: Run }) {
  return (
    <div className="mb-2 grid gap-1 rounded border border-border/50 bg-background px-2 py-1.5 font-mono text-[9px] text-muted-foreground">
      <div>
        <span className="text-foreground/70">Run ID </span>
        {run.id}
      </div>
      <div>
        <span className="text-foreground/70">Started </span>
        {new Date(run.startedAt).toLocaleString()}
        {run.finishedAt && (
          <>
            {" · "}
            <span className="text-foreground/70">Finished </span>
            {new Date(run.finishedAt).toLocaleString()}
          </>
        )}
      </div>
      <div>
        {run.itemsProcessed} items · {run.automaticCount} auto · {run.flaggedCount} flagged ·{" "}
        {run.aiCallsUsed} AI calls
      </div>
    </div>
  );
}

function ReportItems({ items }: { items: RunReportItem[] }) {
  if (items.length === 0) return null;
  return (
    <div className="mt-2">
      <div className="mb-1 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
        Sample items
      </div>
      <div className="space-y-1">
        {items.map((item, i) => (
          <div key={i} className="rounded border border-border/40 bg-background px-2 py-1 text-[10px]">
            <div className="font-medium">{item.name}</div>
            <div className="text-muted-foreground">{item.outcome} · {item.detail}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StepTrace({ steps }: { steps: RunStep[] }) {
  return (
    <div className="space-y-1">
      {steps.map((step, i) => {
        const Icon = stepKindIcon(step.kind);
        return (
          <div key={step.id} className="flex items-start gap-2 border-b border-border/30 py-1.5 text-[10px] last:border-b-0">
            <span className="mt-0.5 font-mono text-[8px] text-muted-foreground">{i + 1}</span>
            <Icon className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="font-medium">{step.label}</div>
              <div className="text-muted-foreground">{step.status}</div>
              {step.output != null && (
                <pre className="mt-0.5 max-h-32 overflow-auto whitespace-pre-wrap font-mono text-[9px] text-muted-foreground">
                  {formatOutput(step.output)}
                </pre>
              )}
            </div>
            {step.aiTokens > 0 && (
              <span className="shrink-0 font-mono text-[8px] text-muted-foreground">{step.aiTokens} tok</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function LiveStepTrace({ runId }: { runId: string }) {
  const live = useRunSocket(runId);
  const steps = Object.values(live.steps).sort((a, b) => a.order - b.order);

  if (steps.length === 0) {
    return (
      <div className="flex items-center gap-1.5 py-2 text-[10px] text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" /> Starting run…
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {steps.map((step, i) => {
        const Icon = stepKindIcon(step.kind);
        return (
          <div key={step.stepId} className="flex items-start gap-2 py-1 text-[10px]">
            <span className="font-mono text-[8px] text-muted-foreground">{i + 1}</span>
            <Icon className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="font-medium">{step.label}</div>
              <div className="text-muted-foreground">
                {step.status}
                {step.message ? ` · ${step.message}` : ""}
              </div>
              {step.output != null && (
                <pre className="mt-0.5 max-h-32 overflow-auto whitespace-pre-wrap font-mono text-[9px] text-muted-foreground">
                  {formatOutput(step.output)}
                </pre>
              )}
            </div>
            {step.status === "running" && <Loader2 className="h-3 w-3 animate-spin text-foreground" />}
          </div>
        );
      })}
      {live.status === "reviewing" && (
        <div className="flex items-center gap-1.5 py-1 text-[10px] text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          Agent reviewing run…
        </div>
      )}
      {live.report?.review && <RunReviewPanel review={live.report.review} />}
    </div>
  );
}

function RunDetail({ run, live }: { run: Run; live?: boolean }) {
  return (
    <div className="border-t border-border px-3 py-2.5">
      <RunAuditMeta run={run} />
      <div className="mb-1.5 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
        Step trace
      </div>
      {live ? <LiveStepTrace runId={run.id} /> : <StepTrace steps={run.steps} />}
      {run.report?.summary && (
        <div className="mt-2 rounded border border-border/50 bg-muted/20 px-2 py-1.5 text-[10px] text-muted-foreground">
          {run.report.summary}
        </div>
      )}
      {run.report?.items && <ReportItems items={run.report.items} />}
      {!live && run.report?.review && <RunReviewPanel review={run.report.review} />}
      {run.report?.flags && run.report.flags.length > 0 && (
        <div className="mt-2 space-y-1">
          <div className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">Flags</div>
          {run.report.flags.map((f, i) => (
            <div key={i} className="text-[10px] text-gate">
              {f.item}: {f.reason}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RunLogRow({
  run,
  expanded,
  onToggle,
  live,
  timeline,
}: {
  run: Run;
  expanded: boolean;
  onToggle: () => void;
  live?: boolean;
  timeline?: boolean;
}) {
  const meta = statusMeta(run.status);
  const StatusIcon = meta.icon;
  const summary = run.report?.summary ?? `${run.steps.length} workflow steps`;

  const row = (
    <div
      className={cn(
        "rounded-lg border bg-card transition-colors",
        expanded ? "border-border" : "border-border hover:border-border/80",
        timeline && "relative",
      )}
    >
      <button type="button" onClick={onToggle} className="flex w-full items-start gap-3 p-3 text-left">
        <div
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-primary-foreground"
          style={{ backgroundColor: agentAvatarSurface(run.workflowName) }}
        >
          {agentInitials(run.workflowName)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-medium">{run.workflowName}</span>
            <Badge variant="outline" className={cn("text-[8px]", meta.badge)}>
              <StatusIcon className="mr-0.5 h-2.5 w-2.5" />
              {meta.label}
            </Badge>
            {live && run.status === "running" && (
              <Loader2 className="h-3 w-3 animate-spin text-foreground" />
            )}
          </div>
          <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-foreground/90">{summary}</p>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
            <span>{relativeTime(run.startedAt)}</span>
            <span>·</span>
            <span>{run.itemsProcessed} items</span>
            {run.flaggedCount > 0 && (
              <>
                <span>·</span>
                <span className="text-gate">{run.flaggedCount} flagged</span>
              </>
            )}
            {run.durationMs > 0 && (
              <>
                <span>·</span>
                <span className="font-mono">{formatDuration(run.durationMs)}</span>
              </>
            )}
            <span>·</span>
            <span>{run.trigger === "schedule" ? "scheduled" : "manual"}</span>
          </div>
        </div>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
            expanded && "rotate-180",
          )}
        />
      </button>
      {expanded && <RunDetail run={run} live={live} />}
    </div>
  );

  if (!timeline) return row;

  return (
    <div className="relative pl-9">
      <div
        className={cn(
          "absolute left-2 top-3 z-10 h-3.5 w-3.5 rounded-full border-2 border-background",
          meta.dot,
          run.status === "running" && "animate-pulse",
        )}
      />
      {row}
    </div>
  );
}

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
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
          <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
        </div>
        <div className={cn("flex h-7 w-7 items-center justify-center rounded-md", accent)}>
          <Icon className="h-3.5 w-3.5" />
        </div>
      </div>
    </div>
  );
}

export interface RunLogProps {
  workflowId?: string | null;
  title?: string;
  limit?: number;
  /** compact = embedded panel; full = Activity page with stats + timeline */
  variant?: "compact" | "full";
  showFilters?: boolean;
  liveRunId?: string | null;
  maxHeight?: string;
  className?: string;
}

/** Canonical auditable run log — used by Activity, Settings, and agent views. */
export function RunLog({
  workflowId,
  title = "Run log",
  limit = 50,
  variant = "compact",
  showFilters = true,
  liveRunId,
  maxHeight = "max-h-[32rem]",
  className,
}: RunLogProps) {
  const { data: runs, isLoading, error } = useRuns(limit, workflowId);
  const [sort, setSort] = React.useState<SortKey>("newest");
  const [statusFilter, setStatusFilter] = React.useState<StatusFilter>("all");
  const [timeFilter, setTimeFilter] = React.useState<TimeFilter>("all");
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());

  React.useEffect(() => {
    if (liveRunId) {
      setExpanded((prev) => new Set(prev).add(liveRunId));
    }
  }, [liveRunId]);

  const filtered = React.useMemo(() => {
    let list = runs ?? [];
    list = filterByTime(list, timeFilter);
    if (statusFilter !== "all") {
      list = list.filter((r) => r.status === statusFilter);
    }
    return sortRuns(list, sort);
  }, [runs, sort, statusFilter, timeFilter]);

  const stats = React.useMemo(() => {
    const all = runs ?? [];
    const now = Date.now();
    const todayCutoff = now - DAY;
    const weekCutoff = now - 7 * DAY;
    const today = all.filter((r) => +new Date(r.startedAt) >= todayCutoff);
    const week = all.filter((r) => +new Date(r.startedAt) >= weekCutoff);
    return {
      runsToday: today.length,
      itemsToday: today.reduce((a, r) => a + r.itemsProcessed, 0),
      autoResolved: week.reduce((a, r) => a + r.automaticCount, 0),
      flagged: week.reduce((a, r) => a + r.flaggedCount, 0),
    };
  }, [runs]);

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const isFull = variant === "full";
  const timeline = isFull || variant === "compact";

  return (
    <div className={cn(!isFull && "rounded-lg border border-border bg-card", className)}>
      {isFull && (
        <div className="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
          <StatTile label="Runs today" value={String(stats.runsToday)} icon={Activity} accent="bg-accent text-foreground" />
          <StatTile label="Items processed" value={String(stats.itemsToday)} icon={CheckCircle2} accent="bg-muted text-foreground" />
          <StatTile label="Auto-resolved" value={String(stats.autoResolved)} icon={Lock} accent="bg-hardened/15 text-hardened" />
          <StatTile label="Flagged (7d)" value={String(stats.flagged)} icon={AlertTriangle} accent="bg-gate/15 text-gate-foreground" />
        </div>
      )}

      {(showFilters || title) && (
        <div className={cn("flex flex-wrap items-center justify-between gap-2", !isFull && "border-b border-border px-3 py-2")}>
          {!isFull && (
            <div>
              <div className="text-xs font-semibold">{title}</div>
              <div className="text-[10px] text-muted-foreground">
                {workflowId ? "Runs for this agent" : "All workflow runs · fully auditable"}
              </div>
            </div>
          )}
          {showFilters && (
            <div className="flex flex-wrap items-center gap-1.5">
              {isFull && (
                <div className="flex items-center gap-0.5 rounded-lg border border-border bg-muted/30 p-0.5">
                  {(
                    [
                      { key: "all", label: "All" },
                      { key: "today", label: "Today" },
                      { key: "week", label: "This week" },
                      { key: "flagged", label: "Flagged" },
                    ] as const
                  ).map((f) => (
                    <button
                      key={f.key}
                      type="button"
                      onClick={() => setTimeFilter(f.key)}
                      className={cn(
                        "rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors",
                        timeFilter === f.key
                          ? "bg-background text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              )}
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
                className="h-7 rounded-md border border-border bg-background px-2 text-[10px]"
              >
                <option value="all">All statuses</option>
                <option value="running">Running</option>
                <option value="completed">Success</option>
                <option value="failed">Failed</option>
                <option value="cancelled">Stopped</option>
              </select>
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as SortKey)}
                className="h-7 rounded-md border border-border bg-background px-2 text-[10px]"
              >
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
                <option value="status">By status</option>
                {!workflowId && <option value="agent">By agent</option>}
              </select>
              {isFull && <Filter className="h-3 w-3 text-muted-foreground" />}
            </div>
          )}
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-8 text-xs text-muted-foreground">
          <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Loading runs…
        </div>
      ) : error ? (
        <div className="px-3 py-4 text-xs text-destructive">Failed to load runs.</div>
      ) : filtered.length === 0 ? (
        <div className="px-3 py-8 text-center text-[11px] text-muted-foreground">
          No runs match this filter. Start one with Run now.
        </div>
      ) : (
        <div className={cn("overflow-y-auto px-3 py-2", maxHeight, isFull && "px-0")}>
          {isFull && <div className="relative mb-2"><div className="absolute bottom-2 left-[15px] top-2 w-px bg-border" /></div>}
          <motion.div
            className={cn("space-y-2", isFull && "relative")}
            initial={isFull ? "hidden" : false}
            animate={isFull ? "show" : false}
            variants={isFull ? { hidden: {}, show: { transition: { staggerChildren: 0.03 } } } : undefined}
          >
            {filtered.map((run) => (
              <motion.div
                key={run.id}
                variants={isFull ? { hidden: { opacity: 0, x: -6 }, show: { opacity: 1, x: 0 } } : undefined}
              >
                <RunLogRow
                  run={run}
                  expanded={expanded.has(run.id) || run.id === liveRunId}
                  onToggle={() => toggle(run.id)}
                  live={run.id === liveRunId && run.status === "running"}
                  timeline={timeline}
                />
              </motion.div>
            ))}
          </motion.div>
        </div>
      )}
    </div>
  );
}

/** @deprecated Use RunLog */
export const WorkflowRunsConsole = RunLog;

export function AgentRunSection({ workflowId }: { workflowId: string }) {
  const run = useWorkflowRun(workflowId);

  const outcomeBadge =
    run.lastOutcome === "completed"
      ? { icon: CheckCircle2, label: "Run succeeded", className: "text-emerald-600" }
      : run.lastOutcome === "failed"
        ? { icon: AlertCircle, label: "Run failed", className: "text-destructive" }
        : run.lastOutcome === "cancelled"
          ? { icon: Square, label: "Run stopped", className: "text-muted-foreground" }
          : null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {run.isRunning ? (
          <>
            <Button variant="outline" size="sm" className="gap-1.5" disabled>
              <Loader2 className="h-3 w-3 animate-spin" />
              {run.isReviewing ? "Reviewing…" : "Running…"}
            </Button>
            {!run.isReviewing && (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 text-destructive hover:text-destructive"
                onClick={() => void run.stopRun()}
                disabled={run.isStopping || !run.activeRunId}
              >
                {run.isStopping ? <Loader2 className="h-3 w-3 animate-spin" /> : <Square className="h-3 w-3" />}
                Stop
              </Button>
            )}
          </>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => void run.startRun()}
            disabled={run.isStarting}
          >
            {run.isStarting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Activity className="h-3 w-3" />}
            Run now
          </Button>
        )}
        {outcomeBadge && (
          <span className={cn("flex items-center gap-1 text-[11px] font-medium", outcomeBadge.className)}>
            <outcomeBadge.icon className="h-3.5 w-3.5" />
            {outcomeBadge.label}
          </span>
        )}
        {run.startError && <span className="text-[11px] text-destructive">{run.startError}</span>}
      </div>
      <RunLog workflowId={workflowId} liveRunId={run.activeRunId} showFilters={false} />
    </div>
  );
}

export function RunNowControls({ workflowId }: { workflowId: string }) {
  const { startRun, stopRun, isRunning, isStarting, isStopping, lastOutcome, startError, activeRunId } =
    useWorkflowRun(workflowId);

  const outcomeBadge =
    lastOutcome === "completed"
      ? { icon: CheckCircle2, label: "Run succeeded", className: "text-emerald-600" }
      : lastOutcome === "failed"
        ? { icon: AlertCircle, label: "Run failed", className: "text-destructive" }
        : lastOutcome === "cancelled"
          ? { icon: Square, label: "Run stopped", className: "text-muted-foreground" }
          : null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {isRunning ? (
        <>
          <Button variant="outline" size="sm" className="gap-1.5" disabled>
            <Loader2 className="h-3 w-3 animate-spin" />
            Running…
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 text-destructive hover:text-destructive"
            onClick={() => void stopRun()}
            disabled={isStopping || !activeRunId}
          >
            {isStopping ? <Loader2 className="h-3 w-3 animate-spin" /> : <Square className="h-3 w-3" />}
            Stop
          </Button>
        </>
      ) : (
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => void startRun()}
          disabled={isStarting}
        >
          {isStarting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Activity className="h-3 w-3" />}
          Run now
        </Button>
      )}
      {outcomeBadge && (
        <span className={cn("flex items-center gap-1 text-[11px] font-medium", outcomeBadge.className)}>
          <outcomeBadge.icon className="h-3.5 w-3.5" />
          {outcomeBadge.label}
        </span>
      )}
      {startError && <span className="text-[11px] text-destructive">{startError}</span>}
    </div>
  );
}
