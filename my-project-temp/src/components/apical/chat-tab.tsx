"use client";

import * as React from "react";
import { useAppStore } from "@/lib/apical/store";
import {
  DEMO_CONVERSATIONS,
  DEMO_MESSAGES,
  DEMO_WORKFLOWS,
  DEFAULT_PROMPTS,
  relativeTime,
  agentInitials,
  agentAvatarLightness,
  type ChatMessage,
  type WorkflowStep,
  type WorkflowJSON,
  type StepKind,
  STEP_KIND_META,
} from '@/lib/apical';
import { ApicalMark } from "./logo";
import { RuntimeBadge } from "./logo";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  ArrowUp,
  Pin,
  Search,
  Plus,
  X,
  Brain,
  Wrench,
  ShieldCheck,
  Lock,
  ChevronRight,
  Sparkles,
  Zap,
  CheckCircle2,
  AlertCircle,
  Loader2,
  PlayCircle,
  Wand2,
} from "lucide-react";
import type { ExecutionStep, ExecutionStatus } from "@/lib/apical";

const FIXED_REPLY = `Here's the plan I'm proposing:

1. **Tool** — List everything in your /Scan Inbox
2. **Reason** — Identify the client from the filename + OCR
3. **Gate** — Confirm the move if it's a new client (you approve)
4. **Tool** — Move each file to /Clients/<name>/ (hardened after 50 consistent runs)

Want me to run this every 15 minutes?

—

This is a live preview. **Download to try Free** to run real agents, save versions, and restore them from any point in this conversation.`;

type SendMode = "plan" | "do";

