"use client";

import * as React from "react";
import { useAppStore, type AgentCenterMode } from "@/lib/apical/store";
import {
  DEMO_CONVERSATIONS,
  DEMO_MESSAGES,
  DEMO_WORKFLOWS,
  DEFAULT_PROMPTS,
  messagesForAgent,
  apicalWelcomeMessage,
  agentInitials,
  agentAvatarLightness,
  relativeTime,
  formatDuration,
  STEP_KIND_META,
  type ChatMessage,
  type Workflow,
  type AgentRuntime,
} from "@/lib/apical";
import { ApicalMark, RuntimeBadge } from "./logo";
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
  Search,
  Sparkles,
  ArrowUp,
  Pin,
  X,
  ChevronRight,
  Zap,
  Columns2,
} from "lucide-react";
import type { ExecutionStep } from "@/lib/apical";

// ─── Helpers ────────────────────────────────────────────────────────────────

function agentStatus(agent: Workflow): { color: string; label: string } {
  if (agent.status === "paused") return { color: "bg-muted-foreground", label: "Paused" };
  if (agent.flaggedCount > 0) return { color: "bg-gate", label: "Flagged" };
  return { color: "bg-emerald-500", label: "Active" };
}

// ─── Main view: three-pane layout with browser-style tabs ──────────────────

export function AgentsView() {
  const activeConversationId = useAppStore((s) => s.activeConversationId);
  const openTab = useAppStore((s) => s.openTab);
  const closeTab = useAppStore((s) => s.closeTab);
  const openTabs = useAppStore((s) => s.openTabs);
  const splitView = useAppStore((s) => s.splitView);
  const setSplitView = useAppStore((s) => s.setSplitView);
  const splitTabId = useAppStore((s) => s.splitTabId);
  const setSplitTabId = useAppStore((s) => s.setSplitTabId);
  const inspectorOpen = useAppStore((s) => s.inspectorOpen);
  const toggleInspector = useAppStore((s) => s.toggleInspector);

  // Resolve the active conversation → agent (if it has a workflowId).
  const activeConvo = DEMO_CONVERSATIONS.find((c) => c.id === activeConversationId);
  const activeAgent = activeConvo?.workflowId
    ? DEMO_WORKFLOWS.find((w) => w.id === activeConvo.workflowId)
    : undefined;
  const isOrchestrator = activeConversationId === "orchestrator";

  // Split view: show two center panes side-by-side. The primary is the active
  // tab; the secondary is splitTabId (or the previous tab if not set).
  const splitConvo = splitTabId
    ? DEMO_CONVERSATIONS.find((c) => c.id === splitTabId)
    : undefined;
  const splitAgent = splitConvo?.workflowId
    ? DEMO_WORKFLOWS.find((w) => w.id === splitConvo.workflowId)
    : undefined;
  const splitIsOrchestrator = splitTabId === "orchestrator";

  return (
    <div className="flex h-full min-h-0">
      {/* Left rail — agent navigator */}
      <AgentNavigator
        activeId={activeConversationId}
        onPick={(id) => openTab(id)}
      />

      {/* Center — browser-style tab bar + one or two CenterPanes */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Tab bar */}
        <TabBar
          tabs={openTabs}
          activeId={activeConversationId}
          splitTabId={splitView ? splitTabId : null}
          onPick={(id) => openTab(id)}
          onClose={closeTab}
          splitView={splitView}
          onToggleSplit={() => {
            if (splitView) {
              setSplitView(false);
              setSplitTabId(null);
            } else if (openTabs.length >= 2) {
              // Pick the first tab that isn't the active one.
              const other = openTabs.find((t) => t !== activeConversationId);
              if (other) {
                setSplitTabId(other);
                setSplitView(true);
              }
            }
          }}
        />

        {/* Center pane(s) — single or split */}
        <div className="flex min-h-0 flex-1">
          <div className={cn("min-h-0 min-w-0 flex-1", splitView && "border-r border-border")}>
            <CenterPane
              agent={activeAgent}
              isOrchestrator={isOrchestrator}
              inspectorOpen={inspectorOpen}
              onToggleInspector={toggleInspector}
            />
          </div>
          {splitView && splitTabId && (
            <div className="min-h-0 w-1/2 min-w-0">
              <CenterPane
                agent={splitAgent}
                isOrchestrator={splitIsOrchestrator}
                inspectorOpen={false}
                onToggleInspector={() => {}}
              />
            </div>
          )}
        </div>
      </div>

      {/* Right — collapsible inspector (hidden for Orchestrator + in split view) */}
      {inspectorOpen && activeAgent && !isOrchestrator && !splitView && (
        <InspectorPane agent={activeAgent} />
      )}
    </div>
  );
}

// ─── Browser-style tab bar ──────────────────────────────────────────────────

