"use client";

import { AlertCircle, CheckCircle2, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RunAnalysis } from "@/lib/apical";
import type { RunReview, RunSupervision, SupervisionOutcome } from "@/lib/types";

type PanelInput = RunSupervision | RunReview | RunAnalysis;

interface Normalized {
  outcome: SupervisionOutcome;
  summary: string;
  attempts: RunSupervision["attempts"];
}

/** Legacy RunReview / chat RunAnalysis rows map onto the supervision shape. */
function normalize(data: PanelInput): Normalized {
  if ("outcome" in data && Array.isArray((data as RunSupervision).attempts)) {
    const s = data as RunSupervision;
    return { outcome: s.outcome, summary: s.summary, attempts: s.attempts };
  }
  const legacy = data as RunReview | RunAnalysis;
  const ok = (legacy.outcomeAchieved ?? legacy.success) === true;
  return {
    outcome: ok ? "passed" : "failed",
    summary: legacy.summary,
    attempts: [],
  };
}

const OUTCOME_LABEL: Record<SupervisionOutcome, string> = {
  passed: "Completed",
  recovered: "Recovered after auto-fix",
  failed: "Failed after retries",
};

export function RunSupervisionPanel({ data }: { data: PanelInput }) {
  const { outcome, summary, attempts } = normalize(data);
  const ok = outcome === "passed" || outcome === "recovered";

  return (
    <div
      className={cn(
        "mt-1.5 rounded border px-2 py-1.5 text-[10px]",
        ok ? "border-border bg-muted" : "border-amber-500/30 bg-amber-500/5",
      )}
    >
      <div className="flex items-center gap-1 font-medium">
        {ok ? (
          <CheckCircle2 className="h-3 w-3 text-emerald-600" />
        ) : (
          <AlertCircle className="h-3 w-3 text-amber-600" />
        )}
        {outcome === "recovered" && <Wrench className="h-2.5 w-2.5 text-muted-foreground" />}
        <span>{OUTCOME_LABEL[outcome]}</span>
      </div>
      <p className="mt-0.5 text-muted-foreground">{summary}</p>
      {attempts.length > 0 && (
        <ul className="mt-1 space-y-1">
          {attempts.map((a) => (
            <li key={a.attempt} className="text-muted-foreground">
              <span className="font-medium text-foreground/80">
                Attempt {a.attempt} · {a.result}:{" "}
              </span>
              {a.diagnosis}
              {a.actions.length > 0 && (
                <span className="text-muted-foreground/80"> — {a.actions.join(", ")}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