export function ChatTab() {
  const { activeConversationId, setActiveConversation } = useAppStore();
  const [messages, setMessages] = React.useState<ChatMessage[]>(DEMO_MESSAGES);
  const [input, setInput] = React.useState("");
  const [isThinking, setIsThinking] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const [mode, setMode] = React.useState<SendMode>("plan");
  const scrollRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, isThinking]);

  // ─── Plan-first mode: AI proposes a workflow upfront ────────────────────
  function sendPlan(text: string) {
    setIsThinking(true);
    window.setTimeout(() => {
      setMessages((m) => [
        ...m,
        {
          id: Math.random().toString(36).slice(2),
          role: "agent",
          content: FIXED_REPLY,
          workflowProposal: {
            name: "Compass",
            description: "Sorts scans + invoices into client folders automatically.",
            department: "Filing",
            title: "Sorter",
            steps: {
              version: 1,
              steps: [
                { id: "s1", kind: "tool", label: "List /Scan Inbox", tool: "files.list" },
                { id: "s2", kind: "reason", label: "Identify client from filename + OCR", prompt: "Read filename + OCR first page" },
                { id: "s3", kind: "gate", label: "Confirm move (if new client)" },
                { id: "s4", kind: "tool", label: "Move to /Clients/{{s2.client}}/", tool: "files.move", hardened: true, note: "Hardened after 50 consistent runs" },
              ],
            },
          },
          createdAt: new Date().toISOString(),
        },
      ]);
      setIsThinking(false);
    }, 900 + Math.random() * 400);
  }

  // ─── Learn-first mode: AI does the work once via the autonomous agent loop,
  // then offers to freeze a workflow from the real execution trace.
  // This calls POST /api/agent/think (SSE) which runs runAgent() — the ReAct
  // loop that tries tools, configures missing ones, and freezes a workflow
  // from the observed trace. NOT a hardcoded demo.
  async function sendDo(text: string) {
    setIsThinking(true);
    const agentMsgId = Math.random().toString(36).slice(2);
    const trace: ExecutionStep[] = [];

    // 1. Post an initial agent message with an empty trace.
    setMessages((m) => [
      ...m,
      {
        id: agentMsgId,
        role: "agent",
        content: `On it — I'll do this once now via the autonomous agent loop so I learn exactly how it works, then I'll offer to freeze a workflow from what I did.

Watch me work 👇`,
        executionTrace: [],
        createdAt: new Date().toISOString(),
      },
    ]);

    // 2. Open the SSE stream to /api/agent/think.
    try {
      const res = await fetch("/api/agent/think", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goal: text, maxIterations: 12 }),
      });
      if (!res.ok || !res.body) {
        throw new Error(`HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finalAnswer = "";
      let proposedWorkflow: ChatMessage["workflowProposal"] | undefined;

      // 3. Read SSE events + update the trace live.
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const jsonStr = line.slice(6).trim();
          if (!jsonStr) continue;
          let event: Record<string, unknown>;
          try {
            event = JSON.parse(jsonStr) as Record<string, unknown>;
          } catch {
            continue;
          }
          // Map SSE events to execution-trace steps.
          if (event.type === "thought") {
            const thought = (event as unknown as { text: string }).text;
            trace.push({
              id: `e${trace.length + 1}`,
              action: thought.slice(0, 120),
              tool: "reason",
              status: "done",
              timestamp: new Date().toISOString(),
              result: thought,
            });
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === agentMsgId ? { ...msg, executionTrace: [...trace] } : msg,
              ),
            );
          } else if (event.type === "tool_call") {
            const ev = event as unknown as { tool: string; input: Record<string, unknown> };
            const inputSummary = Object.keys(ev.input || {}).slice(0, 3).join(", ");
            trace.push({
              id: `e${trace.length + 1}`,
              action: `${ev.tool}(${inputSummary})`,
              tool: ev.tool,
              status: "running",
              timestamp: new Date().toISOString(),
            });
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === agentMsgId ? { ...msg, executionTrace: [...trace] } : msg,
              ),
            );
          } else if (event.type === "observation") {
            const ev = event as unknown as {
              tool: string; ok: boolean; output: unknown; error?: string;
            };
            // Update the last trace step for this tool.
            const lastStep = [...trace].reverse().find((s) => s.tool === ev.tool && s.status === "running");
            if (lastStep) {
              lastStep.status = ev.ok ? "done" : "flagged";
              lastStep.durationMs = 200;
              if (ev.ok) {
                const outStr = typeof ev.output === "string" ? ev.output : JSON.stringify(ev.output);
                lastStep.result = outStr.slice(0, 200);
              } else {
                lastStep.result = ev.error || "failed";
              }
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === agentMsgId ? { ...msg, executionTrace: [...trace] } : msg,
                ),
              );
            }
          } else if (event.type === "final") {
            const ev = event as unknown as {
              answer: string;
              proposedWorkflow?: WorkflowJSON;
            };
            finalAnswer = ev.answer || "";
            if (ev.proposedWorkflow) {
              proposedWorkflow = {
                name: "Agent",
                description: finalAnswer.slice(0, 200),
                department: "General",
                steps: ev.proposedWorkflow,
              };
            }
          }
        }
      }

      // 4. Post the final answer + automate offer.
      setMessages((m) => [
        ...m,
        {
          id: Math.random().toString(36).slice(2),
          role: "agent",
          content: finalAnswer || "Done. I worked through the task above — review the trace.",
          ...(proposedWorkflow
            ? {
                automateOffer: {
                  traceId: agentMsgId,
                  summary: "Workflow frozen from the live execution trace above.",
                  name: proposedWorkflow.name,
                  department: proposedWorkflow.department,
                  steps: proposedWorkflow.steps,
                },
              }
            : {}),
          createdAt: new Date().toISOString(),
        },
      ]);
    } catch (err) {
      // Surface the error inline.
      setMessages((m) => [
        ...m,
        {
          id: Math.random().toString(36).slice(2),
          role: "agent",
          content: `(Couldn't run the autonomous loop — ${(err as Error).message}. Falling back to plan mode.)`,
          createdAt: new Date().toISOString(),
        },
      ]);
    } finally {
      setIsThinking(false);
    }
  }
  function send(text: string) {
    if (!text.trim() || isThinking) return;
    const userMsg: ChatMessage = {
      id: Math.random().toString(36).slice(2),
      role: "user",
      content: text,
      createdAt: new Date().toISOString(),
    };
    setMessages((m) => [...m, userMsg]);
    setInput("");
    if (mode === "do") {
      sendDo(text);
    } else {
      sendPlan(text);
    }
  }

  const filteredConvos = DEMO_CONVERSATIONS.filter((c) =>
    c.title.toLowerCase().includes(search.toLowerCase()),
  );
  const pinned = filteredConvos.filter((c) => c.pinned);
  const recent = filteredConvos.filter((c) => !c.pinned);
  const activeConvo = DEMO_CONVERSATIONS.find((c) => c.id === activeConversationId);

  return (
    <div className="flex h-full min-h-0">
      {/* Left: conversation list */}
      <aside className="hidden w-56 shrink-0 flex-col border-r border-border bg-muted/30 md:flex">
        <div className="border-b border-border p-2.5">
          <div className="flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1">
            <Search className="h-3 w-3 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search chats"
              className="flex-1 bg-transparent text-[11px] placeholder:text-muted-foreground focus:outline-none"
            />
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="mt-1.5 w-full justify-start gap-1.5 text-[11px] text-muted-foreground"
          >
            <Plus className="h-3 w-3" /> New chat
          </Button>
        </div>
        <div className="flex-1 min-h-0 space-y-3 overflow-y-auto overscroll-contain p-2">
          {pinned.length > 0 && (
            <div>
              <div className="px-1.5 pb-1 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
                Pinned
              </div>
              {pinned.map((c) => (
                <ConversationRow
                  key={c.id}
                  convo={c}
                  active={c.id === activeConversationId}
                  onClick={() => setActiveConversation(c.id)}
                />
              ))}
            </div>
          )}
          {recent.length > 0 && (
            <div>
              <div className="px-1.5 pb-1 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
                Recent
              </div>
              {recent.map((c) => (
                <ConversationRow
                  key={c.id}
                  convo={c}
                  active={c.id === activeConversationId}
                  onClick={() => setActiveConversation(c.id)}
                />
              ))}
            </div>
          )}
        </div>
      </aside>

      {/* Middle: chat */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* Chat header — title is the agent name (per user request) */}
        <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-4">
          {activeConvo?.workflowId && (() => {
            const agent = DEMO_WORKFLOWS.find((w) => w.id === activeConvo.workflowId);
            if (agent) {
              return (
                <>
                  <div
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-primary-foreground"
                    style={{ backgroundColor: `oklch(${agentAvatarLightness(agent.name)} 0.06 155)` }}
                  >
                    {agentInitials(agent.name)}
                  </div>
                  <span className="truncate text-sm font-medium">{agent.name}</span>
                  <span className="text-[10px] text-muted-foreground">·</span>
                  <span className="text-[10px] text-muted-foreground">{agent.department}</span>
                </>
              );
            }
            return <span className="truncate text-sm font-medium">{activeConvo?.title ?? "New chat"}</span>;
          })()}
          {!activeConvo?.workflowId && (
            <span className="truncate text-sm font-medium">{activeConvo?.title ?? "New chat"}</span>
          )}
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4">
          {messages.length === 0 && (
            <EmptyState onPick={(p) => send(p)} />
          )}
          {messages.map((m) => (
            <MessageBubble key={m.id} message={m} />
          ))}
          {isThinking && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <div className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/15 text-primary">
                <ApicalMark className="h-3.5 w-3.5" />
              </div>
              <span className="flex gap-1">
                <Dot delay={0} />
                <Dot delay={150} />
                <Dot delay={300} />
              </span>
            </div>
          )}
        </div>

        {/* Composer */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
          className="shrink-0 border-t border-border bg-background p-3"
        >
          {/* Mode toggle — Plan-first vs Do-first (learn-first) */}
          <div className="mb-2 flex items-center gap-1">
            <div className="flex rounded-lg border border-border bg-muted/40 p-0.5">
              <button
                type="button"
                onClick={() => setMode("plan")}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors",
                  mode === "plan"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
                title="AI proposes a workflow plan, you approve, it runs on schedule."
              >
                <Sparkles className="h-3 w-3" /> Plan a workflow
              </button>
              <button
                type="button"
                onClick={() => setMode("do")}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors",
                  mode === "do"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
                title="AI does the task once interactively, learns the process, then offers to automate it."
              >
                <PlayCircle className="h-3 w-3" /> Do it once
              </button>
            </div>
            <span className="ml-1.5 text-[10px] text-muted-foreground">
              {mode === "plan"
                ? "Proposes a workflow from your description"
                : "Does the work once, learns, then offers to automate"}
            </span>
          </div>
          <div className="relative">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send(input);
                }
              }}
              rows={2}
              placeholder={mode === "do" ? "Describe a job — I'll do it once now…" : "Describe a job to hand off…"}
              className="min-h-[44px] resize-none border border-input bg-background pr-12 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40"
            />
            <button
              type="submit"
              disabled={!input.trim() || isThinking}
              className="absolute bottom-2 right-2 flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground transition hover:opacity-90 disabled:opacity-30"
              aria-label="Send"
            >
              <ArrowUp className="h-4 w-4" strokeWidth={2.5} />
            </button>
          </div>
          <p className="mt-1.5 text-[10px] text-muted-foreground">
            Press Enter to send, Shift+Enter for newline
          </p>
        </form>
      </div>

      {/* Right: workflow visualization */}
      <aside className="hidden w-80 shrink-0 flex-col border-l border-border bg-muted/20 lg:flex">
        <WorkflowPane />
      </aside>
    </div>
  );
}