function TabBar({
  tabs,
  activeId,
  splitTabId,
  onPick,
  onClose,
  splitView,
  onToggleSplit,
}: {
  tabs: string[];
  activeId: string | null;
  splitTabId: string | null;
  onPick: (id: string) => void;
  onClose: (id: string) => void;
  splitView: boolean;
  onToggleSplit: () => void;
}) {
  return (
    <div className="flex h-8 shrink-0 items-center gap-0.5 border-b border-border bg-muted/40 px-1.5">
      <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
        {tabs.map((tabId) => {
          const convo = DEMO_CONVERSATIONS.find((c) => c.id === tabId);
          if (!convo) return null;
          const isApical = tabId === "orchestrator";
          const agent = convo.workflowId
            ? DEMO_WORKFLOWS.find((w) => w.id === convo.workflowId)
            : undefined;
          const isActive = tabId === activeId;
          const isSplit = tabId === splitTabId;
          return (
            <div
              key={tabId}
              onClick={() => onPick(tabId)}
              className={cn(
                "group flex shrink-0 cursor-pointer items-center gap-1.5 rounded-t-md border-x border-t px-2.5 py-1 text-[11px] transition-colors",
                isActive
                  ? "border-border bg-background text-foreground"
                  : "border-transparent text-muted-foreground hover:bg-accent/40 hover:text-foreground",
                isSplit && "ring-1 ring-primary/40",
              )}
              title={isApical ? "Apical — general context" : convo.title}
            >
              {isApical ? (
                <Sparkles className="h-3 w-3 text-primary" />
              ) : agent ? (
                <div
                  className="flex h-3.5 w-3.5 items-center justify-center rounded-full text-[7px] font-semibold text-primary-foreground"
                  style={{ backgroundColor: `oklch(${agentAvatarLightness(agent.name)} 0.06 155)` }}
                >
                  {agentInitials(agent.name)}
                </div>
              ) : null}
              <span className="max-w-[100px] truncate">{convo.title}</span>
              {tabs.length > 1 && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onClose(tabId);
                  }}
                  className="ml-0.5 rounded p-0.5 text-muted-foreground opacity-0 hover:bg-accent hover:text-foreground group-hover:opacity-100"
                  title="Close tab"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              )}
            </div>
          );
        })}
      </div>
      {/* Split-view toggle — only enabled when 2+ tabs are open */}
      <button
        onClick={onToggleSplit}
        disabled={tabs.length < 2}
        className={cn(
          "flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-[10px] font-medium transition-colors",
          splitView
            ? "bg-primary/10 text-primary"
            : "text-muted-foreground hover:bg-accent/40 hover:text-foreground",
          tabs.length < 2 && "cursor-not-allowed opacity-40",
        )}
        title={splitView ? "Exit split view" : "Split view (side-by-side)"}
      >
        <Columns2 className="h-3 w-3" />
        <span className="hidden sm:inline">{splitView ? "Single" : "Split"}</span>
      </button>
    </div>
  );
}

// ─── Left rail: agent navigator ────────────────────────────────────────────

function AgentNavigator({
  activeId,
  onPick,
}: {
  activeId: string | null;
  onPick: (id: string) => void;
}) {
  const [search, setSearch] = React.useState("");

  const orchestrator = DEMO_CONVERSATIONS.find((c) => c.id === "orchestrator")!;
  const agentConvos = DEMO_CONVERSATIONS.filter((c) => c.id !== "orchestrator");
  const filtered = agentConvos.filter((c) => {
    if (!search) return true;
    const wf = DEMO_WORKFLOWS.find((w) => w.id === c.workflowId);
    return (
      c.title.toLowerCase().includes(search.toLowerCase()) ||
      (wf?.department ?? "").toLowerCase().includes(search.toLowerCase())
    );
  });

  return (
    <aside className="hidden w-56 shrink-0 flex-col border-r border-border bg-muted/30 md:flex">
      {/* Search + new */}
      <div className="border-b border-border p-2.5">
        <div className="flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1">
          <Search className="h-3 w-3 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search agents"
            className="flex-1 bg-transparent text-[11px] placeholder:text-muted-foreground focus:outline-none"
          />
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="mt-1.5 w-full justify-start gap-1.5 text-[11px] text-muted-foreground"
        >
          <Plus className="h-3 w-3" /> New agent
        </Button>
      </div>

      <div className="flex-1 min-h-0 space-y-3 overflow-y-auto overscroll-contain p-2">
        {/* Orchestrator — pinned at top, distinct treatment */}
        <div>
          <div className="px-1.5 pb-1 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
            Apical
          </div>
          <OrchestratorRow
            convo={orchestrator}
            active={orchestrator.id === activeId}
            onClick={() => onPick(orchestrator.id)}
          />
        </div>

        {/* Agents */}
        <div>
          <div className="px-1.5 pb-1 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
            Agents
          </div>
          <div className="space-y-0.5">
            {filtered.map((c) => {
              const wf = DEMO_WORKFLOWS.find((w) => w.id === c.workflowId);
              if (!wf) return null;
              return (
                <AgentRailRow
                  key={c.id}
                  convo={c}
                  agent={wf}
                  active={c.id === activeId}
                  onClick={() => onPick(c.id)}
                />
              );
            })}
          </div>
        </div>
      </div>
    </aside>
  );
}

