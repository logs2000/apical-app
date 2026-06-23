"use client";

import * as React from "react";
import { useAppStore } from "@/lib/apical/store";
import {
  DEMO_WORKFLOWS,
  agentInitials,
  agentAvatarLightness,
  relativeTime,
  formatDuration,
  STEP_KIND_META,
  type Workflow,
  type AgentRuntime,
} from '@/lib/apical';
import { RuntimeBadge } from "./logo";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Boxes,
  Plus,
  ArrowLeft,
  Brain,
  Wrench,
  ShieldCheck,
  Lock,
  ChevronRight,
  Activity,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Play,
  Pause,
  MessageSquare,
  PanelRightOpen,
  PanelRightClose,
  Loader2,
  Check,
  Save,
  Cloud,
  Monitor,
} from "lucide-react";

function agentStatus(agent: Workflow): { color: string; label: string } {
  if (agent.status === "paused") return { color: "bg-muted-foreground", label: "Paused" };
  if (agent.flaggedCount > 0) return { color: "bg-gate", label: "Flagged" };
  return { color: "bg-emerald-500", label: "Active" };
}

export function AgentsTab() {
  const selectedId = useAppStore((s) => s.selectedWorkflowId);
  const selectWorkflow = useAppStore((s) => s.selectWorkflow);
  const setMode = useAppStore((s) => s.setMode);

  if (selectedId) {
    const agent = DEMO_WORKFLOWS.find((w) => w.id === selectedId);
    if (agent) {
      return <AgentDetail agent={agent} onBack={() => selectWorkflow(null)} />;
    }
  }

  return (
    <div className="h-full min-h-0 overflow-y-auto overscroll-contain">
      <div className="mx-auto max-w-3xl px-4 py-5 md:px-6">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h1 className="flex items-center gap-2 text-base font-semibold tracking-tight">
              <Boxes className="h-4 w-4 text-muted-foreground" /> Agents
            </h1>
            <p className="text-[11px] text-muted-foreground">
              Your AI agents. Click one to see its dashboard, workflow, and config — or chat with it.
            </p>
          </div>
          <Button size="sm" className="gap-1.5" onClick={() => setMode("chat")}>
            <Plus className="h-3 w-3" /> Hire an agent
          </Button>
        </div>

        <div className="space-y-1.5">
          {DEMO_WORKFLOWS.map((agent) => (
            <AgentRow
              key={agent.id}
              agent={agent}
              onPick={() => selectWorkflow(agent.id)}
            />
          ))}
        </div>

        {DEMO_WORKFLOWS.length === 0 && (
          <div className="rounded-xl border border-dashed border-border p-8 text-center">
            <Boxes className="mx-auto mb-2 h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm font-medium">No agents yet.</p>
            <p className="mt-1 text-xs text-muted-foreground">Tell the assistant what you need done.</p>
            <Button size="sm" className="mt-3" onClick={() => setMode("chat")}>
              <Plus className="mr-1 h-3 w-3" /> Create an agent
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function AgentRow({ agent, onPick }: { agent: Workflow; onPick: () => void }) {
  const status = agentStatus(agent);
  const hasHardened = agent.steps.steps.some((s) => s.hardened);

  return (
    <button
      onClick={onPick}
      className="flex w-full items-center gap-3 rounded-xl border border-border bg-card p-3 text-left transition-colors hover:border-primary/30"
    >
      <div className="relative shrink-0">
        <div
          className="flex h-10 w-10 items-center justify-center rounded-full text-xs font-semibold text-primary-foreground"
          style={{ backgroundColor: `oklch(${agentAvatarLightness(agent.name)} 0.06 155)` }}
        >
          {agentInitials(agent.name)}
        </div>
        <span
          className={cn("absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-card", status.color)}
          title={status.label}
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium">{agent.name}</span>
          {hasHardened && <span className="text-[10px] text-hardened">★</span>}
          <RuntimeBadge runtime={agent.runtime} />
          <span className="text-[10px] text-muted-foreground">{status.label}</span>
        </div>
        <div className="truncate text-[11px] text-muted-foreground">
          {agent.title ?? "Agent"} · {agent.department}
          {agent.schedule ? ` · ${agent.schedule}` : " · manual"}
        </div>
        <div className="mt-0.5 truncate text-[10px] text-muted-foreground/70">
          {agent.runsCount} runs · {agent.itemsProcessed.toLocaleString()} items processed
        </div>
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
    </button>
  );
}

// ─── Agent detail ───────────────────────────────────────────────────────────

function AgentDetail({ agent, onBack }: { agent: Workflow; onBack: () => void }) {
  const [tab, setTab] = React.useState<"dashboard" | "workflow" | "config">("dashboard");
  const [showConversation, setShowConversation] = React.useState(false);

  return (
    <div className="flex h-full">
      {/* Main column */}
      <div className="flex h-full min-w-0 flex-1 flex-col">
        <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Agents
          </button>
          <div className="ml-2 flex items-center gap-2">
            <div
              className="flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-semibold text-primary-foreground"
              style={{ backgroundColor: `oklch(${agentAvatarLightness(agent.name)} 0.06 155)` }}
            >
              {agentInitials(agent.name)}
            </div>
            <span className="text-sm font-semibold">{agent.name}</span>
            <RuntimeBadge runtime={agent.runtime} />
          </div>
          <div className="ml-auto flex items-center gap-1">
            {(["dashboard", "workflow", "config"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-[11px] font-medium capitalize transition-colors",
                  tab === t ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t}
              </button>
            ))}
            {/* Collapsible conversation side-tab toggle */}
            <button
              onClick={() => setShowConversation((v) => !v)}
              className={cn(
                "ml-1 flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors",
                showConversation ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground",
              )}
              title="Toggle conversation panel"
            >
              {showConversation ? <PanelRightClose className="h-3.5 w-3.5" /> : <PanelRightOpen className="h-3.5 w-3.5" />}
              <span className="hidden sm:inline">Chat</span>
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
          {tab === "dashboard" && <AgentDashboard agent={agent} />}
          {tab === "workflow" && <AgentWorkflow agent={agent} />}
          {tab === "config" && <AgentConfig agent={agent} />}
        </div>
      </div>

      {/* Collapsible conversation side-tab */}
      {showConversation && <ConversationPanel agent={agent} onClose={() => setShowConversation(false)} />}
    </div>
  );
}

// ─── Conversation side panel ────────────────────────────────────────────────

interface AgentMessage {
  id: string;
  role: "user" | "agent";
  content: string;
  createdAt: string;
}

function ConversationPanel({ agent, onClose }: { agent: Workflow; onClose: () => void }) {
  const [messages, setMessages] = React.useState<AgentMessage[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [input, setInput] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/agents/${agent.id}/messages`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setMessages(data.messages || []);
    } catch (err) {
      // Likely no agent row in DB yet (demo workflow) — show empty state.
      setMessages([]);
      setError(null);
    } finally {
      setLoading(false);
    }
  }, [agent.id]);

  React.useEffect(() => {
    void load();
  }, [load]);

  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  async function send() {
    if (!input.trim() || sending) return;
    const userMsg: AgentMessage = {
      id: Math.random().toString(36).slice(2),
      role: "user",
      content: input.trim(),
      createdAt: new Date().toISOString(),
    };
    setMessages((m) => [...m, userMsg]);
    setInput("");
    setSending(true);
    try {
      const res = await fetch(`/api/agents/${agent.id}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userMsg.content }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.reply) {
        setMessages((m) => [
          ...m,
          {
            id: Math.random().toString(36).slice(2),
            role: "agent",
            content: data.reply,
            createdAt: new Date().toISOString(),
          },
        ]);
      }
    } catch (err) {
      // Surface a friendly error in the chat thread.
      setMessages((m) => [
        ...m,
        {
          id: Math.random().toString(36).slice(2),
          role: "agent",
          content: `(Couldn't reach ${agent.name} right now — ${(err as Error).message})`,
          createdAt: new Date().toISOString(),
        },
      ]);
    } finally {
      setSending(false);
    }
  }

  return (
    <aside className="flex h-full w-72 shrink-0 flex-col border-l border-border bg-muted/30 lg:w-96">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
        <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-medium">Conversation with {agent.name}</span>
        <button
          onClick={onClose}
          className="ml-auto rounded-md p-1 text-muted-foreground hover:bg-accent/50 hover:text-foreground"
          title="Close panel"
        >
          <PanelRightClose className="h-3.5 w-3.5" />
        </button>
      </div>
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-3">
        {loading ? (
          <div className="flex items-center justify-center py-8 text-xs text-muted-foreground">
            <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Loading…
          </div>
        ) : messages.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-4 text-center text-[11px] text-muted-foreground">
            <MessageSquare className="mx-auto mb-1.5 h-5 w-5 text-muted-foreground/50" />
            No messages yet. Say hello to {agent.name}.
          </div>
        ) : (
          messages.map((m) => <MessageBubble key={m.id} message={m} agentName={agent.name} />)
        )}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
        className="shrink-0 border-t border-border bg-background p-2.5"
      >
        <div className="relative">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            rows={2}
            placeholder={`Message ${agent.name}…`}
            className="min-h-[40px] resize-none border border-input bg-background pr-10 text-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40"
          />
          <button
            type="submit"
            disabled={!input.trim() || sending}
            className="absolute bottom-2 right-2 flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground transition hover:opacity-90 disabled:opacity-30"
            aria-label="Send"
          >
            {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowLeft className="h-3.5 w-3.5 rotate-90" strokeWidth={2.5} />}
          </button>
        </div>
        <p className="mt-1 text-[9px] text-muted-foreground">Enter to send · Shift+Enter for newline</p>
      </form>
    </aside>
  );
}

