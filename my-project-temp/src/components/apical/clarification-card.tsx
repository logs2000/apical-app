"use client";

import * as React from "react";
import { HelpCircle, Check, ShieldAlert, Pencil, ArrowUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ClarificationRequestInfo } from "@/lib/apical";

/**
 * An interactive card from the agent — either a clarifying question
 * (ask_clarification) or an approval gate before a high-stakes action
 * (request_review, kind="review"). The user clicks an option, types a custom
 * answer, or both (in multi-select); the answer is sent back to the agent as
 * the next message so it can resume with the decision.
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
  const [freeTextOpen, setFreeTextOpen] = React.useState(false);
  const [freeText, setFreeText] = React.useState("");
  const [submittedAnswer, setSubmittedAnswer] = React.useState<string | null>(null);
  const multiple = !!request.multiple;
  const isReview = request.kind === "review";
  // Free text on by default (also for older persisted requests without the flag),
  // except approval gates, which are click-only decisions.
  const allowFreeText = !isReview && request.allowFreeText !== false;
  // A question with fewer than 2 options is a pure fill-in-the-blank prompt.
  const fillInTheBlank = allowFreeText && request.options.length < 2;

  function commit(text: string) {
    if (answered || !text.trim()) return;
    setSubmittedAnswer(text);
    onAnswer(text);
  }

  function toggle(key: string) {
    if (answered) return;
    if (!multiple) {
      const opt = request.options.find((o) => o.key === key);
      commit(opt?.label ?? key);
      setSelected([key]);
      return;
    }
    setSelected((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  }

  function submitMultiple() {
    if (answered) return;
    const labels = selected.map((k) => request.options.find((o) => o.key === k)?.label ?? k);
    if (freeText.trim()) labels.push(freeText.trim());
    if (labels.length === 0) return;
    commit(labels.join(", "));
  }

  const showAnswered = answered || submittedAnswer;

  return (
    <div
      className={cn(
        "mt-2 rounded-md border p-3 text-sm",
        isReview ? "border-amber-500/40 bg-amber-500/5" : "border-border bg-muted",
      )}
    >
      {isReview && (
        <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-500">
          <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
          Approval needed
        </div>
      )}
      <div className="mb-2 flex items-start gap-1.5 font-medium text-foreground">
        {!isReview && <HelpCircle className="mt-[2px] h-4 w-4 shrink-0 text-brand" />}
        <span>{request.question}</span>
      </div>

      {/* Clickable options */}
      {request.options.length > 0 && (
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
                  "flex w-full items-start gap-2 rounded-md border px-2.5 py-1.5 text-left text-xs transition-colors",
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
                    <span className="block text-[11px] text-muted-foreground">{opt.description}</span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Free-text input — always available unless it's an approval gate. */}
      {allowFreeText && !answered && (fillInTheBlank || freeTextOpen ? (
        <div className={cn("flex items-center gap-1.5", request.options.length > 0 && "mt-2")}>
          <input
            type="text"
            autoFocus={!fillInTheBlank}
            value={freeText}
            onChange={(e) => setFreeText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !multiple) {
                e.preventDefault();
                commit(freeText);
              }
            }}
            placeholder={request.freeTextPlaceholder ?? "Type your answer…"}
            className="h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2.5 text-xs text-foreground outline-none focus:border-brand"
          />
          {!multiple && (
            <Button
              type="button"
              size="icon"
              className="h-8 w-8 shrink-0"
              disabled={!freeText.trim()}
              onClick={() => commit(freeText)}
            >
              <ArrowUp className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setFreeTextOpen(true)}
          className="mt-2 flex items-center gap-1.5 rounded-md border border-dashed border-border bg-background px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
        >
          <Pencil className="h-3 w-3" />
          Other…
        </button>
      ))}

      {/* Multi-select send */}
      {multiple && !answered && (
        <div className="mt-2.5 flex justify-end">
          <Button
            type="button"
            size="sm"
            className="h-7 px-3 text-[11px]"
            disabled={selected.length === 0 && !freeText.trim()}
            onClick={submitMultiple}
          >
            Send{selected.length > 0 ? ` (${selected.length})` : ""}
          </Button>
        </div>
      )}

      {showAnswered && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          {submittedAnswer ? (
            <>
              {isReview ? "Decision" : "Answered"}:{" "}
              <span className="text-foreground">{submittedAnswer}</span>
            </>
          ) : isReview ? (
            "Decision sent."
          ) : (
            "Answer sent."
          )}
        </p>
      )}
    </div>
  );
}
