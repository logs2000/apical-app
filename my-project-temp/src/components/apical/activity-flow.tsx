"use client";

import * as React from "react";
import {
  AlertCircle,
  Bell,
  Boxes,
  ChevronDown,
  ChevronRight,
  Database,
  FileText,
  Globe,
  KeyRound,
  Loader2,
  Save,
  Table,
  Terminal,
  Wrench,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ExecutionStep, PlanItem, RunAnalysis } from "@/lib/apical";
import { stepKind } from "@/lib/apical";
import { friendlyActionLabel } from "@/lib/apical/activity-labels";
import { AgentChecklist } from "./agent-checklist";
import { RunSupervisionPanel } from "./run-supervision-panel";

// ─── helpers ────────────────────────────────────────────────────────────────

function ToolIcon({ tool, className }: { tool?: string; className?: string }) {
  switch (tool) {
    case "web_search":
    case "web_read":
    case "http_request":
    case "http":
      return <Globe className={className} />;
    case "fs_list":
    case "fs_read":
    case "fs_write":
    case "fs_move":
    case "asset_save":
    case "doc_extract":
    case "pdf_form_fields":
    case "pdf_fill":
      return <FileText className={className} />;
    case "sheet_read":
    case "sheet_append":
      return <Table className={className} />;
    case "notify":
      return <Bell className={className} />;
    case "code_eval":
    case "script_run":
    case "cli_run":
      return <Terminal className={className} />;
    case "data_table_create":
    case "data_table_insert":
    case "data_table_query":
      return <Database className={className} />;
    case "credential_request":
    case "credential_list":
      return <KeyRound className={className} />;
    case "workflow_freeze":
    case "workflow_update":
    case "workflow_step_append":
    case "workflow_step_patch":
    case "workflow_improve":
    case "schedule_agent":
      return <Save className={className} />;
    case "agent_create":
    case "agent_list":
      return <Boxes className={className} />;
    default:
      return <Wrench className={className} />;
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return "1s";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem ? `${m}m ${rem}s` : `${m}m`;
}

type Segment =
  | { type: "thoughts"; steps: ExecutionStep[] }
  | { type: "action"; step: ExecutionStep };

function buildSegments(steps: ExecutionStep[]): Segment[] {
  const out: Segment[] = [];
  for (const step of steps) {
    if (stepKind(step) === "thought") {
      const last = out[out.length - 1];
      if (last && last.type === "thoughts") last.steps.push(step);
      else out.push({ type: "thoughts", steps: [step] });
    } else {
      out.push({ type: "action", step });
    }
  }
  return out;
}

// ─── thought group ───────────────────────────────────────────────────────────

function ThoughtGroup({ steps }: { steps: ExecutionStep[] }) {
  const isStreaming = steps.some((s) => s.status === "running");
  const [open, setOpen] = React.useState(false);

  const text = steps
    .map((s) => (s.result || s.action || "").trim())
    .filter(Boolean)
    .join("\n\n");
  const totalMs = steps.reduce((sum, s) => sum + (s.durationMs ?? 0), 0);

  if (isStreaming) {
    return (
      <div className="space-y-1">
        <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <span className="animate-pulse">Thinking</span>
        </div>
        {text && (
          <p className="whitespace-pre-wrap pl-0.5 text-xs italic leading-relaxed text-muted-foreground/80">
            {text}
          </p>
        )}
      </div>
    );
  }

  if (!text) return null;

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        {open ? (
          <ChevronDown className="h-3 w-3 shrink-0" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0" />
        )}
        <span>Thought{totalMs > 0 ? ` for ${formatDuration(totalMs)}` : ""}</span>
      </button>
      {open && (
        <p className="mt-1 whitespace-pre-wrap pl-4 text-xs italic leading-relaxed text-muted-foreground/80">
          {text}
        </p>
      )}
    </div>
  );
}

// ─── action row ───────────────────────────────────────────────────────────────

