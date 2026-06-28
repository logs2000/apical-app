"use client";

import * as React from "react";
import {
  AlertCircle,
  Brain,
  ChevronDown,
  ChevronRight,
  Loader2,
  Wrench,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChatRun, ExecutionStep, ExecutionStatus } from "@/lib/apical";
import { RunReviewPanel } from "./run-review-panel";

function statusDot(status: ChatRun["status"]) {
  switch (status) {
    case "running":
      return "bg-primary animate-pulse";
    case "analyzing":
      return "bg-violet-500 animate-pulse";
    case "completed":
      return "bg-emerald-500";
    case "failed":
      return "bg-destructive";
    case "stopped":
      return "bg-muted-foreground";
    default:
      return "bg-muted-foreground";
  }
}

function runSummary(run: ChatRun): string {
  const n = run.steps.length;
  const toolSteps = run.steps.filter((s) => s.tool !== "reason");
  const latest = run.steps[run.steps.length - 1];

  if (run.status === "running") {
    const active = [...run.steps].reverse().find((s) => s.status === "running") ?? latest;
    if (active?.tool === "reason") return `Thinking · ${n} step${n === 1 ? "" : "s"}`;
    if (active) return `${active.tool || active.action} · step ${n}`;
    return "Running…";
  }
  if (run.status === "analyzing") return `Reviewing run · ${n} step${n === 1 ? "" : "s"}`;
  if (run.status === "stopped") return `Stopped · ${n} step${n === 1 ? "" : "s"}`;
  if (run.status === "failed") return `Failed · ${toolSteps.length || n} step${(toolSteps.length || n) === 1 ? "" : "s"}`;
  if (run.analysis && !(run.analysis.outcomeAchieved ?? run.analysis.success)) {
    return `Needs review · ${n} step${n === 1 ? "" : "s"}`;
  }

  const time = run.finishedAt
    ? new Date(run.finishedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "";
  return `Completed · ${n} step${n === 1 ? "" : "s"}${time ? ` · ${time}` : ""}`;
}

function StepIcon({ step }: { step: ExecutionStep }) {
  if (step.tool === "reason") return <Brain className="h-2.5 w-2.5" />;
  return <Wrench className="h-2.5 w-2.5" />;
}

function stepStatusStyle(status: ExecutionStatus): string {
  switch (status) {
    case "running":
      return "text-foreground bg-accent";
    case "done":
      return "text-emerald-600 bg-emerald-500/10";
    case "error":
      return "text-destructive bg-destructive/10";
    case "flagged":
    case "gate":
      return "text-amber-600 bg-amber-500/10";
    default:
      return "text-muted-foreground bg-muted";
  }
}

function TraceStepRow({ step, index }: { step: ExecutionStep; index: number }) {
  const cfg = stepStatusStyle(step.status);
  return (
    <div className="border-b border-border/30 py-1.5 last:border-b-0">
      <div className="flex items-start gap-1.5">
        <span className="mt-0.5 font-mono text-[8px] tabular-nums text-muted-foreground/70">{index}</span>
        <div className={cn("mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded", cfg)}>
          {step.status === "running" ? (
            <Loader2 className="h-2 w-2 animate-spin" />
          ) : step.status === "error" ? (
            <AlertCircle className="h-2 w-2" />
          ) : (
            <StepIcon step={step} />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[10px] font-medium text-foreground/90">{step.action}</div>
          {step.tool && step.tool !== "reason" && (
            <div className="font-mono text-[8px] text-muted-foreground/70">{step.tool}</div>
          )}
          {step.result && (
            <pre className="mt-0.5 max-h-24 overflow-auto whitespace-pre-wrap break-words font-mono text-[9px] text-muted-foreground">
              {step.result}
            </pre>
          )}
        </div>
        {step.durationMs != null && (
          <span className="shrink-0 font-mono text-[8px] tabular-nums text-muted-foreground">
            {step.durationMs < 1000 ? `${step.durationMs}ms` : `${(step.durationMs / 1000).toFixed(1)}s`}
          </span>
        )}
      </div>
    </div>
  );
}

export function RunTimeline({
  run,
  defaultExpanded,
}: {
  run: ChatRun;
  defaultExpanded?: boolean;
}) {
  const [open, setOpen] = React.useState(defaultExpanded ?? run.status === "running");
  const prevStatus = React.useRef(run.status);

  React.useEffect(() => {
    const wasLive = prevStatus.current === "running" || prevStatus.current === "analyzing";
    if (run.status === "running" || run.status === "analyzing") {
      setOpen(true);
    } else if (wasLive) {
      setOpen(false);
    }
    prevStatus.current = run.status;
  }, [run.status]);

  if (run.steps.length === 0 && run.status !== "running") return null;

  return (
    <div className="relative ml-0.5 border-l border-border/60 pl-2.5">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "group flex w-full items-center gap-2 border-b border-border/50 py-1 text-left transition-colors hover:bg-muted/20",
          open && "border-border/70",
        )}
      >
        <span className={cn("h-1 w-1 shrink-0 rounded-full", statusDot(run.status))} />
        <span className="min-w-0 flex-1 truncate text-[10px] text-muted-foreground group-hover:text-foreground">
          {runSummary(run)}
        </span>
        {(run.status === "running" || run.status === "analyzing") && (
          <Loader2 className="h-2.5 w-2.5 shrink-0 animate-spin text-foreground" />
        )}
        {open ? (
          <ChevronDown className="h-2.5 w-2.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-2.5 w-2.5 shrink-0 text-muted-foreground" />
        )}
      </button>

      {open && (
        <div className="space-y-0 py-1.5 pl-0.5">
          {run.steps.length === 0 ? (
            <div className="flex items-center gap-1.5 py-1 text-[10px] text-muted-foreground">
              <Loader2 className="h-2.5 w-2.5 animate-spin" />
              Starting…
            </div>
          ) : (
            run.steps.map((step, i) => <TraceStepRow key={step.id} step={step} index={i + 1} />)
          )}

          {run.analysis && <RunReviewPanel review={run.analysis} />}

          {run.analyzing && !run.analysis && (
            <div className="mt-1 flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <Loader2 className="h-2.5 w-2.5 animate-spin" />
              Reviewing run…
            </div>
          )}
        </div>
      )}
    </div>
  );
}
