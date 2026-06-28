"use client";

import { CheckCircle2, Circle, Loader2, ListChecks } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PlanItem } from "@/lib/apical";

/**
 * The agent's live checklist (from the update_plan tool). Items tick from
 * pending → in_progress → done as the agent works through the task.
 */
export function AgentChecklist({ items }: { items: PlanItem[] }) {
  if (!items || items.length === 0) return null;
  const done = items.filter((i) => i.status === "done").length;

  return (
    <div className="mt-1.5 rounded-md border border-border bg-muted/50 p-2.5 text-xs">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="flex items-center gap-1.5 font-medium text-foreground">
          <ListChecks className="h-3.5 w-3.5 text-brand" />
          Plan
        </span>
        <span className="text-[10px] text-muted-foreground">
          {done}/{items.length} done
        </span>
      </div>
      <ul className="space-y-1">
        {items.map((item) => (
          <li key={item.id} className="flex items-start gap-1.5">
            {item.status === "done" ? (
              <CheckCircle2 className="mt-[1px] h-3.5 w-3.5 shrink-0 text-emerald-500" />
            ) : item.status === "in_progress" ? (
              <Loader2 className="mt-[1px] h-3.5 w-3.5 shrink-0 animate-spin text-brand" />
            ) : (
              <Circle className="mt-[1px] h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
            )}
            <span
              className={cn(
                "leading-snug",
                item.status === "done"
                  ? "text-muted-foreground line-through"
                  : item.status === "in_progress"
                    ? "font-medium text-foreground"
                    : "text-foreground/80",
              )}
            >
              {item.label}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
