"use client";

import * as React from "react";
import { ApicalWordmark, ApicalMark } from "../apical/logo";
import { cn } from "@/lib/utils";
import {
  Boxes,
  KeyRound,
  Database,
  MoreHorizontal,
  Home,
  Sparkles,
  Search,
  Plus,
  ArrowUp,
  X,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  Activity,
  Lock,
  Cloud,
  Monitor,
} from "lucide-react";

/**
 * DemoAppShell — a 1:1 visual replica of the real Apical AppShell + AgentsView,
 * for the LANDING PAGE preview only.
 *
 * It mirrors the real layout exactly (three-pane: left rail, center tab bar +
 * chat, right inspector) so visitors see what they'll get. BUT:
 *
 *   - NO API calls. All data is inline mock data.
 *   - NO persistence. Refreshing resets the demo.
 *   - Download gates: when the user tries to actually USE something (send a
 *     message, switch to Dashboard/Workflow/Config, open a second tab, etc.),
 *     a "Download to continue" gate appears instead of the real action.
 *   - A subtle "DEMO" badge in the top-right corner so it's clearly not the
 *     real app.
 *
 * The REAL app (FullscreenApp → AppShell → AgentsView) is fully functional
 * with real APIs, persistence, and no gates.
 */

const DEMO_TABS = [
  { key: "agents", label: "Agents", icon: Boxes },
  { key: "vault", label: "Vault", icon: KeyRound },
  { key: "data", label: "Data", icon: Database },
] as const;
type DemoTab = (typeof DEMO_TABS)[number]["key"];

const DEMO_AGENTS = [
  { id: "a1", name: "Compass", department: "Filing", status: "active", flagged: 2, color: "bg-emerald-500", runtime: "local" as const },
  { id: "a2", name: "Atlas", department: "Client", status: "active", flagged: 0, color: "bg-emerald-500", runtime: "hosted" as const },
  { id: "a3", name: "Sentinel", department: "Dispatch", status: "active", flagged: 12, color: "bg-gate", runtime: "hosted" as const },
  { id: "a4", name: "Tally", department: "Finance", status: "active", flagged: 5, color: "bg-gate", runtime: "hosted" as const },
  { id: "a5", name: "Beacon", department: "Dispatch", status: "active", flagged: 0, color: "bg-emerald-500", runtime: "hosted" as const },
  { id: "a6", name: "Scout", department: "Client", status: "paused", flagged: 0, color: "bg-muted-foreground", runtime: "hosted" as const },
];

const DEMO_CHAT: Array<{ role: "user" | "agent"; content: string }> = [
  { role: "agent", content: "Hi Jordan — I'm Compass, your filing agent. I've sorted 32 invoices into client folders this morning. 2 needed your attention (new client: Acme Corp, missing date on a receipt). Want me to handle them?" },
  { role: "user", content: "Yes — create a folder for Acme Corp and file the one without a date under 'Unsorted'." },
  { role: "agent", content: "Done. Created `/Clients/Acme Corp/` and filed 1 invoice there. The undated one is in `/Clients/_Unsorted/`. I'll OCR it again tonight to try to recover the date." },
];

const DOWNLOAD_MSG = "This is a live preview. Download Apical to actually run agents, save workflows, and connect your tools.";

