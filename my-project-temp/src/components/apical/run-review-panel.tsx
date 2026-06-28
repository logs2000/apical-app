"use client";

import { AlertCircle, CheckCircle2, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RunAnalysis } from "@/lib/apical";
import type { RunReview } from "@/lib/types";

type ReviewLike = RunAnalysis | RunReview;

export function RunReviewPanel({ review }: { review: ReviewLike }) {
  const outcomeOk = review.outcomeAchieved ?? review.success;

  return (
    <div
      className={cn(
        "mt-1.5 rounded border px-2 py-1.5 text-[10px]",
        outcomeOk
          ? "border-border bg-muted"
          : "border-amber-500/30 bg-amber-500/5",
      )}
    >
      <div className="flex items-center gap-1 font-medium">
        {outcomeOk ? (
          <CheckCircle2 className="h-3 w-3 text-emerald-600" />
        ) : (
          <AlertCircle className="h-3 w-3 text-amber-600" />
        )}
        <Sparkles className="h-2.5 w-2.5 text-muted-foreground" />
        <span>{outcomeOk ? "Outcome achieved" : "Review: needs attention"}</span>
      </div>
      <p className="mt-0.5 text-muted-foreground">{review.summary}</p>
      {review.efficiencyNotes && (
        <p className="mt-1 text-muted-foreground">
          <span className="font-medium text-foreground/80">Efficiency: </span>
          {review.efficiencyNotes}
        </p>
      )}
      {review.workflowSuggestions && review.workflowSuggestions.length > 0 && (
        <ul className="mt-1 list-inside list-disc space-y-0.5 text-muted-foreground">
          {review.workflowSuggestions.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
