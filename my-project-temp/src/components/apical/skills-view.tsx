"use client";

import * as React from "react";
import { Wand2, Loader2, Archive, ChevronDown, Hash } from "lucide-react";
import { cn } from "@/lib/utils";

interface SkillListItem {
  id: string;
  name: string;
  title: string;
  description: string;
  version: number;
  status: string;
  timesUsed: number;
  paramsSchema: { properties?: Record<string, unknown>; required?: string[] };
  docs: string | null;
}

interface SkillDetail extends SkillListItem {
  spec: Array<{ id: string; kind: string; label: string }>;
  versions: Array<{ number: number; author: string; note: string | null; createdAt: string }>;
}

export function SkillsView() {
  const [skills, setSkills] = React.useState<SkillListItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [expanded, setExpanded] = React.useState<string | null>(null);
  const [detail, setDetail] = React.useState<Record<string, SkillDetail>>({});

  const load = React.useCallback(async () => {
    const data = await fetch("/api/skills")
      .then((r) => (r.ok ? (r.json() as Promise<{ skills?: SkillListItem[] }>) : null))
      .catch(() => null);
    if (data?.skills) setSkills(data.skills);
    setLoading(false);
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function toggle(id: string) {
    if (expanded === id) {
      setExpanded(null);
      return;
    }
    setExpanded(id);
    if (!detail[id]) {
      const d = await fetch(`/api/skills/${id}`).then((r) => (r.ok ? (r.json() as Promise<SkillDetail>) : null)).catch(() => null);
      if (d) setDetail((prev) => ({ ...prev, [id]: d }));
    }
  }

  async function archive(id: string) {
    await fetch(`/api/skills/${id}`, { method: "DELETE" }).catch(() => {});
    void load();
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <div className="mb-4 flex items-center gap-2">
        <Wand2 className="h-5 w-5 text-primary" />
        <div>
          <h1 className="text-lg font-semibold">Skills</h1>
          <p className="text-xs text-muted-foreground">
            Reusable, parameterized capabilities your agents build and reuse. Workflows can invoke them; freezing skill-using work composes them.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading skills…
        </div>
      ) : skills.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
          No skills yet. When an agent does novel multi-step work, it can save it as a skill so the next time is a single call.
        </div>
      ) : (
        <div className="space-y-2">
          {skills.map((s) => {
            const params = Object.keys(s.paramsSchema?.properties ?? {});
            const open = expanded === s.id;
            const d = detail[s.id];
            return (
              <div key={s.id} className="rounded-lg border border-border bg-card">
                <button type="button" onClick={() => void toggle(s.id)} className="flex w-full items-start gap-3 p-3 text-left">
                  <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                    <Wand2 className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-sm font-medium">{s.title}</span>
                      <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">{s.name}</span>
                      <span className="text-[10px] text-muted-foreground">v{s.version}</span>
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-[12px] text-foreground/80">{s.description}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
                      {params.length > 0 && <span>params: {params.join(", ")}</span>}
                      <span>·</span>
                      <span>used {s.timesUsed}×</span>
                    </div>
                  </div>
                  <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
                </button>
                {open && (
                  <div className="border-t border-border px-3 py-2.5 text-[12px]">
                    {!d ? (
                      <div className="flex items-center gap-1.5 text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Loading…</div>
                    ) : (
                      <>
                        {d.docs && <p className="mb-2 whitespace-pre-wrap text-foreground/80">{d.docs}</p>}
                        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Steps ({d.spec.length})</div>
                        <ol className="mb-2 space-y-0.5">
                          {d.spec.map((step, i) => (
                            <li key={step.id} className="flex items-center gap-2 text-muted-foreground">
                              <span className="font-mono text-[9px]">{i + 1}</span>
                              <span className="rounded bg-muted px-1 text-[9px]">{step.kind}</span>
                              {step.label}
                            </li>
                          ))}
                        </ol>
                        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Versions</div>
                        <div className="flex flex-wrap gap-1.5">
                          {d.versions.map((v) => (
                            <span key={v.number} className="flex items-center gap-0.5 rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                              <Hash className="h-2.5 w-2.5" />{v.number} · {v.author}
                            </span>
                          ))}
                        </div>
                        <div className="mt-2">
                          <button type="button" onClick={() => void archive(s.id)} className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-destructive">
                            <Archive className="h-3 w-3" /> Archive
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
