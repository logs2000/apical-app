"use client";

import { Activity } from "lucide-react";
import { RunLog } from "./workflow-runs-console";

/** Global activity / run log — same auditable RunLog used everywhere. */
export function ActivityView() {
  return (
    <div className="h-full min-h-0 overflow-y-auto overscroll-contain">
      <div className="mx-auto max-w-3xl px-4 py-5 md:px-6">
        <div className="mb-4">
          <h1 className="flex items-center gap-2 text-base font-semibold tracking-tight">
            <Activity className="h-4 w-4 text-muted-foreground" /> Activity
          </h1>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Every workflow run — filter, sort, and expand any entry for the full step trace,
            agent review, and audit metadata.
          </p>
        </div>
        <RunLog variant="full" limit={100} showFilters className="border-0 bg-transparent shadow-none" />
      </div>
    </div>
  );
}