function OrchestratorRow({
  convo,
  active,
  onClick,
}: {
  convo: { id: string; title: string };
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
        active ? "bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
      )}
    >
      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary/15 text-primary">
        <Sparkles className="h-3.5 w-3.5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[11px] font-medium">{convo.title}</div>
        <div className="truncate text-[9px] text-muted-foreground">General · all agents</div>
      </div>
      <Pin className="h-2.5 w-2.5 shrink-0 text-primary/60" />
    </button>
  );
}

function AgentRailRow({
  convo,
  agent,
  active,
  onClick,
}: {
  convo: { id: string; title: string };
  agent: Workflow;
  active: boolean;
  onClick: () => void;
}) {
  const status = agentStatus(agent);
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
        active ? "bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
      )}
    >
      <div className="relative shrink-0">
        <div
          className="flex h-6 w-6 items-center justify-center rounded-full text-[9px] font-semibold text-primary-foreground"
          style={{ backgroundColor: `oklch(${agentAvatarLightness(agent.name)} 0.06 155)` }}
        >
          {agentInitials(agent.name)}
        </div>
        <span
          className={cn("absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-muted/30", status.color)}
          title={status.label}
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1">
          <span className="truncate text-[11px] font-medium">{convo.title}</span>
          {agent.flaggedCount > 0 && (
            <Badge
              variant="outline"
              className="shrink-0 border-gate/40 bg-gate/10 px-1 text-[8px] font-semibold text-gate"
            >
              {agent.flaggedCount}
            </Badge>
          )}
        </div>
        <div className="truncate text-[9px] text-muted-foreground">{agent.department}</div>
      </div>
    </button>
  );
}

// ─── Center pane: Chat / Dashboard / Workflow / Config ─────────────────────