function ActionRow({
  step,
  onOpenProgressPanel,
}: {
  step: ExecutionStep;
  onOpenProgressPanel?: (stepId: string) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const phase = step.status === "running" ? "running" : step.status === "error" ? "error" : "done";
  const label = friendlyActionLabel(step.tool ?? "", step.toolInput, phase);
  const isError = step.status === "error";
  const hasDetail = !!step.result;

  return (
    <div>
      <button
        type="button"
        onClick={() => hasDetail && setOpen((o) => !o)}
        className={cn(
          "flex w-full items-center gap-1.5 text-left text-xs",
          isError ? "text-destructive" : "text-muted-foreground",
          hasDetail && "transition-colors hover:text-foreground",
        )}
      >
        {step.status === "running" ? (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-foreground" />
        ) : isError ? (
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
        ) : (
          <ToolIcon tool={step.tool} className="h-3.5 w-3.5 shrink-0" />
        )}
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {step.durationMs != null && step.status !== "running" && (
          <span className="shrink-0 tabular-nums text-[11px] text-muted-foreground/70">
            {formatDuration(step.durationMs)}
          </span>
        )}
        {hasDetail &&
          (open ? (
            <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground/70" />
          ) : (
            <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/70" />
          ))}
      </button>

      {isError && step.result && (
        <p className="mt-0.5 pl-5 text-[11px] text-destructive/90">{step.result}</p>
      )}

      {open && hasDetail && !isError && (
        <div className="mt-1 space-y-1.5 pl-5">
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/50 p-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
            {step.result}
          </pre>
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground/70">
            {step.tool && <span className="font-mono">{step.tool}</span>}
            {onOpenProgressPanel && (
              <button
                type="button"
                onClick={() => onOpenProgressPanel(step.id)}
                className="ml-auto rounded px-1.5 py-0.5 text-[11px] text-foreground/80 transition-colors hover:bg-muted hover:text-foreground"
              >
                Open in Progress panel
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── main ─────────────────────────────────────────────────────────────────────

export function ActivityFlow({
  steps,
  plan,
  liveStatus,
  isStreaming,
  analysis,
  analyzing,
  stopped,
  startedAt,
  onOpenProgressPanel,
}: {
  steps: ExecutionStep[];
  plan?: PlanItem[];
  liveStatus?: string;
  isStreaming: boolean;
  analysis?: RunAnalysis;
  analyzing?: boolean;
  stopped?: boolean;
  startedAt?: string;
  onOpenProgressPanel?: (stepId: string) => void;
}) {
  const segments = React.useMemo(() => buildSegments(steps), [steps]);
  const hasPlan = !!plan && plan.length > 0;
  const toolCount = steps.filter((s) => stepKind(s) === "tool").length;

  // Long-run collapse toggle. Streaming always expanded.
  const isLong = !isStreaming && segments.length > 8;
  const [longOpen, setLongOpen] = React.useState(false);

  // Simple-question suppression: a finished, tool-less turn with no plan and no
  // review shows no activity scaffolding at all — just the answer above.
  const finishedToolLess =
    !isStreaming &&
    !hasPlan &&
    !analysis &&
    !analyzing &&
    steps.every((s) => stepKind(s) === "thought");
  if (finishedToolLess) return null;

  const hasRunning = steps.some((s) => s.status === "running");
  const showLiveStatus = isStreaming && !hasRunning && segments.length === 0;

  const body = (
    <div className="space-y-2">
      {hasPlan && <AgentChecklist items={plan!} />}

      {segments.map((seg, i) =>
        seg.type === "thoughts" ? (
          <ThoughtGroup key={`t${i}`} steps={seg.steps} />
        ) : (
          <ActionRow key={seg.step.id} step={seg.step} onOpenProgressPanel={onOpenProgressPanel} />
        ),
      )}

      {showLiveStatus && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-foreground" />
          <span>{liveStatus ?? "Getting started…"}</span>
        </div>
      )}

      {analysis && <RunSupervisionPanel data={analysis} />}

      {analyzing && !analysis && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
          <span>Checking the result…</span>
        </div>
      )}
    </div>
  );

  if (isLong) {
    const durationMs =
      startedAt && steps.length > 0
        ? Math.max(
            0,
            new Date(steps[steps.length - 1].timestamp).getTime() - new Date(startedAt).getTime(),
          )
        : 0;
    const verb = stopped ? "Stopped after" : "Worked for";
    const summary = `${verb} ${formatDuration(durationMs || 1000)} · ${toolCount} action${toolCount === 1 ? "" : "s"}`;
    return (
      <div className="select-none">
        <button
          type="button"
          onClick={() => setLongOpen((o) => !o)}
          className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          {longOpen ? (
            <ChevronDown className="h-3 w-3 shrink-0" />
          ) : (
            <ChevronRight className="h-3 w-3 shrink-0" />
          )}
          <span>{summary}</span>
        </button>
        {longOpen && <div className="mt-2">{body}</div>}
      </div>
    );
  }

  return <div className="select-none">{body}</div>;
}