export function DemoAppShell() {
  const [tab, setTab] = React.useState<DemoTab>("agents");
  const [selectedAgent, setSelectedAgent] = React.useState(DEMO_AGENTS[0]);
  const [messages, setMessages] = React.useState(DEMO_CHAT);
  const [input, setInput] = React.useState("");
  const [gate, setGate] = React.useState<string | null>(null);
  const [openTabs, setOpenTabs] = React.useState<string[]>(["apical", "a1"]);
  const [activeTab, setActiveTab] = React.useState("a1");
  const scrollRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, gate]);

  function showGate(msg: string) {
    setGate(msg);
    setTimeout(() => setGate(null), 3500);
  }

  function send() {
    if (!input.trim()) return;
    showGate(DOWNLOAD_MSG);
    setInput("");
  }

  function pickAgent(id: string) {
    const a = DEMO_AGENTS.find((x) => x.id === id);
    if (!a) return;
    setSelectedAgent(a);
    setActiveTab(id);
    if (!openTabs.includes(id)) {
      setOpenTabs([...openTabs, id]);
    }
    // Reset to the demo chat for this agent.
    setMessages(DEMO_CHAT);
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-background text-foreground">
      {/* Top bar — tabs (mirrors real AppShell) */}
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
          <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-primary">Demo</span>
          <button className="rounded-md p-1.5 text-muted-foreground hover:bg-accent/50 hover:text-foreground" title="Menu">
            <MoreHorizontal className="h-4 w-4" />
          </button>
          <button className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent/50 hover:text-foreground" title="Back to landing">
            <Home className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Home</span>
          </button>
        </div>
      </header>

      {/* Main content */}
      <main className="min-h-0 flex-1 overflow-hidden">
        {tab === "agents" && (
          <div className="flex h-full">
            {/* Left rail — mirrors real AgentNavigator */}
            <aside className="hidden w-48 shrink-0 flex-col border-r border-border bg-muted/30 md:flex">
              <div className="border-b border-border p-2.5">
                <div className="flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1">
                  <Search className="h-3 w-3 text-muted-foreground" />
                  <input
                    placeholder="Search agents"
                    className="flex-1 bg-transparent text-[11px] placeholder:text-muted-foreground focus:outline-none"
                    onChange={() => showGate(DOWNLOAD_MSG)}
                  />
                </div>
                <button
                  onClick={() => showGate(DOWNLOAD_MSG)}
                  className="mt-1.5 flex w-full items-center justify-start gap-1.5 rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent/50"
                >
                  <Plus className="h-3 w-3" /> New agent
                </button>
              </div>
              <div className="flex-1 space-y-3 overflow-y-auto p-2">
                <div>
                  <div className="px-1.5 pb-1 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">Apical</div>
                  <button
                    onClick={() => { setActiveTab("apical"); if (!openTabs.includes("apical")) setOpenTabs([...openTabs, "apical"]); }}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
                      activeTab === "apical" ? "bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                    )}
                  >
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary/15 text-primary">
                      <Sparkles className="h-3.5 w-3.5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[11px] font-medium">Apical</div>
                      <div className="truncate text-[9px] text-muted-foreground">General · all agents</div>
                    </div>
                  </button>
                </div>
                <div>
                  <div className="px-1.5 pb-1 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">Agents</div>
                  <div className="space-y-0.5">
                    {DEMO_AGENTS.map((a) => (
                      <button
                        key={a.id}
                        onClick={() => pickAgent(a.id)}
                        className={cn(
                          "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
                          activeTab === a.id ? "bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                        )}
                      >
                        <div className="relative shrink-0">
                          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/20 text-[9px] font-semibold text-primary">
                            {a.name[0]}
                          </div>
                          <span className={cn("absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-muted/30", a.color)} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1">
                            <span className="truncate text-[11px] font-medium">{a.name}</span>
                            {a.flagged > 0 && (
                              <span className="shrink-0 rounded border border-gate/40 bg-gate/10 px-1 text-[8px] font-semibold text-gate">{a.flagged}</span>
                            )}
                          </div>
                          <div className="truncate text-[9px] text-muted-foreground">{a.department}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </aside>

            {/* Center — chat only (no tab bar; D/W/C live in the right rail) */}
            <div className="flex min-w-0 flex-1 flex-col">
              {/* Center pane header — agent identity only, no mode tabs */}
              <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3">
                {activeTab === "apical" ? (
                  <div className="flex items-center gap-2">
                    <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/15 text-primary">
                      <Sparkles className="h-4 w-4" />
                    </div>
                    <div>
                      <div className="text-sm font-semibold">Apical</div>
                      <div className="text-[10px] text-muted-foreground">General · context to all agents</div>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/20 text-[10px] font-semibold text-primary">
                      {selectedAgent.name[0]}
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-semibold">{selectedAgent.name}</span>
                        <span className={cn(
                          "rounded border px-1 py-0.5 text-[9px] font-medium",
                          selectedAgent.runtime === "local"
                            ? "border-primary/30 bg-primary/10 text-primary"
                            : "border-border bg-muted text-muted-foreground",
                        )}>
                          {selectedAgent.runtime === "local" ? "Local" : "Hosted"}
                        </span>
                      </div>
                      <div className="text-[10px] text-muted-foreground">{selectedAgent.department}</div>
                    </div>
                  </div>
                )}
              </div>

              {/* Chat area */}
              <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
                {activeTab === "apical" && (
                  <div className="space-y-1">
                    <div className="text-[10px] font-medium text-muted-foreground">Apical</div>
                    <div className="text-sm text-foreground">
                      Good afternoon, Jordan.{"\n\n"}**19 items need your review** across your agents:{"\n"}• Sentinel (Dispatch) — 12 flagged{"\n"}• Tally (Finance) — 5 flagged{"\n"}• Compass (Filing) — 2 flagged{"\n\n"}While you were gone (6h), 4 agents ran:{"\n"}• Compass — 8,472 items processed{"\n"}• Atlas — 312 items{"\n"}• Sentinel — 534 items{"\n"}• Tally — 487 items{"\n\n"}What would you like to do?
                    </div>
                  </div>
                )}
                {activeTab !== "apical" && messages.map((m, i) => (
                  <div key={i}>
                    {m.role === "agent" && (
                      <div className="text-[10px] font-medium text-muted-foreground">{selectedAgent.name}</div>
                    )}
                    {m.role === "user" ? (
                      <div className="flex justify-end">
                        <div className="max-w-[85%] space-y-1">
                          <div className="rounded-md bg-[oklch(0.42_0.025_155)] px-3 py-2 text-sm text-white">
                            {m.content}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="text-sm text-foreground whitespace-pre-wrap">{m.content}</div>
                    )}
                  </div>
                ))}
                {gate && (
                  <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-xs text-primary">
                    <div className="flex items-start gap-2">
                      <ApicalMark className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <div>
                        <div className="font-medium">{gate}</div>
                        <button className="mt-1.5 rounded-md bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground hover:opacity-90">
                          Download Apical
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Composer */}
              <div className="shrink-0 border-t border-border bg-background p-3">
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
                    rows={2}
                    placeholder={activeTab === "apical" ? "Ask about your agents, coordinate a task…" : "Describe a job to hand off…"}
                    className="min-h-[44px] w-full resize-none rounded-md border border-input bg-background pr-12 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40"
                  />
                  <button
                    onClick={send}
                    disabled={!input.trim()}
                    className="absolute bottom-2 right-2 flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground transition hover:opacity-90 disabled:opacity-30"
                    aria-label="Send"
                  >
                    <ArrowUp className="h-4 w-4" strokeWidth={2.5} />
                  </button>
                </div>
                <p className="mt-1.5 text-[10px] text-muted-foreground">Press Enter to send, Shift+Enter for newline</p>
              </div>
            </div>

            {/* Right inspector — mirrors real InspectorPane. Houses Overview/Dashboard/Workflow/Config as section tabs. */}
            {activeTab !== "apical" && (
              <aside className="hidden w-72 shrink-0 flex-col overflow-hidden border-l border-border bg-muted/30 lg:flex">
                {/* Section tabs — Overview / Dashboard / Workflow / Config */}
                <div className="flex shrink-0 items-center gap-0.5 border-b border-border bg-background/50 p-1">
                  {(["overview", "dashboard", "workflow", "config"] as const).map((s) => (
                    <button
                      key={s}
                      onClick={() => s !== "overview" && showGate(`${s.charAt(0).toUpperCase() + s.slice(1)} view is available in the full app. Download Apical.`)}
                      className={cn(
                        "flex-1 rounded-md px-2 py-1 text-[10px] font-medium capitalize transition-colors",
                        s === "overview" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent/40 hover:text-foreground",
                      )}
                    >
                      {s}
                    </button>
                  ))}
                </div>
                <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
                  <div className="rounded-lg border border-border bg-card p-3">
                    <div className="mb-2 flex items-center gap-2">
                      <span className={cn("h-2 w-2 rounded-full", selectedAgent.color)} />
                      <span className="text-xs font-semibold capitalize">{selectedAgent.status}</span>
                      <span className={cn(
                        "rounded border px-1 py-0.5 text-[9px] font-medium",
                        selectedAgent.runtime === "local"
                          ? "border-primary/30 bg-primary/10 text-primary"
                          : "border-border bg-muted text-muted-foreground",
                      )}>
                        {selectedAgent.runtime === "local" ? "Local" : "Hosted"}
                      </span>
                    </div>
                    <div className="text-[10px] text-muted-foreground">every 15 min · {selectedAgent.department}</div>
                    <div className="mt-1 text-[10px] text-muted-foreground">1,284 runs · 8,472 items</div>
                  </div>
                  {selectedAgent.flagged > 0 && (
                    <button
                      onClick={() => showGate("Reviewing flagged items is available in the full app. Download Apical.")}
                      className="flex w-full items-center gap-2 rounded-lg border-2 border-gate/50 bg-gate/10 p-3 text-left transition-colors hover:border-gate hover:bg-gate/15"
                    >
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-gate/20 text-gate">
                        <AlertTriangle className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-bold text-gate">{selectedAgent.flagged} flagged → review</div>
                        <div className="text-[10px] text-gate/80">Human-in-the-loop items need your call</div>
                      </div>
                    </button>
                  )}
                  <div className="rounded-lg border border-border bg-card p-3">
                    <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Workflow</div>
                    <div className="space-y-1 text-[10px]">
                      <div className="flex items-center gap-1.5"><span className="font-mono text-[9px]">1</span><span>List inbox</span></div>
                      <div className="flex items-center gap-1.5"><span className="font-mono text-[9px]">2</span><span>Identify client</span></div>
                      <div className="flex items-center gap-1.5"><span className="font-mono text-[9px]">3</span><span>Approve move</span></div>
                      <div className="flex items-center gap-1.5"><span className="font-mono text-[9px]">4</span><Lock className="h-2 w-2 text-hardened" /><span>Move file</span></div>
                    </div>
                  </div>
                  <div className="rounded-lg border border-border bg-card p-3">
                    <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Stats</div>
                    <div className="grid grid-cols-2 gap-2 text-[10px]">
                      <div><div className="text-muted-foreground">Processed</div><div className="font-semibold tabular-nums">8,472</div></div>
                      <div><div className="text-muted-foreground">Automatic</div><div className="font-semibold tabular-nums">96%</div></div>
                      <div><div className="text-muted-foreground">Flagged</div><div className="font-semibold tabular-nums text-gate">{selectedAgent.flagged}</div></div>
                      <div><div className="text-muted-foreground">Runs</div><div className="font-semibold tabular-nums">1,284</div></div>
                    </div>
                  </div>
                </div>
              </aside>
            )}
          </div>
        )}
        {tab === "vault" && <DemoVaultPanel onGate={() => showGate("Managing connections is available in the full app. Download Apical.")} />}
        {tab === "data" && <DemoDataPanel onGate={() => showGate("Working with data tables is available in the full app. Download Apical.")} />}
      </main>

      {/* Gate toast (top-center) */}
      {gate && (
        <div className="pointer-events-none absolute left-1/2 top-14 z-50 -translate-x-1/2">
          {/* The gate is rendered inline in the chat area instead; this is a fallback */}
        </div>
      )}
    </div>
  );
}

function DemoVaultPanel({ onGate }: { onGate: () => void }) {
  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="mx-auto max-w-2xl space-y-2">
        <h2 className="text-sm font-semibold">Connections</h2>
        <p className="text-[11px] text-muted-foreground">OAuth integrations. Apical stores tokens encrypted — you can revoke any time.</p>
        {[
          { name: "Gmail", cat: "Email", connected: true },
          { name: "Slack", cat: "Comms", connected: true },
          { name: "Google Drive", cat: "Files", connected: true },
          { name: "Notion", cat: "Docs", connected: false },
          { name: "GitHub", cat: "Dev", connected: false },
          { name: "Stripe", cat: "Payments", connected: false },
        ].map((c) => (
          <div key={c.name} className="flex items-center gap-3 rounded-lg border border-border bg-card p-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-sm font-bold text-primary">{c.name[0]}</div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-sm font-medium">{c.name}</span>
                <span className="text-[9px] uppercase tracking-wide text-muted-foreground">{c.cat}</span>
              </div>
              <div className="truncate text-[10px] text-muted-foreground">{c.connected ? "Connected · active" : "Not connected"}</div>
            </div>
            <button
              onClick={onGate}
              className={cn(
                "rounded-md px-2.5 py-1 text-[11px] font-medium",
                c.connected ? "text-muted-foreground hover:bg-accent/50" : "border border-border hover:border-primary/30",
              )}
            >
              {c.connected ? "Disconnect" : "Connect"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function DemoDataPanel({ onGate }: { onGate: () => void }) {
  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="mx-auto max-w-2xl space-y-2">
        <h2 className="text-sm font-semibold">Data</h2>
        <p className="text-[11px] text-muted-foreground">Tables + files your agents produce.</p>
        {[
          { name: "Inbox triage", rows: 12, when: "15m ago" },
          { name: "Overdue invoices", rows: 3, when: "1h ago" },
          { name: "Competitor pricing", rows: 8, when: "6h ago" },
        ].map((t) => (
          <button
            key={t.name}
            onClick={onGate}
            className="flex w-full items-center gap-3 rounded-lg border border-border bg-card p-3 text-left hover:border-primary/30"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary">
              <Database className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">{t.name}</div>
              <div className="text-[10px] text-muted-foreground">{t.rows} rows · last updated {t.when}</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