function CenterPane({
  agent,
  isOrchestrator,
  inspectorOpen,
  onToggleInspector,
}: {
  agent: Workflow | undefined;
  isOrchestrator: boolean;
  inspectorOpen: boolean;
  onToggleInspector: () => void;
}) {
  const centerMode = useAppStore((s) => s.agentCenterMode);
  const setCenterMode = useAppStore((s) => s.setAgentCenterMode);

  // Orchestrator is always in chat mode — it has no dashboard/workflow/config.
  const effectiveMode: AgentCenterMode = isOrchestrator ? "chat" : centerMode;

  return (
    <>
      {/* Sub-header: agent identity + mode tabs + inspector toggle */}
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
        {isOrchestrator ? (
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/15 text-primary">
              <Sparkles className="h-4 w-4" />
            </div>
            <div>
              <div className="text-sm font-semibold">Apical</div>
              <div className="text-[10px] text-muted-foreground">General · context to all agents</div>
            </div>
          </div>
        ) : agent ? (
          <div className="flex items-center gap-2">
            <div
              className="flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-semibold text-primary-foreground"
              style={{ backgroundColor: `oklch(${agentAvatarLightness(agent.name)} 0.06 155)` }}
            >
              {agentInitials(agent.name)}
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-semibold">{agent.name}</span>
                <RuntimeBadge runtime={agent.runtime} />
              </div>
              <div className="text-[10px] text-muted-foreground">{agent.department} · {agent.title}</div>
            </div>
          </div>
        ) : null}

        {/* Mode tabs — only for real agents (not Orchestrator) */}
        {!isOrchestrator && agent && (
          <div className="ml-auto flex items-center gap-1 rounded-lg border border-border bg-muted/40 p-0.5">
            {(["chat", "dashboard", "workflow", "config"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setCenterMode(m)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-[11px] font-medium capitalize transition-colors",
                  effectiveMode === m
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {m}
              </button>
            ))}
          </div>
        )}

        {/* Inspector toggle — only when an agent is selected + inspector is relevant */}
        {!isOrchestrator && agent && (
          <button
            onClick={onToggleInspector}
            className={cn(
              "ml-1 flex items-center gap-1 rounded-md p-1.5 transition-colors",
              inspectorOpen ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
            )}
            title={inspectorOpen ? "Hide inspector" : "Show inspector"}
          >
            {inspectorOpen ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
          </button>
        )}
      </div>

      {/* Mode content */}
      <div className="min-h-0 flex-1 overflow-hidden">
        {effectiveMode === "chat" && <ChatPane agent={agent} isOrchestrator={isOrchestrator} />}
        {effectiveMode === "dashboard" && agent && <AgentDashboard agent={agent} />}
        {effectiveMode === "workflow" && agent && <AgentWorkflow agent={agent} />}
        {effectiveMode === "config" && agent && <AgentConfig agent={agent} />}
      </div>
    </>
  );
}

// ─── Chat pane (center) ────────────────────────────────────────────────────

// The Apical (orchestrator) chat no longer uses a static greeting — it uses
// apicalWelcomeMessage() which generates a time-of-day greeting + a live
// summary of what's flagged, what ran while away, and any paused agents.
const AGENT_LIMIT = 5  // free-plan limit; gracefully handled when branching.

const AGENT_REPLY = `Here's the plan I'm proposing:

1. **Tool** — List everything in your /Scan Inbox
2. **Reason** — Identify the client from the filename + OCR
3. **Gate** — Confirm the move if it's a new client (you approve)
4. **Tool** — Move each file to /Clients/<name>/ (hardened after 50 consistent runs)

Want me to run this every 15 minutes?

—

This is a live preview. **Download to try Free** to run real agents, save versions, and restore them from any point in this conversation.`;

function ChatPane({ agent, isOrchestrator }: { agent: Workflow | undefined; isOrchestrator: boolean }) {
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [input, setInput] = React.useState("");
  const [isThinking, setIsThinking] = React.useState(false);
  const [mode, setMode] = React.useState<"plan" | "do">("plan");
  const [loading, setLoading] = React.useState(false);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, isThinking]);

  // Load REAL chat history from the API. Each agent's conversation is
  // persisted in the AgentMessage table (POST /api/agents/[id]/messages).
  // For the Apical chat, the welcome summary is PREPENDED to the history
  // (shown at the top), then the real conversation flows below it.
  // If the API returns nothing (new agent, demo mode, or DB not seeded),
  // we fall back to messagesForAgent() so the UI isn't empty.
  React.useEffect(() => {
    let cancelled = false;
    async function loadHistory() {
      setLoading(true);
      try {
        if (isOrchestrator) {
          // Apical chat: the welcome summary at the top, then (if any) the
          // orchestrator's conversation history below it. The orchestrator
          // doesn't have a workflow row, so we can't hit /api/agents/:id/messages
          // for it — we use a synthetic conversation id. For now, just the
          // welcome message + any locally-cached messages.
          const welcome = apicalWelcomeMessage({
            user: { name: "Jordan" },
            agents: DEMO_WORKFLOWS,
            lastSeenAgoHours: 6,
          });
          if (!cancelled) setMessages([welcome]);
        } else if (agent) {
          // Real agent — fetch its persisted chat history.
          const res = await fetch(`/api/agents/${agent.id}/messages`);
          if (res.ok) {
            const data = await res.json();
            const history: ChatMessage[] = (data.messages || []).map(
              (m: { id: string; role: string; content: string; createdAt: string }) => ({
                id: m.id,
                role: m.role === "user" ? "user" : "agent",
                content: m.content,
                createdAt: m.createdAt,
              }),
            );
            if (!cancelled) {
              if (history.length > 0) {
                setMessages(history);
              } else {
                // No persisted history yet — fall back to the role-specific
                // demo thread so the chat isn't empty on first view.
                setMessages(messagesForAgent(agent));
              }
            }
          } else if (!cancelled) {
            setMessages(messagesForAgent(agent));
          }
        } else {
          if (!cancelled) setMessages([]);
        }
      } catch {
        // Network/DB error — fall back to demo messages so the UI still works.
        if (!cancelled && agent) setMessages(messagesForAgent(agent));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadHistory();
    return () => { cancelled = true; };
  }, [isOrchestrator, agent?.id]);

  // Persist a message to the agent's thread (so it survives reloads).
  async function persistMessage(msg: ChatMessage) {
    if (isOrchestrator || !agent) return; // orchestrator has no agent row
    try {
      await fetch(`/api/agents/${agent.id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: msg.role, content: msg.content }),
      });
    } catch {
      // non-fatal — the message is already in local state
    }
  }

  // Branch a new agent from the Apical chat. Handles the agent limit gracefully.
  function branchNewAgent(name: string, department: string, description: string) {
    if (DEMO_WORKFLOWS.length >= AGENT_LIMIT) {
      const limitMsg: ChatMessage = {
        id: Math.random().toString(36).slice(2),
        role: "agent",
        content: `I'd normally spin up a new agent ("${name}") for this, but you're at the free-plan limit of ${AGENT_LIMIT} agents. You can either upgrade to Pro (unlimited agents) or pause an existing one to make room. Want me to show you which agents are using the fewest cycles?`,
        createdAt: new Date().toISOString(),
      };
      setMessages((m) => [...m, limitMsg]);
      return;
    }
    const branchMsg: ChatMessage = {
      id: Math.random().toString(36).slice(2),
      role: "agent",
      content: `I'll set up a new agent — **${name}** in ${department}. ${description}\n\nI've created the agent and started a chat with it. You can switch to it from the left rail. It'll begin working once you approve its first workflow.`,
      workflowProposal: {
        name,
        description,
        department,
        steps: {
          version: 1,
          steps: [
            { id: "s1", kind: "tool", label: "Gather input", tool: "http.request" },
            { id: "s2", kind: "reason", label: "Process + decide", prompt: "Analyze the input and decide the action." },
            { id: "s3", kind: "gate", label: "Approve before acting" },
            { id: "s4", kind: "tool", label: "Execute", tool: "http.request" },
          ],
        },
      },
      createdAt: new Date().toISOString(),
    };
    setMessages((m) => [...m, branchMsg]);
  }

  async function sendPlan(text: string) {
    setIsThinking(true);
    // Simulated LLM delay. (A real call would go to /api/agents/:id/chat or
    // /api/agent/think for the autonomous loop.)
    await new Promise((r) => setTimeout(r, 900 + Math.random() * 400));
    let replyMsg: ChatMessage;
    if (isOrchestrator) {
      const lower = text.toLowerCase();
      const wantsNewAgent = /new agent|set up|create|hire|spin up|branch|automate this|do this every|track|monitor|watch|chase|sort|audit|find|draft/.test(lower);
      if (wantsNewAgent) {
        const nameGuess = text.split(" ").slice(0, 2).join(" ").replace(/[^a-zA-Z ]/g, "").trim() || "New Agent";
        branchNewAgent(nameGuess, "General", `Automates: ${text.slice(0, 100)}`);
        setIsThinking(false);
        return;
      }
      replyMsg = {
        id: Math.random().toString(36).slice(2),
        role: "agent",
        content: `I can coordinate across your agents for that. Here's what I'd do:\n\n1. Check which agents are relevant\n2. Route the task to the best one (or set up a new one if needed)\n3. Report back with results\n\nWant me to proceed, or would you rather I set up a new dedicated agent for this?`,
        createdAt: new Date().toISOString(),
      };
    } else {
      replyMsg = {
        id: Math.random().toString(36).slice(2),
        role: "agent",
        content: AGENT_REPLY,
        workflowProposal: {
          name: agent?.name ?? "Agent",
          description: "Auto-generated workflow.",
          department: agent?.department ?? "General",
          steps: {
            version: 1,
            steps: [
              { id: "s1", kind: "tool", label: "List inbox", tool: "files.list" },
              { id: "s2", kind: "reason", label: "Identify client", prompt: "OCR + match" },
              { id: "s3", kind: "gate", label: "Approve move" },
              { id: "s4", kind: "tool", label: "Move file", tool: "files.move" },
            ],
          },
        },
        createdAt: new Date().toISOString(),
      };
    }
    setMessages((m) => [...m, replyMsg]);
    void persistMessage(replyMsg);
    setIsThinking(false);
  }

  async function sendDo(text: string) {
    setIsThinking(true);
    const traceMsg: ChatMessage = {
      id: Math.random().toString(36).slice(2),
      role: "agent",
      content: `On it — running the autonomous agent loop to do this once, learn the process, then freeze a workflow.\n\nWatch the trace 👇`,
      executionTrace: [],
      createdAt: new Date().toISOString(),
    };
    setMessages((m) => [...m, traceMsg]);
    const trace: ExecutionStep[] = [
      { id: "e1", action: `Listed items for "${text.slice(0, 40)}"`, tool: "files.list", status: "done", durationMs: 340, timestamp: new Date().toISOString(), result: "12 items found" },
      { id: "e2", action: "Identified pattern", tool: "reason", status: "done", durationMs: 180, timestamp: new Date().toISOString(), result: "Pattern: client name in filename" },
      { id: "e3", action: "Applied transformation", tool: "files.move", status: "done", durationMs: 620, timestamp: new Date().toISOString(), result: "10/12 processed, 2 flagged" },
    ];
    for (const step of trace) {
      await new Promise((r) => setTimeout(r, 700));
      setMessages((prev) =>
        prev.map((msg, i) =>
          i === prev.length - 1 ? { ...msg, executionTrace: [...(msg.executionTrace ?? []), step] } : msg,
        ),
      );
    }
    const doneMsg: ChatMessage = {
      id: Math.random().toString(36).slice(2),
      role: "agent",
      content: `Done — processed 12 items, 2 flagged for your review. I can freeze this into a workflow that runs on a schedule.`,
      createdAt: new Date().toISOString(),
    };
    setMessages((m) => [...m, doneMsg]);
    void persistMessage(doneMsg);
    setIsThinking(false);
  }

  function send(text: string) {
    if (!text.trim() || isThinking) return;
    const userMsg: ChatMessage = {
      id: Math.random().toString(36).slice(2),
      role: "user",
      content: text.trim(),
      createdAt: new Date().toISOString(),
    };
    setMessages((m) => [...m, userMsg]);
    setInput("");
    void persistMessage(userMsg);
    if (mode === "do") {
      void sendDo(text);
    } else {
      void sendPlan(text);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Messages */}
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4">
        {loading && (
          <div className="flex items-center justify-center py-8 text-xs text-muted-foreground">
            <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Loading chat history…
          </div>
        )}
        {!loading && messages.length === 0 && !isOrchestrator && (
          <EmptyState onPick={(p) => send(p)} />
        )}
        {messages.map((m) => (
          <MessageBubble key={m.id} message={m} agentName={isOrchestrator ? "Apical" : agent?.name ?? "Agent"} />
        ))}
        {isThinking && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <div className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/15 text-primary">
              {isOrchestrator ? <Sparkles className="h-3.5 w-3.5" /> : <ApicalMark className="h-3.5 w-3.5" />}
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
        {!isOrchestrator && (
          <div className="mb-2 flex items-center gap-1">
            <div className="flex rounded-lg border border-border bg-muted/40 p-0.5">
              <button
                type="button"
                onClick={() => setMode("plan")}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors",
                  mode === "plan" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
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
                  mode === "do" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
                title="AI does the task once interactively, learns the process, then offers to automate it."
              >
                <Zap className="h-3 w-3" /> Do it once
              </button>
            </div>
          </div>
        )}
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
            placeholder={
              isOrchestrator
                ? "Ask about your agents, coordinate a task, or set up something new…"
                : mode === "do"
                  ? "Describe a job — I'll do it once now…"
                  : "Describe a job to hand off…"
            }
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
  );
}


function MessageBubble({ message, agentName }: { message: ChatMessage; agentName: string }) {
  const isUser = message.role === "user";
  // Flat block style — no bubbles.
  // User messages: a neutral slate-gray block (bg-muted), left-aligned, full-width-ish.
  // Agent messages: no bubble at all — plain text on the page background, with a
  // small agent-name label above for context.
  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] space-y-1">
          <div className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground">
            <RichText text={message.content} isUser />
          </div>
          <div className="text-right text-[10px] text-muted-foreground">
            {new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </div>
        </div>
      </div>
    );
  }
  // Agent — no bubble, plain text. Name label for context (which agent is talking).
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground">
        <span>{agentName}</span>
      </div>
      <div className="text-sm text-foreground">
        <RichText text={message.content} isUser={false} />
      </div>
      {message.executionTrace && message.executionTrace.length > 0 && (
        <div className="mt-2 space-y-1 rounded-md border border-border bg-muted/30 p-2">
          {message.executionTrace.map((step, i) => (
            <TraceStep key={step.id} step={step} index={i} />
          ))}
        </div>
      )}
      {message.workflowProposal && (
        <div className="mt-2 rounded-md border border-primary/30 bg-primary/5 p-2.5 text-xs">
          <div className="mb-1 font-semibold text-primary">Proposed workflow: {message.workflowProposal.name}</div>
          <div className="text-muted-foreground">{message.workflowProposal.description}</div>
          <div className="mt-1.5 text-[10px] text-muted-foreground">{message.workflowProposal.steps.steps.length} steps · {message.workflowProposal.department}</div>
        </div>
      )}
      <div className="text-[10px] text-muted-foreground">
        {new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
      </div>
    </div>
  );
}

function TraceStep({ step, index }: { step: ExecutionStep; index: number }) {
  const Icon =
    step.status === "flagged" || step.status === "gate"
      ? ShieldCheck
      : step.tool === "reason"
        ? Brain
        : step.tool === "gate"
          ? ShieldCheck
          : Wrench;
  const statusColor =
    step.status === "done"
      ? "text-emerald-500"
      : step.status === "flagged"
        ? "text-gate"
        : step.status === "running"
          ? "text-primary"
          : "text-destructive";
  return (
    <div className="flex items-start gap-2 text-[11px]">
      <div className={cn("mt-0.5", statusColor)}>
        {step.status === "running" ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : step.status === "done" ? (
          <CheckCircle2 className="h-3 w-3" />
        ) : step.status === "flagged" || step.status === "gate" ? (
          <AlertTriangle className="h-3 w-3" />
        ) : (
          <X className="h-3 w-3" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-[9px] text-muted-foreground">{String(index + 1).padStart(2, "0")}</span>
          <Icon className="h-3 w-3 text-muted-foreground" />
          <span className="truncate">{step.action}</span>
          {step.durationMs && (
            <span className="ml-auto shrink-0 font-mono text-[9px] text-muted-foreground">{formatDuration(step.durationMs)}</span>
          )}
        </div>
        {step.result && (
          <div className="mt-0.5 truncate text-[10px] text-muted-foreground">{step.result}</div>
        )}
      </div>
    </div>
  );
}

function EmptyState({ onPick }: { onPick: (prompt: string) => void }) {
  return (
    <div className="mx-auto max-w-md py-8 text-center">
      <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <MessageSquare className="h-5 w-5" />
      </div>
      <h3 className="text-sm font-semibold">Start a conversation</h3>
      <p className="mt-1 text-xs text-muted-foreground">Describe a job to hand off, or pick a starting point:</p>
      <div className="mt-4 grid gap-2">
        {DEFAULT_PROMPTS.map((p) => (
          <button
            key={p.title}
            onClick={() => onPick(p.prompt)}
            className="rounded-lg border border-border bg-card p-2.5 text-left transition-colors hover:border-primary/30"
          >
            <div className="text-xs font-medium">{p.title}</div>
            <div className="mt-0.5 text-[10px] text-muted-foreground">{p.reason}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

function Dot({ delay }: { delay: number }) {
  return (
    <span
      className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-primary"
      style={{ animationDelay: `${delay}ms` }}
    />
  );
}

function RichText({ text, isUser }: { text: string; isUser: boolean }) {
  const lines = text.split("\n");
  return (
    <div className={cn("space-y-1", isUser && "text-primary-foreground")}>
      {lines.map((line, i) => (
        <div key={i}>{renderLine(line)}</div>
      ))}
    </div>
  );
}

function renderLine(line: string) {
  // Bold: **text**
  const parts = line.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith("**") && part.endsWith("**")) {
          return <strong key={i}>{part.slice(2, -2)}</strong>;
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

// ─── Right pane: inspector ─────────────────────────────────────────────────

function InspectorPane({ agent }: { agent: Workflow }) {
  const setCenterMode = useAppStore((s) => s.setAgentCenterMode);
  const status = agentStatus(agent);
  const autoPct = Math.round((agent.automaticCount / Math.max(agent.itemsProcessed, 1)) * 100);

  return (
    <aside className="hidden w-72 shrink-0 flex-col overflow-y-auto overscroll-contain border-l border-border bg-muted/30 lg:flex">
      <div className="space-y-3 p-3">
        {/* Status + schedule */}
        <div className="rounded-lg border border-border bg-card p-3">
          <div className="mb-2 flex items-center gap-2">
            <span className={cn("h-2 w-2 rounded-full", status.color)} />
            <span className="text-xs font-semibold capitalize">{status.label}</span>
            <RuntimeBadge runtime={agent.runtime} />
          </div>
          <div className="text-[10px] text-muted-foreground">
            {agent.trigger === "schedule" ? `Schedule · ${agent.schedule}` : "Manual trigger"}
          </div>
          <div className="mt-1 text-[10px] text-muted-foreground">
            {agent.runsCount} runs · {agent.itemsProcessed.toLocaleString()} items
          </div>
        </div>

        {/* LOUD flagged button — the entire product is human-in-the-loop moments */}
        {agent.flaggedCount > 0 && (
          <button
            onClick={() => setCenterMode("dashboard")}
            className="flex w-full items-center gap-2 rounded-lg border-2 border-gate/50 bg-gate/10 p-3 text-left transition-colors hover:border-gate hover:bg-gate/15"
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-gate/20 text-gate">
              <AlertTriangle className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-bold text-gate">{agent.flaggedCount} flagged → review</div>
              <div className="text-[10px] text-gate/80">Human-in-the-loop items need your call</div>
            </div>
            <ChevronRight className="h-4 w-4 shrink-0 text-gate" />
          </button>
        )}

        {/* Workflow steps (summary) */}
        <div className="rounded-lg border border-border bg-card p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Workflow</span>
            <button
              onClick={() => setCenterMode("workflow")}
              className="text-[10px] text-primary hover:underline"
            >
              View →
            </button>
          </div>
          <div className="space-y-1">
            {agent.steps.steps.slice(0, 5).map((step, i) => {
              const Icon = step.hardened ? Lock : step.kind === "reason" ? Brain : step.kind === "gate" ? ShieldCheck : Wrench;
              return (
                <div key={step.id} className="flex items-center gap-1.5 text-[10px]">
                  <span className="font-mono text-[9px] text-muted-foreground">{i + 1}</span>
                  <Icon className={cn("h-2.5 w-2.5", step.hardened ? "text-hardened" : step.kind === "reason" ? "text-reason" : step.kind === "gate" ? "text-gate" : "text-muted-foreground")} />
                  <span className="truncate">{step.label}</span>
                  {step.hardened && <Lock className="ml-auto h-2 w-2 text-hardened" />}
                </div>
              );
            })}
            {agent.steps.steps.length > 5 && (
              <div className="text-[9px] text-muted-foreground">+ {agent.steps.steps.length - 5} more</div>
            )}
          </div>
        </div>

        {/* Stats */}
        <div className="rounded-lg border border-border bg-card p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Stats</span>
            <button
              onClick={() => setCenterMode("dashboard")}
              className="text-[10px] text-primary hover:underline"
            >
              Full dashboard →
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2 text-[10px]">
            <div>
              <div className="text-muted-foreground">Processed</div>
              <div className="font-semibold tabular-nums">{agent.itemsProcessed.toLocaleString()}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Automatic</div>
              <div className="font-semibold tabular-nums">{autoPct}%</div>
            </div>
            <div>
              <div className="text-muted-foreground">Flagged</div>
              <div className="font-semibold tabular-nums text-gate">{agent.flaggedCount.toLocaleString()}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Runs</div>
              <div className="font-semibold tabular-nums">{agent.runsCount}</div>
            </div>
          </div>
        </div>

        {/* Last few runs (mocked) */}
        <div className="rounded-lg border border-border bg-card p-3">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Recent runs</div>
          <div className="space-y-1">
            {[
              { status: "completed", when: "15m ago", items: 32 },
              { status: "completed", when: "30m ago", items: 18 },
              { status: "running", when: "now", items: 12 },
              { status: "failed", when: "1h ago", items: 0 },
            ].map((r, i) => (
              <div key={i} className="flex items-center gap-2 text-[10px]">
                <div
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    r.status === "completed" && "bg-emerald-500",
                    r.status === "running" && "bg-primary",
                    r.status === "failed" && "bg-destructive",
                  )}
                />
                <span className="capitalize">{r.status}</span>
                <span className="text-muted-foreground">· {r.items} items</span>
                <span className="ml-auto text-muted-foreground">{r.when}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Links to full views */}
        <div className="flex flex-col gap-1">
          <button
            onClick={() => setCenterMode("dashboard")}
            className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-left text-[11px] hover:border-primary/30"
          >
            <Activity className="h-3.5 w-3.5 text-muted-foreground" /> Full dashboard
            <ChevronRight className="ml-auto h-3 w-3 text-muted-foreground" />
          </button>
          <button
            onClick={() => setCenterMode("config")}
            className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-left text-[11px] hover:border-primary/30"
          >
            <ShieldCheck className="h-3.5 w-3.5 text-muted-foreground" /> Edit config
            <ChevronRight className="ml-auto h-3 w-3 text-muted-foreground" />
          </button>
        </div>
      </div>
    </aside>
  );
}

// ─── Dashboard / Workflow / Config (reused from agents-tab) ────────────────

function AgentDashboard({ agent }: { agent: Workflow }) {
  const autoPct = Math.round((agent.automaticCount / Math.max(agent.itemsProcessed, 1)) * 100);
  return (
    <div className="h-full overflow-y-auto overscroll-contain p-4">
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
          <StatCard label="Items processed" value={agent.itemsProcessed.toLocaleString()} icon={Activity} accent="bg-primary/10 text-primary" />
          <StatCard label="Automatic" value={`${autoPct}%`} icon={CheckCircle2} accent="bg-emerald-500/10 text-emerald-500" />
          <StatCard label="Flagged" value={agent.flaggedCount.toLocaleString()} icon={AlertTriangle} accent="bg-gate/15 text-gate" />
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">About</h3>
          <p className="mt-1.5 text-sm">{agent.description}</p>
          <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-3">
            <Meta label="Department" value={agent.department} />
            <Meta label="Title" value={agent.title ?? "—"} />
            <Meta label="Trigger" value={agent.trigger === "schedule" ? `Schedule · ${agent.schedule}` : "Manual"} />
          </div>
        </div>
      </div>
    </div>
  );
}

function AgentWorkflow({ agent }: { agent: Workflow }) {
  return (
    <div className="h-full overflow-y-auto overscroll-contain p-4">
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
                      <span className="rounded bg-hardened/15 px-1 py-0.5 text-[9px] font-medium text-hardened">Hardened</span>
                    )}
                  </div>
                  <div className="mt-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                    {meta.label}{step.tool && ` · ${step.tool}`}
                  </div>
                  {step.prompt && (
                    <p className="mt-1.5 rounded bg-muted/40 p-2 text-[11px] text-muted-foreground">{step.prompt}</p>
                  )}
                  {step.note && <div className="mt-1 text-[10px] text-hardened">{step.note}</div>}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

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
      setError(err instanceof Error ? err.message : "Failed to save (this demo agent isn't in the DB yet).");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="h-full overflow-y-auto overscroll-contain p-4">
      <div className="mx-auto max-w-2xl space-y-3">
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

        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Runtime &amp; schedule</h3>
          <div className="space-y-1.5">
            <Label className="text-xs">Where this agent runs</Label>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setRuntime("local")}
                className={cn("rounded-lg border p-3 text-left transition", runtime === "local" ? "border-primary/50 bg-primary/5" : "border-border hover:border-border/80")}
              >
                <div className="flex items-center gap-2">
                  <Monitor className={cn("h-4 w-4", runtime === "local" ? "text-primary" : "text-muted-foreground")} />
                  <span className="text-xs font-semibold">Local (desktop)</span>
                  {runtime === "local" && <Check className="ml-auto h-3 w-3 text-primary" />}
                </div>
                <div className="mt-1 text-[10px] text-muted-foreground">Runs on your machine via the Tauri shell. Filesystem + shell access. Private.</div>
              </button>
              <button
                onClick={() => setRuntime("hosted")}
                className={cn("rounded-lg border p-3 text-left transition", runtime === "hosted" ? "border-primary/50 bg-primary/5" : "border-border hover:border-border/80")}
              >
                <div className="flex items-center gap-2">
                  <Cloud className={cn("h-4 w-4", runtime === "hosted" ? "text-primary" : "text-muted-foreground")} />
                  <span className="text-xs font-semibold">Hosted (cloud)</span>
                  {runtime === "hosted" && <Check className="ml-auto h-3 w-3 text-primary" />}
                </div>
                <div className="mt-1 text-[10px] text-muted-foreground">Runs on Apical servers. Always-on, even when your desktop is offline.</div>
              </button>
            </div>
          </div>
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
                <Label className="text-xs">Schedule</Label>
                <Input value={schedule} onChange={(e) => setSchedule(e.target.value)} className="h-9 text-sm" placeholder="every 15 min · daily 9am" />
              </div>
            )}
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Model &amp; learning</h3>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Model</Label>
              <select value={modelPref} onChange={(e) => setModelPref(e.target.value)} className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm">
                <option value="default">Default</option>
                <option value="fast">Fast</option>
                <option value="thinking">Thinking</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Confidence</Label>
              <Input value={confidenceThreshold} onChange={(e) => setConfidenceThreshold(e.target.value)} className="h-9 text-sm" inputMode="decimal" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Auto-harden</Label>
              <Input value={autoHardenAfter} onChange={(e) => setAutoHardenAfter(e.target.value)} className="h-9 text-sm" inputMode="numeric" />
            </div>
          </div>
        </div>

        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2.5 text-xs text-destructive">{error}</div>
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
    </div>
  );
}

function StatCard({ label, value, icon: Icon, accent }: { label: string; value: string; icon: React.ComponentType<{ className?: string }>; accent: string }) {
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