function MessageBubble({ message, agentName }: { message: AgentMessage; agentName: string }) {
  const isUser = message.role === "user";
  return (
    <div className={cn("flex gap-2", isUser && "flex-row-reverse")}>
      <div
        className={cn(
          "flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[10px] font-semibold",
          isUser ? "bg-muted text-muted-foreground" : "bg-primary/15 text-primary",
        )}
      >
        {isUser ? "Y" : agentInitials(agentName)}
      </div>
      <div
        className={cn(
          "max-w-[80%] rounded-lg px-2.5 py-1.5 text-[11px]",
          isUser ? "bg-primary text-primary-foreground" : "bg-card border border-border",
        )}
      >
        <p className="whitespace-pre-wrap">{message.content}</p>
        <div className={cn("mt-1 text-[9px]", isUser ? "text-primary-foreground/70" : "text-muted-foreground")}>
          {new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </div>
      </div>
    </div>
  );
}

// ─── Agent dashboard ────────────────────────────────────────────────────────

function AgentDashboard({ agent }: { agent: Workflow }) {
  const autoPct = Math.round((agent.automaticCount / Math.max(agent.itemsProcessed, 1)) * 100);
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      {/* Stat grid — NOTE: "Costs saved" removed per user request */}
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
        <StatCard label="Items processed" value={agent.itemsProcessed.toLocaleString()} icon={Activity} accent="bg-primary/10 text-primary" />
        <StatCard label="Automatic" value={`${autoPct}%`} icon={CheckCircle2} accent="bg-emerald-500/10 text-emerald-500" />
        <StatCard label="Flagged" value={agent.flaggedCount.toLocaleString()} icon={AlertTriangle} accent="bg-gate/15 text-gate" />
      </div>

      {/* Description */}
      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">About</h3>
        <p className="mt-1.5 text-sm">{agent.description}</p>
        <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-3">
          <Meta label="Department" value={agent.department} />
          <Meta label="Title" value={agent.title ?? "—"} />
          <Meta label="Trigger" value={agent.trigger === "schedule" ? `Schedule · ${agent.schedule}` : "Manual"} />
        </div>
      </div>

      {/* Recent runs (mocked) */}
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <Activity className="h-3.5 w-3.5" /> Recent runs
          </h3>
          <span className="text-[10px] text-muted-foreground">{agent.runsCount} total</span>
        </div>
        <div className="space-y-1.5">
          {[
            { status: "completed" as const, items: 32, auto: 30, flagged: 2, when: "15m ago", dur: 4200 },
            { status: "completed" as const, items: 18, auto: 18, flagged: 0, when: "30m ago", dur: 2100 },
            { status: "running" as const, items: 12, auto: 11, flagged: 1, when: "now", dur: 0 },
            { status: "failed" as const, items: 0, auto: 0, flagged: 0, when: "1h ago", dur: 120 },
            { status: "completed" as const, items: 45, auto: 44, flagged: 1, when: "2h ago", dur: 5800 },
          ].map((r, i) => (
            <div key={i} className="flex items-center gap-3 rounded-md border border-transparent px-2 py-1.5 hover:border-border hover:bg-accent/30">
              <div
                className={cn(
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-md",
                  r.status === "completed" && "bg-emerald-500/10 text-emerald-500",
                  r.status === "running" && "bg-primary/10 text-primary",
                  r.status === "failed" && "bg-destructive/10 text-destructive",
                )}
              >
                {r.status === "completed" ? (
                  <CheckCircle2 className="h-3.5 w-3.5" />
                ) : r.status === "running" ? (
                  <Clock className="h-3.5 w-3.5" />
                ) : (
                  <AlertTriangle className="h-3.5 w-3.5" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-medium capitalize">{r.status}</div>
                <div className="text-[10px] text-muted-foreground">
                  {r.items} items · {r.auto} auto · {r.flagged} flagged
                </div>
              </div>
              <div className="text-right">
                <div className="text-[10px] text-muted-foreground">{r.when}</div>
                <div className="text-[9px] font-mono text-muted-foreground/70">
                  {r.dur > 0 ? formatDuration(r.dur) : "—"}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function AgentWorkflow({ agent }: { agent: Workflow }) {
  return (
    <div className="mx-auto max-w-2xl space-y-2">
      <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {agent.steps.steps.length} steps
      </div>
      {agent.steps.steps.map((step, i) => {
        const Icon = step.hardened ? Lock : step.kind === "reason" ? Brain : step.kind === "gate" ? ShieldCheck : Wrench;
        const meta = STEP_KIND_META[step.kind];
        const colorClass = step.hardened
          ? "border-hardened/40 bg-hardened/10 text-hardened"
          : step.kind === "reason"
            ? "border-reason/30 bg-reason/10 text-reason"
            : step.kind === "gate"
              ? "border-gate/40 bg-gate/10 text-gate"
              : "border-border bg-tool text-tool-foreground";
        return (
          <div key={step.id} className="relative rounded-xl border border-border bg-card p-3">
            <div className="flex items-start gap-3">
              <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border font-mono text-xs font-semibold", colorClass)}>
                {i + 1}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Icon className={cn("h-3.5 w-3.5", step.hardened ? "text-hardened" : step.kind === "reason" ? "text-reason" : step.kind === "gate" ? "text-gate" : "text-tool-foreground")} />
                  <span className="text-sm font-medium">{step.label}</span>
                  {step.hardened && (
                    <span className="rounded bg-hardened/15 px-1 py-0.5 text-[9px] font-medium text-hardened">
                      Hardened
                    </span>
                  )}
                </div>
                <div className="mt-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                  {meta.label}
                  {step.tool && ` · ${step.tool}`}
                </div>
                {step.prompt && (
                  <p className="mt-1.5 rounded bg-muted/40 p-2 text-[11px] text-muted-foreground">
                    {step.prompt}
                  </p>
                )}
                {step.note && <div className="mt-1 text-[10px] text-hardened">{step.note}</div>}
              </div>
            </div>
            {i < agent.steps.steps.length - 1 && (
              <div className="ml-[18px] mt-1 h-3 w-px bg-border" />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Agent config (full-featured + editable) ────────────────────────────────

function AgentConfig({ agent }: { agent: Workflow }) {
  const [name, setName] = React.useState(agent.name);
  const [department, setDepartment] = React.useState(agent.department);
  const [title, setTitle] = React.useState(agent.title ?? "");
  const [description, setDescription] = React.useState(agent.description);
  const [trigger, setTrigger] = React.useState<"manual" | "schedule">(agent.trigger);
  const [schedule, setSchedule] = React.useState(agent.schedule ?? "");
  const [runtime, setRuntime] = React.useState<AgentRuntime>(agent.runtime);
  const [modelPref, setModelPref] = React.useState("default");
  const [confidenceThreshold, setConfidenceThreshold] = React.useState("0.85");
  const [autoHardenAfter, setAutoHardenAfter] = React.useState("50");
  const [saving, setSaving] = React.useState(false);
  const [savedAt, setSavedAt] = React.useState<Date | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/workflows/${agent.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          department: department.trim(),
          title: title.trim() || null,
          description,
          trigger,
          schedule: trigger === "schedule" ? schedule.trim() || null : null,
          runtime,
          modelPreference: modelPref === "default" ? null : modelPref,
          confidenceThreshold: parseFloat(confidenceThreshold) || null,
          autoHardenAfter: parseInt(autoHardenAfter, 10) || null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setSavedAt(new Date());
    } catch (err) {
      // Likely a demo workflow that doesn't exist in the DB — surface a
      // friendly message instead of crashing.
      setError(err instanceof Error ? err.message : "Failed to save (this demo agent isn't in the DB yet).");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-3">
      {/* Identity */}
      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Identity</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} className="h-9 text-sm" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} className="h-9 text-sm" placeholder="e.g. Sorter" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Department</Label>
            <Input value={department} onChange={(e) => setDepartment(e.target.value)} className="h-9 text-sm" />
          </div>
        </div>
        <div className="mt-3 space-y-1.5">
          <Label className="text-xs">Description</Label>
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className="text-sm" />
        </div>
      </div>

      {/* Runtime + schedule */}
      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Runtime &amp; schedule</h3>
        {/* Runtime toggle: local vs hosted */}
        <div className="space-y-1.5">
          <Label className="text-xs">Where this agent runs</Label>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setRuntime("local")}
              className={cn(
                "rounded-lg border p-3 text-left transition",
                runtime === "local" ? "border-primary/50 bg-primary/5" : "border-border hover:border-border/80",
              )}
            >
              <div className="flex items-center gap-2">
                <Monitor className={cn("h-4 w-4", runtime === "local" ? "text-primary" : "text-muted-foreground")} />
                <span className="text-xs font-semibold">Local (desktop)</span>
                {runtime === "local" && <Check className="ml-auto h-3 w-3 text-primary" />}
              </div>
              <div className="mt-1 text-[10px] text-muted-foreground">
                Runs on your machine via the Tauri shell. Filesystem + shell access. Private.
              </div>
            </button>
            <button
              onClick={() => setRuntime("hosted")}
              className={cn(
                "rounded-lg border p-3 text-left transition",
                runtime === "hosted" ? "border-primary/50 bg-primary/5" : "border-border hover:border-border/80",
              )}
            >
              <div className="flex items-center gap-2">
                <Cloud className={cn("h-4 w-4", runtime === "hosted" ? "text-primary" : "text-muted-foreground")} />
                <span className="text-xs font-semibold">Hosted (cloud)</span>
                {runtime === "hosted" && <Check className="ml-auto h-3 w-3 text-primary" />}
              </div>
              <div className="mt-1 text-[10px] text-muted-foreground">
                Runs on Apical servers. Always-on, even when your desktop is offline.
              </div>
            </button>
          </div>
        </div>
        {/* Trigger + schedule */}
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Trigger</Label>
            <select
              value={trigger}
              onChange={(e) => setTrigger(e.target.value as "manual" | "schedule")}
              className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
            >
              <option value="manual">Manual</option>
              <option value="schedule">Schedule</option>
            </select>
          </div>
          {trigger === "schedule" && (
            <div className="space-y-1.5">
              <Label className="text-xs">Schedule (human-readable)</Label>
              <Input
                value={schedule}
                onChange={(e) => setSchedule(e.target.value)}
                className="h-9 text-sm"
                placeholder="every 15 min · daily 9am · weekly Mon"
              />
            </div>
          )}
        </div>
      </div>

      {/* Model + learning config */}
      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Model &amp; learning</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Model preference</Label>
            <select
              value={modelPref}
              onChange={(e) => setModelPref(e.target.value)}
              className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
            >
              <option value="default">Default (Apical-managed)</option>
              <option value="fast">Fast</option>
              <option value="thinking">Thinking</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Confidence threshold</Label>
            <Input
              value={confidenceThreshold}
              onChange={(e) => setConfidenceThreshold(e.target.value)}
              className="h-9 text-sm"
              placeholder="0.85"
              inputMode="decimal"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Auto-harden after (runs)</Label>
            <Input
              value={autoHardenAfter}
              onChange={(e) => setAutoHardenAfter(e.target.value)}
              className="h-9 text-sm"
              placeholder="50"
              inputMode="numeric"
            />
          </div>
        </div>
        <p className="mt-2 text-[10px] text-muted-foreground">
          Reason steps that exceed the confidence threshold auto-resolve. After N consistent runs, a reason step hardens into a fast tool step.
        </p>
      </div>

      {/* Save bar */}
      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2.5 text-xs text-destructive">
          {error}
        </div>
      )}
      {savedAt && !error && (
        <div className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-2.5 text-xs text-emerald-600">
          <Check className="h-3.5 w-3.5" /> Saved at {savedAt.toLocaleTimeString()}
        </div>
      )}
      <div className="flex items-center justify-between gap-2">
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="gap-1.5">
            {agent.status === "paused" ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
            {agent.status === "paused" ? "Resume" : "Pause"}
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5">
            <Activity className="h-3 w-3" /> Run now
          </Button>
        </div>
        <Button size="sm" className="gap-1.5" onClick={save} disabled={saving}>
          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />} Save changes
        </Button>
      </div>
    </div>
  );
}

// ─── Primitives ─────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  icon: Icon,
  accent,
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  accent: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
          <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
        </div>
        <div className={cn("flex h-7 w-7 items-center justify-center rounded-md", accent)}>
          <Icon className="h-3.5 w-3.5" />
        </div>
      </div>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-xs font-medium">{value}</div>
    </div>
  );
}

void relativeTime;
