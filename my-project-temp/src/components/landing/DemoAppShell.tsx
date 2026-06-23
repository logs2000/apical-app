"use client";

import * as React from "react";
import { ApicalWordmark } from "../apical/logo";
import { cn } from "@/lib/utils";
import {
  Boxes,
  KeyRound,
  Database,
  MoreHorizontal,
  Home,
  MessageSquare,
  Sparkles,
  Search,
  Plus,
  ArrowUp,
} from "lucide-react";

/**
 * DemoAppShell — a lightweight, self-contained look-alike of the Apical app
 * for the LANDING PAGE preview only. It is INTENTIONALLY distinct from the
 * real AppShell:
 *
 *   - NO API calls. All data is inline mock data. The preview never touches
 *     the database, so it can't break if the DB is down or unseeded.
 *   - NO auth. The preview shows a generic "Jordan" user, not the real session.
 *   - NO interactivity beyond tab switching + typing a message. Clicking tabs
 *     switches the mock view; typing + sending posts a canned reply. That's it.
 *   - A subtle "DEMO" watermark in the corner so it's clear this isn't the
 *     real app.
 *
 * The REAL app (launched via FullscreenApp after login) uses AppShell, which
 * wires to /api/* routes, persists to the DB, and is fully functional.
 *
 * Why separate them: previously both the landing preview and the real app
 * used <AppShell>, which meant (a) the landing page made real API calls that
 * could fail/hang, (b) the preview showed real (possibly empty) data instead
 * of curated demo data, and (c) there was no way to tell them apart. Now the
 * landing preview is a curated, always-works demo; the real app is the real
 * app.
 */

const DEMO_TABS = [
  { key: "agents", label: "Agents", icon: Boxes },
  { key: "vault", label: "Vault", icon: KeyRound },
  { key: "data", label: "Data", icon: Database },
] as const;

type DemoTab = (typeof DEMO_TABS)[number]["key"];

const DEMO_AGENTS = [
  { name: "Compass", department: "Filing", status: "active", flagged: 2, color: "bg-emerald-500" },
  { name: "Atlas", department: "Client", status: "active", flagged: 0, color: "bg-emerald-500" },
  { name: "Sentinel", department: "Dispatch", status: "active", flagged: 12, color: "bg-gate" },
  { name: "Tally", department: "Finance", status: "active", flagged: 5, color: "bg-gate" },
  { name: "Beacon", department: "Dispatch", status: "active", flagged: 0, color: "bg-emerald-500" },
  { name: "Scout", department: "Client", status: "paused", flagged: 0, color: "bg-muted-foreground" },
];

const DEMO_CHAT = [
  { role: "agent" as const, content: "Hi Jordan — I'm Compass, your filing agent. I've sorted 32 invoices into client folders this morning. 2 needed your attention." },
  { role: "user" as const, content: "Yes — create a folder for Acme Corp and file the one without a date under 'Unsorted'." },
  { role: "agent" as const, content: "Done. Created `/Clients/Acme Corp/` and filed 1 invoice there. Want me to set up a daily summary?" },
];

