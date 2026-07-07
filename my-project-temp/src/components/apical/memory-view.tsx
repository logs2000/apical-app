"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import {
  Brain,
  Boxes,
  Heart,
  AlertCircle,
  TrendingUp,
  Info,
  Loader2,
  Trash2,
} from "lucide-react";

// Memory is now backed by real data (MemoryEntry) — auto-extracted from turns
// on Apical's own models and injected into the agent's context.

type MemoryKind = "entity" | "preference" | "correction" | "pattern" | "fact";

interface MemoryEntry {
  id: string;
  kind: MemoryKind;
  subject: string | null;
  content: string;
  confidence: number; // 0–1
  timesReinforced: number;
  sourceKind: string;
  agentId: string | null;
  updatedAt: string;
}

const KIND_META: Record<
  MemoryKind,
  { label: string; icon: React.ComponentType<{ className?: string }>; color: string; blurb: string }
> = {
  correction: { label: "Corrections", icon: AlertCircle, color: "text-destructive", blurb: "Things you corrected — these override older assumptions." },
  preference: { label: "Preferences", icon: Heart, color: "text-rose-500", blurb: "How you like work done." },
  entity: { label: "Entities", icon: Boxes, color: "text-primary", blurb: "People, clients, and accounts you work with." },
  fact: { label: "Facts", icon: Info, color: "text-sky-500", blurb: "Durable facts about you and your work." },
  pattern: { label: "Patterns", icon: TrendingUp, color: "text-emerald-500", blurb: "Recurring behaviors worth remembering." },
};

const KIND_ORDER: MemoryKind[] = ["correction", "preference", "entity", "fact", "pattern"];

export function MemoryView() {
  const [entries, setEntries] = React.useState<MemoryEntry[]>([]);
  const [loading, setLoading] = React.useState(true);

  const load = React.useCallback(async () => {
    const data = await fetch("/api/memory")
      .then((r) => (r.ok ? (r.json() as Promise<{ entries?: MemoryEntry[] }>) : null))
      .catch(() => null);
    if (data?.entries) setEntries(data.entries);
    setLoading(false);
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function archive(id: string) {
    setEntries((prev) => prev.filter((e) => e.id !== id));
    await fetch(`/api/memory/${id}`, { method: "DELETE" }).catch(() => {});
  }

  const byKind = (k: MemoryKind) => entries.filter((e) => e.kind === k);

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <div className="mb-4 flex items-center gap-2">
        <Brain className="h-5 w-5 text-primary" />
        <div>
          <h1 className="text-lg font-semibold">Memory</h1>
          <p className="text-xs text-muted-foreground">
            What your agents have learned about you and your work — auto-extracted from conversations and injected into their context. Corrections outrank preferences.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading memory…
        </div>
      ) : entries.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
          Nothing remembered yet. As you work with agents, durable facts, preferences, and corrections are learned and shown here.
        </div>
      ) : (
        <div className="space-y-5">
          {KIND_ORDER.map((kind) => {
            const list = byKind(kind);
            if (list.length === 0) return null;
            const meta = KIND_META[kind];
            const Icon = meta.icon;
            return (
              <section key={kind}>
                <div className="mb-1.5 flex items-center gap-1.5">
                  <Icon className={cn("h-3.5 w-3.5", meta.color)} />
                  <span className="text-xs font-semibold">{meta.label}</span>
                  <span className="text-[10px] text-muted-foreground">· {meta.blurb}</span>
                </div>
                <div className="space-y-1.5">
                  {list.map((e) => (
                    <div key={e.id} className="group flex items-start gap-2 rounded-lg border border-border bg-card px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <div className="text-[13px] text-foreground/90">
                          {e.subject && <span className="mr-1 rounded bg-muted px-1 font-mono text-[10px] text-muted-foreground">{e.subject}</span>}
                          {e.content}
                        </div>
                        <div className="mt-0.5 flex items-center gap-2 text-[10px] text-muted-foreground">
                          <span>confidence {Math.round(e.confidence * 100)}%</span>
                          {e.timesReinforced > 1 && (
                            <>
                              <span>·</span>
                              <span>reinforced {e.timesReinforced}×</span>
                            </>
                          )}
                          <span>·</span>
                          <span>{e.sourceKind}</span>
                        </div>
                        {/* Confidence meter doubles as the "hardening" indicator. */}
                        <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted">
                          <div className={cn("h-full", e.confidence > 0.8 ? "bg-emerald-500" : "bg-primary")} style={{ width: `${Math.round(e.confidence * 100)}%` }} />
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => void archive(e.id)}
                        className="shrink-0 rounded p-1 text-muted-foreground opacity-0 transition hover:text-destructive group-hover:opacity-100"
                        title="Forget"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
