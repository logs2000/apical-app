"use client";

import * as React from "react";
import { HelpCircle, Check, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ClarificationRequestInfo } from "@/lib/apical";

/**
 * A multiple-choice card from the agent — either a clarifying question
 * (ask_clarification) or an approval gate before a high-stakes action
 * (request_review, kind="review"). The user clicks one (or several, if
 * multiple) options; the selection is sent back to the agent as the next
 * message so it can resume with the answer / decision.
 */
export function ClarificationCard({
  request,
  answered,
  onAnswer,
}: {
  request: ClarificationRequestInfo;
  answered?: boolean;
  onAnswer: (text: string) => void;
}) {
  const [selected, setSelected] = React.useState<string[]>([]);
  const multiple = !!request.multiple;
  const isReview = request.kind === "review";

  function toggle(key: string) {
    if (answered) return;
    if (!multiple) {
      const opt = request.options.find((o) => o.key === key);
      onAnswer(opt?.label ?? key);
      setSelected([key]);
      return;
    }
    setSelected((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  }

  function submitMultiple() {
    if (answered || selected.length === 0) return;
    const labels = selected
      .map((k) => request.options.find((o) => o.key === k)?.label ?? k)
      .join(", ");
    onAnswer(labels);
  }

  return (
    <div
      className={cn(
        "mt-2 rounded-md border p-3 text-xs",
        isReview ? "border-amber-500/40 bg-amber-500/5" : "border-border bg-muted",
      )}
    >
      {isReview && (
        <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-500">
          <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
          Approval needed
        </div>
      )}
      <div className="mb-2 flex items-start gap-1.5 font-medium text-foreground">
        {!isReview && <HelpCircle className="mt-[1px] h-3.5 w-3.5 shrink-0 text-brand" />}
        <span>{request.question}</span>
      </div>
      <div className="space-y-1.5">
        {request.options.map((opt) => {
          const isSelected = selected.includes(opt.key);
          return (
            <button
              key={opt.key}
              type="button"
              disabled={answered}
              onClick={() => toggle(opt.key)}
              className={cn(
                "flex w-full items-start gap-2 rounded-md border px-2.5 py-1.5 text-left transition-colors",
                isSelected
                  ? "border-brand bg-brand/10"
                  : "border-border bg-background hover:border-foreground/30 hover:bg-accent",
                answered && "cursor-not-allowed opacity-60",
              )}
            >
              <span
                className={cn(
                  "mt-[1px] flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border",
                  isSelected ? "border-brand bg-brand text-white" : "border-muted-foreground/40",
                )}
              >
                {isSelected && <Check className="h-2.5 w-2.5" />}
              </span>
              <span className="leading-snug">
                <span className="font-medium text-foreground">{opt.label}</span>
                {opt.description && (
                  <span className="block text-[10px] text-muted-foreground">
                    {opt.description}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>
      {multiple && !answered && (
        <div className="mt-2.5 flex justify-end">
          <Button
            type="button"
            size="sm"
            className="h-7 px-3 text-[11px]"
            disabled={selected.length === 0}
            onClick={submitMultiple}
          >
            Send {selected.length > 0 ? `(${selected.length})` : ""}
          </Button>
        </div>
      )}
      {answered && (
        <p className="mt-2 text-[10px] text-muted-foreground">
          {isReview ? "Decision sent." : "Answer sent."}
        </p>
      )}
    </div>
  );
}