export function DemoAppShell() {
  const [tab, setTab] = React.useState<DemoTab>("agents");
  const [selectedAgent, setSelectedAgent] = React.useState(DEMO_AGENTS[0]);
  const [messages, setMessages] = React.useState(DEMO_CHAT);
  const [input, setInput] = React.useState("");
  const scrollRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  function send() {
    if (!input.trim()) return;
    const userMsg = { role: "user" as const, content: input.trim() };
    setMessages((m) => [...m, userMsg]);
    setInput("");
    // Canned reply — no API call.
    setTimeout(() => {
      setMessages((m) => [
        ...m,
        {
          role: "agent" as const,
          content: `Here's the plan I'm proposing:\n\n1. **Tool** — List everything in your /Scan Inbox\n2. **Reason** — Identify the client from the filename + OCR\n3. **Gate** — Confirm the move if it's a new client\n4. **Tool** — Move each file to /Clients/<name>/\n\nWant me to run this every 15 minutes?`,
        },
      ]);
    }, 800);
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
      {/* Top bar — tabs */}
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border bg-background/90 px-3 backdrop-blur-md">
        <ApicalWordmark className="mr-2" />
        <div className="flex items-center gap-0.5 rounded-lg border border-border bg-muted/40 p-0.5">
          {DEMO_TABS.map((t) => {
            const active = tab === t.key;
            const Icon = t.icon;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={cn(
                  "flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                  active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="h-3.5 w-3.5" /> {t.label}
              </button>
            );
          })}
        </div>
        <div className="ml-auto flex items-center gap-1">
          <button className="rounded-md p-1.5 text-muted-foreground hover:bg-accent/50 hover:text-foreground" title="Menu (demo)">
            <MoreHorizontal className="h-4 w-4" />
          </button>
          <button className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent/50 hover:text-foreground" title="Back to landing">
            <Home className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Home</span>
          </button>
        </div>
      </header>

      {/* Main content — only Agents view is interactive in the demo */}
      <main className="min-h-0 flex-1 overflow-hidden">
        {tab === "agents" && (
          <div className="flex h-full">
            {/* Left rail */}
            <aside className="hidden w-44 shrink-0 flex-col border-r border-border bg-muted/30 md:flex">
              <div className="border-b border-border p-2">
                <div className="flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1">
                  <Search className="h-3 w-3 text-muted-foreground" />
                  <span className="text-[10px] text-muted-foreground">Search</span>
                </div>
              </div>
              <div className="flex-1 space-y-1 overflow-y-auto p-2">
                <div className="px-1.5 pb-1 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">Apical</div>
                <div className="flex items-center gap-2 rounded-md bg-primary/10 px-2 py-1.5">
                  <Sparkles className="h-3.5 w-3.5 text-primary" />
                  <span className="text-[11px] font-medium">Apical</span>
                </div>
                <div className="mt-2 px-1.5 pb-1 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">Agents</div>
                {DEMO_AGENTS.map((a) => (
                  <button
                    key={a.name}
                    onClick={() => setSelectedAgent(a)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
                      selectedAgent.name === a.name ? "bg-primary/10" : "hover:bg-accent/50",
                    )}
                  >
                    <div className="relative shrink-0">
                      <div className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/20 text-[8px] font-semibold text-primary">
                        {a.name[0]}
                      </div>
                      <span className={cn("absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border border-muted/30", a.color)} />
                    </div>
                    <span className="truncate text-[11px]">{a.name}</span>
                    {a.flagged > 0 && (
                      <span className="ml-auto shrink-0 rounded bg-gate/15 px-1 text-[8px] font-semibold text-gate">{a.flagged}</span>
                    )}
                  </button>
                ))}
              </div>
            </aside>

            {/* Center — chat */}
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
                <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/20 text-[9px] font-semibold text-primary">
                  {selectedAgent.name[0]}
                </div>
                <span className="text-sm font-semibold">{selectedAgent.name}</span>
                <span className="text-[10px] text-muted-foreground">· {selectedAgent.department}</span>
              </div>
              <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
                {messages.map((m, i) => (
                  <div key={i}>
                    {m.role === "agent" && (
                      <div className="text-[10px] font-medium text-muted-foreground">{selectedAgent.name}</div>
                    )}
                    <div className={cn(
                      "text-xs",
                      m.role === "user" && "ml-auto max-w-[85%] rounded-md bg-muted px-2.5 py-1.5",
                    )}>
                      {m.content.split("\n").map((line, j) => (
                        <div key={j}>{line.replace(/\*\*/g, "")}</div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <div className="shrink-0 border-t border-border p-2.5">
                <div className="relative">
                  <textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        send();
                      }
                    }}
                    rows={1}
                    placeholder="Describe a job to hand off…"
                    className="min-h-[36px] w-full resize-none rounded-md border border-input bg-background px-2.5 py-1.5 pr-9 text-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40"
                  />
                  <button
                    onClick={send}
                    disabled={!input.trim()}
                    className="absolute bottom-1.5 right-1.5 flex h-6 w-6 items-center justify-center rounded-md bg-primary text-primary-foreground disabled:opacity-30"
                  >
                    <ArrowUp className="h-3 w-3" strokeWidth={2.5} />
                  </button>
                </div>
              </div>
            </div>

            {/* Right inspector — summarized, static */}
            <aside className="hidden w-52 shrink-0 flex-col overflow-y-auto border-l border-border bg-muted/30 lg:flex">
              <div className="space-y-2 p-2.5">
                <div className="rounded-md border border-border bg-card p-2">
                  <div className="flex items-center gap-1.5">
                    <span className={cn("h-1.5 w-1.5 rounded-full", selectedAgent.color)} />
                    <span className="text-[11px] font-semibold capitalize">{selectedAgent.status}</span>
                  </div>
                  <div className="mt-1 text-[9px] text-muted-foreground">every 15 min · {selectedAgent.department}</div>
                </div>
                {selectedAgent.flagged > 0 && (
                  <div className="rounded-md border-2 border-gate/50 bg-gate/10 p-2">
                    <div className="text-xs font-bold text-gate">{selectedAgent.flagged} flagged → review</div>
                  </div>
                )}
                <div className="rounded-md border border-border bg-card p-2">
                  <div className="mb-1 text-[9px] font-semibold uppercase text-muted-foreground">Workflow</div>
                  <div className="space-y-0.5 text-[10px]">
                    <div>1. List inbox</div>
                    <div>2. Identify client</div>
                    <div>3. Approve move</div>
                    <div>4. Move file</div>
                  </div>
                </div>
              </div>
            </aside>
          </div>
        )}
        {tab === "vault" && <DemoVaultPanel />}
        {tab === "data" && <DemoDataPanel />}
      </main>

      {/* DEMO watermark */}
      <div className="pointer-events-none absolute bottom-1 right-2 z-10 select-none text-[8px] font-medium uppercase tracking-widest text-muted-foreground/40">
        Demo
      </div>
    </div>
  );
}

function DemoVaultPanel() {
  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="mx-auto max-w-2xl space-y-2">
        <h2 className="text-sm font-semibold">Vault</h2>
        <p className="text-[11px] text-muted-foreground">OAuth connections, API keys, and MCP servers. (Demo — not interactive.)</p>
        {[
          { name: "Gmail", connected: true },
          { name: "Slack", connected: true },
          { name: "Stripe", connected: false },
          { name: "Notion", connected: false },
        ].map((c) => (
          <div key={c.name} className="flex items-center gap-2 rounded-md border border-border bg-card p-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-xs font-bold text-primary">{c.name[0]}</div>
            <span className="flex-1 text-xs">{c.name}</span>
            <span className={cn("text-[10px]", c.connected ? "text-emerald-500" : "text-muted-foreground")}>
              {c.connected ? "Connected" : "Not connected"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function DemoDataPanel() {
  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="mx-auto max-w-2xl space-y-2">
        <h2 className="text-sm font-semibold">Data</h2>
        <p className="text-[11px] text-muted-foreground">Tables + files your agents produce. (Demo — not interactive.)</p>
        <div className="rounded-md border border-border bg-card p-2.5">
          <div className="text-xs font-medium">Inbox triage</div>
          <div className="mt-1 text-[10px] text-muted-foreground">12 rows · last updated 15m ago</div>
        </div>
        <div className="rounded-md border border-border bg-card p-2.5">
          <div className="text-xs font-medium">Overdue invoices</div>
          <div className="mt-1 text-[10px] text-muted-foreground">3 rows · last updated 1h ago</div>
        </div>
      </div>
    </div>
  );
}