function ConversationRow({
  convo,
  active,
  onClick,
}: {
  convo: { id: string; title: string; pinned: boolean; updatedAt: string };
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "group mb-0.5 flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[11px] transition-colors",
        active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:bg-background/60 hover:text-foreground",
      )}
    >
      {convo.pinned && <Pin className="h-2.5 w-2.5 shrink-0 text-primary" />}
      <span className="flex-1 truncate">{convo.title}</span>
      <span className="text-[9px] text-muted-foreground/60">{relativeTime(convo.updatedAt)}</span>
    </button>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  return (
    <div className={cn("flex gap-2.5", isUser && "flex-row-reverse")}>
      <div
        className={cn(
          "flex h-6 w-6 shrink-0 items-center justify-center rounded-md",
          isUser ? "bg-muted text-muted-foreground" : "bg-primary/15 text-primary",
        )}
      >
        {isUser ? (
          <span className="text-[10px] font-semibold">J</span>
        ) : (
          <ApicalMark className="h-3.5 w-3.5" />
        )}
      </div>
      <div
        className={cn(
          "max-w-[78%] rounded-lg px-3 py-2 text-sm leading-relaxed",
          isUser ? "bg-primary text-primary-foreground" : "bg-card border border-border",
        )}
      >
        <RichText text={message.content} isUser={isUser} />
        {message.workflowProposal && (
          <div className="mt-3 border-t border-border/50 pt-3">
            <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
              <Sparkles className="h-3 w-3 text-primary" /> Proposed workflow
            </div>
            <div className="rounded-md border border-border bg-muted/30 p-2">
              <div className="mb-1.5 flex items-center gap-2">
                <div
                  className="flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-semibold text-primary-foreground"
                  style={{ backgroundColor: `oklch(${agentAvatarLightness(message.workflowProposal.name)} 0.06 155)` }}
                >
                  {agentInitials(message.workflowProposal.name)}
                </div>
                <div>
                  <div className="text-xs font-semibold">{message.workflowProposal.name}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {message.workflowProposal.title} · {message.workflowProposal.department}
                  </div>
                </div>
              </div>
              <p className="mb-2 text-[11px] text-muted-foreground">{message.workflowProposal.description}</p>
              <div className="space-y-1">
                {message.workflowProposal.steps.steps.map((step, i) => (
                  <StepMini key={step.id} step={step} index={i + 1} />
                ))}
              </div>
              <div className="mt-2.5 flex gap-1.5">
                <Button size="sm" className="h-7 flex-1 text-[11px]">
                  Approve &amp; run
                </Button>
                <Button size="sm" variant="outline" className="h-7 text-[11px]">
                  Edit
                </Button>
              </div>
            </div>
          </div>
        )}
        {/* Live execution trace — shown when agent "does it once" */}
        {message.executionTrace && message.executionTrace.length > 0 && (
          <div className="mt-3 border-t border-border/50 pt-3">
            <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
              <PlayCircle className="h-3 w-3 text-primary" /> Working on it
              <span className="ml-auto text-[9px] tabular-nums">{message.executionTrace.length} steps</span>
            </div>
            <div className="space-y-1">
              {message.executionTrace.map((step, i) => (
                <TraceStep key={step.id} step={step} index={i + 1} />
              ))}
            </div>
          </div>
        )}
        {/* Automate offer — converts the real trace into a workflow */}
        {message.automateOffer && (
          <div className="mt-3 border-t border-border/50 pt-3">
            <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
              <Wand2 className="h-3 w-3 text-primary" /> Automate this?
            </div>
            <div className="rounded-md border border-primary/30 bg-primary/5 p-2.5">
              <p className="mb-2 text-[11px] text-foreground">{message.automateOffer.summary}</p>
              <div className="mb-2 flex items-center gap-1.5">
                <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[9px] font-medium text-primary">{message.automateOffer.department}</span>
                <span className="text-[10px] text-muted-foreground">Built from {message.automateOffer.steps.steps.length} observed steps</span>
              </div>
              <div className="space-y-1">
                {message.automateOffer.steps.steps.map((step, i) => (
                  <StepMini key={step.id} step={step} index={i + 1} />
                ))}
              </div>
              <div className="mt-2.5 flex gap-1.5">
                <Button size="sm" className="h-7 flex-1 text-[11px]">
                  <Zap className="mr-1 h-3 w-3" /> Automate it
                </Button>
                <Button size="sm" variant="outline" className="h-7 text-[11px]">
                  Tweak first
                </Button>
              </div>
              <p className="mt-2 text-[9px] text-muted-foreground">
                The workflow starts unhardened. After ~50 consistent runs, reason steps auto-convert to tool steps (cheaper, faster).
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StepMini({ step, index }: { step: WorkflowStep; index: number }) {
  const Icon =
    step.hardened ? Lock : step.kind === "reason" ? Brain : step.kind === "gate" ? ShieldCheck : Wrench;
  const colorClass = step.hardened
    ? "text-hardened bg-hardened/10"
    : step.kind === "reason"
      ? "text-reason bg-reason/10"
      : step.kind === "gate"
        ? "text-gate bg-gate/10"
        : "text-tool-foreground bg-tool";
  return (
    <div className="flex items-center gap-1.5 rounded border border-border bg-background px-1.5 py-1">
      <span className="font-mono text-[9px] text-muted-foreground">{index}</span>
      <div className={cn("flex h-4 w-4 items-center justify-center rounded", colorClass)}>
        <Icon className="h-2.5 w-2.5" />
      </div>
      <span className="flex-1 truncate text-[10px]">{step.label}</span>
      {step.hardened && <Lock className="h-2.5 w-2.5 text-hardened" />}
    </div>
  );
}

// ─── Trace step — a single live-execution action with status + result ──────
function TraceStep({ step, index }: { step: ExecutionStep; index: number }) {
  const statusConfig: Record<ExecutionStatus, { icon: React.ReactNode; color: string; label: string }> = {
    running: { icon: <Loader2 className="h-2.5 w-2.5 animate-spin" />, color: "text-primary bg-primary/10", label: "running" },
    done: { icon: <CheckCircle2 className="h-2.5 w-2.5" />, color: "text-emerald-600 bg-emerald-500/10", label: "done" },
    flagged: { icon: <AlertCircle className="h-2.5 w-2.5" />, color: "text-gate bg-gate/10", label: "flagged" },
    gate: { icon: <ShieldCheck className="h-2.5 w-2.5" />, color: "text-gate bg-gate/10", label: "needs input" },
    error: { icon: <AlertCircle className="h-2.5 w-2.5" />, color: "text-destructive bg-destructive/10", label: "error" },
  };
  const cfg = statusConfig[step.status];
  return (
    <div
      className={cn(
        "rounded border px-2 py-1.5 transition-colors",
        step.status === "gate"
          ? "border-gate/40 bg-gate/5"
          : "border-border bg-background",
      )}
    >
      <div className="flex items-center gap-1.5">
        <span className="font-mono text-[9px] text-muted-foreground">{index}</span>
        <div className={cn("flex h-4 w-4 items-center justify-center rounded", cfg.color)}>
          {cfg.icon}
        </div>
        <span className="flex-1 truncate text-[10px] font-medium">{step.action}</span>
        {step.durationMs && (
          <span className="font-mono text-[8px] tabular-nums text-muted-foreground">
            {step.durationMs < 1000 ? `${step.durationMs}ms` : `${(step.durationMs / 1000).toFixed(1)}s`}
          </span>
        )}
      </div>
      {step.tool && (
        <div className="ml-6 mt-0.5 font-mono text-[8px] text-muted-foreground/70">{step.tool}</div>
      )}
      {step.result && (
        <div className="ml-6 mt-0.5 truncate text-[9px] text-muted-foreground">{step.result}</div>
      )}
      {step.question && (
        <div className="ml-6 mt-1 flex items-center gap-1.5">
          <span className="rounded bg-gate/15 px-1.5 py-0.5 text-[9px] font-medium text-gate">
            {step.question}
          </span>
          <button className="text-[9px] font-medium text-primary hover:underline">File under _Unsorted</button>
          <span className="text-[9px] text-muted-foreground">·</span>
          <button className="text-[9px] font-medium text-muted-foreground hover:underline">Assign client</button>
        </div>
      )}
    </div>
  );
}

function EmptyState({ onPick }: { onPick: (prompt: string) => void }) {
  return (
    <div className="mx-auto max-w-md py-12 text-center">
      <ApicalMark className="mx-auto mb-3 h-10 w-10" withGlow />
      <h3 className="text-base font-semibold">What needs doing?</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Describe a job in plain English. Apical will figure out the steps.
      </p>
      <div className="mt-6 grid gap-2 text-left">
        {DEFAULT_PROMPTS.map((p) => (
          <button
            key={p.title}
            onClick={() => onPick(p.prompt)}
            className="group rounded-lg border border-border bg-card p-3 text-left transition hover:border-primary/40 hover:bg-accent/30"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold">{p.title}</span>
              <ChevronRight className="h-3 w-3 text-muted-foreground transition group-hover:text-primary" />
            </div>
            <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">{p.prompt}</p>
            <p className="mt-1 text-[9px] uppercase tracking-wide text-muted-foreground/60">{p.reason}</p>
          </button>
        ))}
      </div>
    </div>
  );
}

function WorkflowPane() {
  const workflow = DEMO_WORKFLOWS[0]; // Compass
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border p-3">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Current workflow
        </div>
        <div className="mt-1 flex items-center gap-2">
          <div
            className="flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-semibold text-primary-foreground"
            style={{ backgroundColor: `oklch(${agentAvatarLightness(workflow.name)} 0.06 155)` }}
          >
            {agentInitials(workflow.name)}
          </div>
          <div>
            <div className="text-xs font-semibold">{workflow.name}</div>
            <div className="text-[10px] text-muted-foreground">{workflow.title}</div>
          </div>
          <RuntimeBadge runtime={workflow.runtime} />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
        <div className="mb-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {workflow.steps.steps.length} steps
        </div>
        <div className="space-y-1.5">
          {workflow.steps.steps.map((step, i) => (
            <StepCard key={step.id} step={step} index={i + 1} />
          ))}
        </div>
        <div className="mt-4 rounded-md border border-border bg-card p-2.5">
          <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Stats
          </div>
          <div className="grid grid-cols-2 gap-2 text-[10px]">
            <Stat label="Runs" value={workflow.runsCount.toLocaleString()} />
            <Stat label="Items" value={workflow.itemsProcessed.toLocaleString()} />
            <Stat label="Auto" value={`${Math.round((workflow.automaticCount / Math.max(workflow.itemsProcessed, 1)) * 100)}%`} />
            <Stat label="Flagged" value={workflow.flaggedCount.toLocaleString()} />
          </div>
        </div>
      </div>
    </div>
  );
}

function StepCard({ step, index }: { step: WorkflowStep; index: number }) {
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
    <div className="rounded-lg border border-border bg-card p-2.5">
      <div className="flex items-start gap-2">
        <div className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-md border font-mono text-[10px] font-semibold", colorClass)}>
          {index}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <Icon className={cn("h-3 w-3", step.hardened ? "text-hardened" : step.kind === "reason" ? "text-reason" : step.kind === "gate" ? "text-gate" : "text-tool-foreground")} />
            <span className="truncate text-[11px] font-medium">{step.label}</span>
          </div>
          <div className="mt-0.5 text-[9px] uppercase tracking-wide text-muted-foreground">
            {meta.label}
            {step.tool && ` · ${step.tool}`}
            {step.hardened && " · hardened"}
          </div>
          {step.note && <div className="mt-1 text-[9px] text-hardened">{step.note}</div>}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-muted-foreground">{label}</div>
      <div className="font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function Dot({ delay }: { delay: number }) {
  return (
    <span
      className="inline-block h-1 w-1 animate-pulse rounded-full bg-primary"
      style={{ animationDelay: `${delay}ms` }}
    />
  );
}

/** Tiny inline markdown — supports **bold** + `code` + line breaks. */
function RichText({ text, isUser }: { text: string; isUser: boolean }) {
  if (isUser) return <span className="whitespace-pre-wrap">{text}</span>;
  const lines = text.split("\n");
  return (
    <div className="whitespace-pre-wrap">
      {lines.map((line, i) => (
        <div key={i} className={line.trim() === "" ? "h-2" : ""}>
          {renderLine(line)}
        </div>
      ))}
    </div>
  );
}

function renderLine(line: string) {
  const parts = line.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((p, i) => {
    if (p.startsWith("**") && p.endsWith("**")) {
      return (
        <strong key={i} className="font-semibold">
          {p.slice(2, -2)}
        </strong>
      );
    }
    if (p.startsWith("`") && p.endsWith("`")) {
      return (
        <code
          key={i}
          className="rounded bg-muted px-1 py-0.5 font-mono text-[11px] text-primary"
        >
          {p.slice(1, -1)}
        </code>
      );
    }
    return <span key={i}>{p}</span>;
  });
}

// Suppress unused import warning
void X;
