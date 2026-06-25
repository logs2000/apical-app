"use client";

import * as React from "react";
import { useAppStore } from "@/lib/apical/store";
import {
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
import {
  AgentsDataProvider,
  ORCHESTRATOR_CONVERSATION,
  conversationIdForWorkflow,
  useActiveAgent,
  useAgentsData,
} from "@/lib/apical/agents-data";
import { useToast } from "@/hooks/use-toast";
import { ApicalMark, RuntimeBadge } from "./logo";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { IS_TAURI, openAppWindow } from "@/lib/desktop/tauri-bridge";
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
  Pin,
  X,
  ChevronRight,
  ChevronDown,
  Database,
  Columns2,
  SquareStack,
} from "lucide-react";
import type { ExecutionStep } from "@/lib/apical";
import {
  loadAgentMessages,
  loadOrchestratorMessages,
  persistOrchestratorMessage,
  streamAgentThink,
  chatHistoryForApi,
  thoughtEventsFromTrace,
} from "@/lib/apical/chat-stream";
import { ChatComposer } from "./chat-composer";
import { ArtifactEditor, type ArtifactEditorInitial } from "./artifact-editor";
import { AssetCards } from "./asset-cards";
import { SandboxPanel } from "./sandbox-panel";
import { CredentialBox } from "./credential-box";
import { MarkdownText } from "./markdown-text";
import { fetchArtifactText } from "@/lib/apical/attachments";
import { sandboxItemFromAttachment } from "@/lib/apical/sandbox";
import type { ChatAttachment } from "@/lib/apical";

// ─── Helpers ────────────────────────────────────────────────────────────────

function agentStatus(agent: Workflow): { color: string; label: string } {
  if (agent.status === "paused") return { color: "bg-muted-foreground", label: "Paused" };
  if (agent.flaggedCount > 0) return { color: "bg-gate", label: "Flagged" };
  return { color: "bg-emerald-500", label: "Active" };
}

// ─── Main view: responsive 3-rail (desktop) / stacked (mobile) ─────────────
//
// DESKTOP (lg+): left rail (agent navigator) + center (chat) + right rail
// (inspector with Overview/Dashboard/Workflow/Config as collapsible sections).
// On narrow desktops (below lg), the right rail collapses to a toggle.
//
// MOBILE (below md): completely different architecture — bottom tab bar with
// Agents / Chat / Detail tabs. Each shows one pane at a time. The Detail pane
// slides up from the bottom when tapped. No 3-rail layout on mobile.

export function AgentsView() {
  // Mobile detection — below the md breakpoint, use the mobile architecture.
  const [isMobile, setIsMobile] = React.useState(false);
  React.useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  if (isMobile) {
    return (
      <AgentsDataProvider>
        <MobileAgentsView />
      </AgentsDataProvider>
    );
  }
  return (
    <AgentsDataProvider>
      <DesktopAgentsView />
    </AgentsDataProvider>
  );
}

// ─── Desktop: 3-rail layout ─────────────────────────────────────────────────

function DesktopAgentsView() {
  const activeConversationId = useAppStore((s) => s.activeConversationId);
  const setActiveConversation = useAppStore((s) => s.setActiveConversation);
  const inspectorOpen = useAppStore((s) => s.inspectorOpen);
  const toggleInspector = useAppStore((s) => s.toggleInspector);
  const sandboxOpen = useAppStore((s) => s.sandboxOpen);
  const sandboxItems = useAppStore((s) => s.sandboxItems);
  const setSandboxOpen = useAppStore((s) => s.setSandboxOpen);
  const rightRailTab = useAppStore((s) => s.rightRailTab);
  const setRightRailTab = useAppStore((s) => s.setRightRailTab);
  const clearSandbox = useAppStore((s) => s.clearSandbox);
  const { activeAgent, isOrchestrator } = useActiveAgent();

  React.useEffect(() => {
    clearSandbox();
  }, [activeConversationId, clearSandbox]);

  // The inspector only fits on wide (lg+) viewports. Below that we drop the
  // panel entirely (matching the previous `lg:flex` behavior) so the resize
  // group never has to measure a hidden panel.
  const [isWide, setIsWide] = React.useState(true);
  React.useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const update = () => setIsWide(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  // This window is a single-agent pop-out — hide the navigator rail and lock to
  // the popped-out conversation.
  const popoutConversationId = useAppStore((s) => s.popoutConversationId);
  const isPopout = !!popoutConversationId;

  const hasData = sandboxItems.length > 0;
  const showData = sandboxOpen && hasData;
  const showInspectorPanel = isWide && inspectorOpen && !!activeAgent && !isOrchestrator;
  const showRightRail = isWide && (showData || showInspectorPanel);

  return (
    <ResizablePanelGroup
      direction="horizontal"
      autoSaveId="apical-agents-layout"
      className="h-full min-h-0"
    >
      {/* Left rail — agent navigator (drag the handle to resize, persisted).
          Hidden in pop-out windows, which are focused on one agent. */}
      {!isPopout && (
        <>
          <ResizablePanel id="nav" order={1} defaultSize={18} minSize={13} maxSize={30}>
            <AgentNavigator activeId={activeConversationId} onPick={setActiveConversation} />
          </ResizablePanel>
          <ResizableHandle withHandle />
        </>
      )}

      {/* Center — chat only (no mode tabs) */}
      <ResizablePanel id="center" order={2} minSize={30} className="flex min-w-0 flex-col">
        <CenterPane
          agent={activeAgent}
          isOrchestrator={isOrchestrator}
          inspectorOpen={inspectorOpen}
          onToggleInspector={toggleInspector}
          previewOpen={showData}
          onTogglePreview={() => setSandboxOpen(!sandboxOpen)}
          hasPreviewContent={hasData}
        />
      </ResizablePanel>

      {/* Right — preview / progress data panel + agent inspector */}
      {showRightRail && (
        <>
          <ResizableHandle withHandle />
          <ResizablePanel id="right-rail" order={3} defaultSize={26} minSize={18} maxSize={42}>
            <RightRailPane
              agent={activeAgent}
              showInspector={showInspectorPanel}
              showData={showData}
              tab={rightRailTab}
              onTabChange={setRightRailTab}
            />
          </ResizablePanel>
        </>
      )}
    </ResizablePanelGroup>
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
  const { workflows, conversations, createAgent, isCreating, isLoading } = useAgentsData();
  const { toast } = useToast();

  const orchestrator = ORCHESTRATOR_CONVERSATION;
  const agentConvos = conversations.filter((c) => c.id !== "orchestrator");
  const filtered = agentConvos.filter((c) => {
    if (!search) return true;
    const wf = workflows.find((w) => w.id === c.workflowId);
    return (
      c.title.toLowerCase().includes(search.toLowerCase()) ||
      (wf?.title ?? "").toLowerCase().includes(search.toLowerCase())
    );
  });

  async function handleNewAgent() {
    try {
      const created = await createAgent();
      onPick(conversationIdForWorkflow(created.id));
    } catch (err) {
      toast({
        title: "Could not create agent",
        description: err instanceof Error ? err.message : "Something went wrong",
        variant: "destructive",
      });
    }
  }

  return (
    <aside className="flex h-full w-full min-w-0 flex-col border-r border-border bg-muted/30">
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
          onClick={() => void handleNewAgent()}
          disabled={isCreating || isLoading}
        >
          {isCreating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
          New agent
        </Button>
      </div>
      <div className="flex-1 min-h-0 space-y-3 overflow-y-auto overscroll-contain p-2">
        <div>
          <div className="px-1.5 pb-1 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">Apical</div>
          <OrchestratorRow
            convo={orchestrator}
            active={orchestrator.id === activeId}
            onClick={() => onPick(orchestrator.id)}
          />
        </div>
        <div>
          <div className="px-1.5 pb-1 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">Agents</div>
          <div className="space-y-0.5">
            {filtered.map((c) => {
              const wf = workflows.find((w) => w.id === c.workflowId);
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

// ─── Pop-out (desktop multi-window) ─────────────────────────────────────────
//
// Agents are NOT popped out by default. A user opts in by either right-clicking
// a row → "Open in new window", or dragging the row out of the window and
// dropping it outside the OS window bounds. Both paths open a focused window
// at "/#popout=<conversationId>". All of this is desktop (Tauri) only.

function openAgentPopout(conversationId: string) {
  void openAppWindow(`/#popout=${encodeURIComponent(conversationId)}`);
}

/** A drag that ends outside the window bounds pops the agent into a new window. */
function rowDragEndHandler(conversationId: string) {
  return (e: React.DragEvent) => {
    const outside =
      e.clientX <= 0 ||
      e.clientY <= 0 ||
      e.clientX >= window.innerWidth ||
      e.clientY >= window.innerHeight;
    if (outside) openAgentPopout(conversationId);
  };
}

/** Wraps a row with a right-click "Open in new window" menu (desktop only). */
function PopoutMenu({
  conversationId,
  children,
}: {
  conversationId: string;
  children: React.ReactNode;
}) {
  if (!IS_TAURI) return <>{children}</>;
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-52">
        <ContextMenuItem
          onClick={() => openAgentPopout(conversationId)}
          className="gap-2 text-xs"
        >
          <SquareStack className="h-3.5 w-3.5" /> Open in new window
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
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
    <PopoutMenu conversationId={convo.id}>
      <button
        onClick={onClick}
        draggable={IS_TAURI}
        onDragEnd={IS_TAURI ? rowDragEndHandler(convo.id) : undefined}
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
    </PopoutMenu>
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
    <PopoutMenu conversationId={convo.id}>
    <button
      onClick={onClick}
      draggable={IS_TAURI}
      onDragEnd={IS_TAURI ? rowDragEndHandler(convo.id) : undefined}
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
            <Badge variant="outline" className="shrink-0 border-gate/40 bg-gate/10 px-1 text-[8px] font-semibold text-gate">
              {agent.flaggedCount}
            </Badge>
          )}
        </div>
        <div className="truncate text-[9px] text-muted-foreground">{agent.title ?? "Agent"}</div>
      </div>
    </button>
    </PopoutMenu>
  );
}

// ─── Mobile: bottom-tab architecture ───────────────────────────────────────
//
// Completely different from desktop. Three panes (Agents / Chat / Detail),
// one visible at a time, switched via a bottom tab bar. The Detail pane is a
// slide-up sheet with Overview/Dashboard/Workflow/Config sections. No 3-rail
// layout — mobile screens are too narrow for that.

function MobileAgentsView() {
  const activeConversationId = useAppStore((s) => s.activeConversationId);
  const setActiveConversation = useAppStore((s) => s.setActiveConversation);
  const mobilePane = useAppStore((s) => s.mobilePane);
  const setMobilePane = useAppStore((s) => s.setMobilePane);
  const sandboxItems = useAppStore((s) => s.sandboxItems);
  const clearSandbox = useAppStore((s) => s.clearSandbox);
  const { activeAgent, isOrchestrator, workflows } = useActiveAgent();

  React.useEffect(() => {
    clearSandbox();
  }, [activeConversationId, clearSandbox]);

  const resultCount = sandboxItems.filter((i) => i.isResult).length;
  const hasPreview = resultCount > 0;

  // Auto-jump to Preview only when a finished RESULT lands (not for every
  // intermediate step — those stay as live updates in the chat).
  const prevResultCount = React.useRef(0);
  React.useEffect(() => {
    if (resultCount > prevResultCount.current) {
      setMobilePane("preview");
    }
    prevResultCount.current = resultCount;
  }, [resultCount, setMobilePane]);

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Top bar — current agent name + ApicalMark */}
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3">
        <ApicalMark className="h-5 w-5" />
        <span className="text-sm font-semibold">
          {isOrchestrator ? "Apical" : activeAgent?.name ?? "Agents"}
        </span>
        {activeAgent && (
          <span className="ml-auto text-[10px] text-muted-foreground">{activeAgent.title ?? "Agent"}</span>
        )}
      </header>

      {/* Pane content — one at a time */}
      <div className="min-h-0 flex-1 overflow-hidden">
        {mobilePane === "list" && (
          <MobileAgentList
            activeId={activeConversationId}
            onPick={(id) => {
              setActiveConversation(id);
              setMobilePane("chat");
            }}
          />
        )}
        {mobilePane === "chat" && (
          <ChatPane agent={activeAgent} isOrchestrator={isOrchestrator} />
        )}
        {mobilePane === "detail" && activeAgent && !isOrchestrator && (
          <MobileDetailPane agent={activeAgent} />
        )}
        {mobilePane === "preview" && hasPreview && <SandboxPanel mode="preview" showClose={false} />}
        {mobilePane === "detail" && (isOrchestrator || !activeAgent) && (
          <div className="flex h-full items-center justify-center p-4 text-center text-xs text-muted-foreground">
            Select an agent to see its details.
          </div>
        )}
        {mobilePane === "preview" && !hasPreview && (
          <div className="flex h-full items-center justify-center p-4 text-center text-xs text-muted-foreground">
            Run a task to see results here.
          </div>
        )}
      </div>

      {/* Bottom tab bar — Agents / Chat / Detail */}
      <nav className="flex h-14 shrink-0 items-center justify-around border-t border-border bg-background">
        <MobileTabButton
          active={mobilePane === "list"}
          onClick={() => setMobilePane("list")}
          icon={Boxes}
          label="Agents"
          badge={workflows.reduce((s, a) => s + a.flaggedCount, 0)}
        />
        <MobileTabButton
          active={mobilePane === "chat"}
          onClick={() => setMobilePane("chat")}
          icon={MessageSquare}
          label="Chat"
        />
        {hasPreview && (
          <MobileTabButton
            active={mobilePane === "preview"}
            onClick={() => setMobilePane("preview")}
            icon={Database}
            label="Preview"
          />
        )}
        <MobileTabButton
          active={mobilePane === "detail"}
          onClick={() => setMobilePane("detail")}
          icon={Activity}
          label="Detail"
          disabled={isOrchestrator || !activeAgent}
        />
      </nav>
    </div>
  );
}

function MobileTabButton({
  active,
  onClick,
  icon: Icon,
  label,
  badge,
  disabled,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  badge?: number;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex flex-1 flex-col items-center gap-0.5 py-1.5 text-[9px] font-medium transition-colors",
        active ? "text-primary" : "text-muted-foreground",
        disabled && "opacity-30",
      )}
    >
      <div className="relative">
        <Icon className="h-5 w-5" />
        {badge && badge > 0 ? (
          <span className="absolute -top-1 -right-2 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-gate px-1 text-[7px] font-semibold text-white">
            {badge > 99 ? "99+" : badge}
          </span>
        ) : null}
      </div>
      {label}
    </button>
  );
}

function MobileAgentList({
  activeId,
  onPick,
}: {
  activeId: string | null;
  onPick: (id: string) => void;
}) {
  const { workflows, conversations, createAgent, isCreating, isLoading } = useAgentsData();
  const { toast } = useToast();
  const orchestrator = ORCHESTRATOR_CONVERSATION;
  const agentConvos = conversations.filter((c) => c.id !== "orchestrator");

  async function handleNewAgent() {
    try {
      const created = await createAgent();
      onPick(conversationIdForWorkflow(created.id));
    } catch (err) {
      toast({
        title: "Could not create agent",
        description: err instanceof Error ? err.message : "Something went wrong",
        variant: "destructive",
      });
    }
  }

  return (
    <div className="h-full overflow-y-auto overscroll-contain p-2">
      <Button
        variant="outline"
        size="sm"
        className="mb-2 w-full gap-1.5 text-[11px]"
        onClick={() => void handleNewAgent()}
        disabled={isCreating || isLoading}
      >
        {isCreating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
        New agent
      </Button>
      {/* Orchestrator */}
      <div className="mb-2">
        <div className="px-1.5 pb-1 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">Apical</div>
        <button
          onClick={() => onPick(orchestrator.id)}
          className={cn(
            "flex w-full items-center gap-2 rounded-lg p-2.5 text-left transition-colors",
            orchestrator.id === activeId ? "bg-primary/10" : "hover:bg-accent/50",
          )}
        >
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/15 text-primary">
            <Sparkles className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">Apical</div>
            <div className="text-[10px] text-muted-foreground">General · all agents</div>
          </div>
        </button>
      </div>
      {/* Agents */}
      <div className="mb-1 px-1.5 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">Agents</div>
      <div className="space-y-1">
        {agentConvos.map((c) => {
          const wf = workflows.find((w) => w.id === c.workflowId);
          if (!wf) return null;
          const status = agentStatus(wf);
          return (
            <button
              key={c.id}
              onClick={() => onPick(c.id)}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-lg p-2.5 text-left transition-colors",
                c.id === activeId ? "bg-primary/10" : "hover:bg-accent/50",
              )}
            >
              <div className="relative shrink-0">
                <div
                  className="flex h-9 w-9 items-center justify-center rounded-full text-[11px] font-semibold text-primary-foreground"
                  style={{ backgroundColor: `oklch(${agentAvatarLightness(wf.name)} 0.06 155)` }}
                >
                  {agentInitials(wf.name)}
                </div>
                <span className={cn("absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-background", status.color)} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-medium">{wf.name}</span>
                  {wf.flaggedCount > 0 && (
                    <Badge variant="outline" className="shrink-0 border-gate/40 bg-gate/10 px-1 text-[8px] font-semibold text-gate">
                      {wf.flaggedCount}
                    </Badge>
                  )}
                </div>
                <div className="truncate text-[10px] text-muted-foreground">{wf.title ?? "Agent"}</div>
              </div>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            </button>
          );
        })}
      </div>
    </div>
  );
}

function MobileDetailPane({ agent }: { agent: Workflow }) {
  const [section, setSection] = React.useState<"overview" | "dashboard" | "workflow" | "config">("overview");
  const status = agentStatus(agent);
  const autoPct = Math.round((agent.automaticCount / Math.max(agent.itemsProcessed, 1)) * 100);

  return (
    <div className="flex h-full flex-col">
      {/* Section tabs */}
      <div className="flex shrink-0 items-center gap-0.5 border-b border-border bg-background/50 p-1">
        {(["overview", "dashboard", "workflow", "config"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setSection(s)}
            className={cn(
              "flex-1 rounded-md px-2 py-1.5 text-[11px] font-medium capitalize transition-colors",
              section === s ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent/40 hover:text-foreground",
            )}
          >
            {s}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {section === "overview" && (
          <InspectorOverview agent={agent} status={status} autoPct={autoPct} onGoSection={setSection} />
        )}
        {section === "dashboard" && <AgentDashboard agent={agent} />}
        {section === "workflow" && <AgentWorkflow agent={agent} />}
        {section === "config" && <AgentConfig agent={agent} />}
      </div>
    </div>
  );
}


function CenterPane({
  agent,
  isOrchestrator,
  inspectorOpen,
  onToggleInspector,
  previewOpen,
  onTogglePreview,
  hasPreviewContent,
}: {
  agent: Workflow | undefined;
  isOrchestrator: boolean;
  inspectorOpen: boolean;
  onToggleInspector: () => void;
  previewOpen?: boolean;
  onTogglePreview?: () => void;
  hasPreviewContent?: boolean;
}) {
  // Center pane is CHAT ONLY now — Dashboard/Workflow/Config live in the right
  // rail (InspectorPane). No mode tabs here.
  return (
    <>
      {/* Sub-header: agent identity + inspector toggle */}
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
              <div className="text-[10px] text-muted-foreground">{agent.title ?? "Agent"}</div>
            </div>
          </div>
        ) : null}

        {/* Preview + inspector toggles */}
        <div className="ml-auto flex items-center gap-1">
          {hasPreviewContent && onTogglePreview && (
            <button
              onClick={onTogglePreview}
              className={cn(
                "flex items-center gap-1 rounded-md p-1.5 transition-colors",
                previewOpen ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
              )}
              title={previewOpen ? "Hide preview" : "Show preview"}
            >
              <Database className="h-4 w-4" />
            </button>
          )}
          {!isOrchestrator && agent && (
            <button
              onClick={onToggleInspector}
              className={cn(
                "flex items-center gap-1 rounded-md p-1.5 transition-colors",
                inspectorOpen ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
              )}
              title={inspectorOpen ? "Hide inspector" : "Show inspector"}
            >
              {inspectorOpen ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
            </button>
          )}
        </div>
      </div>

      {/* Chat only */}
      <div className="min-h-0 flex-1 overflow-hidden">
        <ChatPane agent={agent} isOrchestrator={isOrchestrator} />
      </div>
    </>
  );
}

// ─── Chat pane (center) ────────────────────────────────────────────────────

function ChatPane({ agent, isOrchestrator }: { agent: Workflow | undefined; isOrchestrator: boolean }) {
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [input, setInput] = React.useState("");
  const [isThinking, setIsThinking] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [composerAttachments, setComposerAttachments] = React.useState<ChatAttachment[]>([]);
  const [editorOpen, setEditorOpen] = React.useState(false);
  const [editorInitial, setEditorInitial] = React.useState<ArtifactEditorInitial | null>(null);
  const addSandboxItem = useAppStore((s) => s.addSandboxItem);
  const { workflows } = useAgentsData();
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const abortRef = React.useRef<AbortController | null>(null);


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
          // Apical chat: the welcome summary at the top, then the orchestrator's
          // persistent running history below it. The orchestrator isn't an agent
          // (no Workflow row), so its thread lives in its own Conversation —
          // loaded via /api/orchestrator/messages so it survives reloads.
          const welcome = apicalWelcomeMessage({
            user: { name: "Jordan" },
            agents: workflows,
            lastSeenAgoHours: 6,
          });
          const history = await loadOrchestratorMessages();
          if (!cancelled) setMessages([welcome, ...history]);
        } else if (agent) {
          const history = await loadAgentMessages(agent.id);
          if (!cancelled) {
            setMessages(history.length > 0 ? history : messagesForAgent(agent));
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

  // Persist a message to the active thread (so it survives reloads). The
  // orchestrator persists to its own Conversation; agents to AgentMessage.
  async function persistMessage(msg: ChatMessage) {
    const thoughtEvents = thoughtEventsFromTrace(msg.executionTrace);
    const payload = {
      ...msg,
      events: [
        ...(msg.events ?? []).filter((e) => e.type !== "reasoning"),
        ...thoughtEvents,
      ],
    };
    if (isOrchestrator) {
      await persistOrchestratorMessage(payload);
      return;
    }
    if (!agent) return;
    try {
      await fetch(`/api/agents/${agent.id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role: payload.role,
          content: payload.content,
          events: payload.events,
        }),
      });
    } catch {
      // non-fatal — the message is already in local state
    }
  }

  function stopTurn() {
    abortRef.current?.abort();
  }

  // One natural turn. The agent plans internally, converses, and uses tools /
  // does the work as needed — no plan-vs-do mode. The same message shows the
  // live thinking/tool trace and then the final answer, so it reads naturally.
  async function runTurn(
    text: string,
    priorMessages: ChatMessage[],
    turnAttachments: ChatAttachment[] = [],
  ) {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setIsThinking(true);
    const replyId = Math.random().toString(36).slice(2);
    const replyMsg: ChatMessage = {
      id: replyId,
      role: "agent",
      content: "",
      createdAt: new Date().toISOString(),
    };
    setMessages((m) => [...m, replyMsg]);

    try {
      const agentContext = agent
        ? `You are acting as the agent "${agent.name}"${agent.title ? ` (${agent.title})` : ""}. What it does: ${agent.description}`
        : undefined;
      const result = await streamAgentThink(text, {
        context: agentContext,
        history: chatHistoryForApi(priorMessages, true),
        agentId: agent?.id ?? null,
        attachments: turnAttachments,
        allowCli: IS_TAURI,
        isDesktop: IS_TAURI,
        maxIterations: 18,
        signal: controller.signal,
        onTraceUpdate: (trace) => {
          setMessages((prev) =>
            prev.map((m) => (m.id === replyId ? { ...m, executionTrace: trace } : m)),
          );
        },
        onSandboxItem: addSandboxItem,
      });

      const finalContent =
        result.finalAnswer?.trim() ||
        "I couldn't produce a response. Please try again.";
      if (!finalContent) {
        throw new Error("No response from the assistant.");
      }
      const producedAttachments: ChatAttachment[] | undefined = result.attachments?.map((a) => ({
        id: a.id,
        name: a.name,
        mimeType: a.mimeType,
        kind: (a.kind as ChatAttachment["kind"]) || "file",
        url: a.url,
        sizeBytes: a.sizeBytes,
      }));

      // Surface produced files in Preview as downloadable deliverables.
      for (const att of result.attachments ?? []) {
        addSandboxItem(sandboxItemFromAttachment(att));
      }

      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === replyId
            ? {
                ...msg,
                content: finalContent,
                executionTrace: result.trace,
                attachments: producedAttachments,
                ...(result.credentialRequest
                  ? { credentialRequest: result.credentialRequest }
                  : {}),
                ...(result.workflowSavedToAgentId
                  ? { workflowSaved: { agentName: agent?.name ?? "this agent" } }
                  : {}),
                // Only offer to create a NEW agent when the agent proposed a
                // fresh workflow (orchestrator). When it saved to its own
                // workflow, proposedWorkflow is undefined → no offer.
                ...(result.proposedWorkflow
                  ? {
                      automateOffer: {
                        traceId: replyId,
                        summary: "I froze what worked into a reusable workflow.",
                        name: agent?.name ?? "Agent",
                        steps: result.proposedWorkflow,
                      },
                    }
                  : {}),
              }
            : msg,
        ),
      );
      // Persist the finished message (content only — the verbose live trace is
      // ephemeral and not re-rendered from history).
      void persistMessage({
        ...replyMsg,
        content: finalContent,
        executionTrace: result.trace,
        attachments: producedAttachments,
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === replyId
              ? {
                  ...msg,
                  content: msg.content.trim() || "Stopped.",
                }
              : msg,
          ),
        );
        return;
      }
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === replyId
            ? {
                ...msg,
                content: `(Something went wrong — ${(err as Error).message}. Check that an LLM provider is configured in Settings.)`,
              }
            : msg,
        ),
      );
    } finally {
      setIsThinking(false);
      if (abortRef.current === controller) abortRef.current = null;
    }
  }

  async function openArtifactForEdit(asset: ChatAttachment) {
    try {
      const text = await fetchArtifactText(asset.id);
      setEditorInitial({ name: asset.name, content: text, assetId: asset.id });
      setEditorOpen(true);
    } catch (err) {
      console.error(err);
    }
  }

  function send(payload: { text: string; attachments?: ChatAttachment[] }) {
    const text = payload.text.trim();
    const attachments = payload.attachments ?? [];
    if ((!text && attachments.length === 0) || isThinking) return;

    const content =
      text ||
      (attachments.length === 1
        ? `[Attached ${attachments[0].name}]`
        : `[Attached ${attachments.length} files]`);

    const userMsg: ChatMessage = {
      id: Math.random().toString(36).slice(2),
      role: "user",
      content,
      attachments: attachments.length ? attachments : undefined,
      createdAt: new Date().toISOString(),
    };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setInput("");
    void persistMessage(userMsg);
    void runTurn(text || content, nextMessages, attachments);
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
          <EmptyState onPick={(p) => send({ text: p })} />
        )}
        {messages.map((m, i) => (
          <MessageBubble
            key={m.id}
            message={m}
            agentName={isOrchestrator ? "Apical" : agent?.name ?? "Agent"}
            isStreaming={isThinking && i === messages.length - 1 && m.role === "agent"}
            onEditArtifact={openArtifactForEdit}
            onCredentialSaved={(info) =>
              send({
                text: `I've saved the ${info.label} to the vault. Please continue.`,
              })
            }
          />
        ))}
        {isThinking && messages[messages.length - 1]?.role !== "agent" && (
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

      <ChatComposer
        value={input}
        onChange={setInput}
        disabled={isThinking}
        working={isThinking}
        onStop={stopTurn}
        attachments={composerAttachments}
        onAttachmentsChange={setComposerAttachments}
        placeholder={
          isOrchestrator
            ? "Message Apical — ask anything or attach files…"
            : `Message ${agent?.name ?? "this agent"}…`
        }
        onSend={send}
      />

      <ArtifactEditor
        open={editorOpen}
        onClose={() => {
          setEditorOpen(false);
          setEditorInitial(null);
        }}
        agentId={agent?.id ?? null}
        initialFile={editorInitial}
        onSaved={(asset) =>
          setComposerAttachments((prev) =>
            prev.some((a) => a.id === asset.id) ? prev : [...prev, asset],
          )
        }
      />
    </div>
  );
}


function MessageBubble({
  message,
  agentName,
  isStreaming,
  onEditArtifact,
  onCredentialSaved,
}: {
  message: ChatMessage;
  agentName: string;
  isStreaming?: boolean;
  onEditArtifact?: (a: ChatAttachment) => void;
  onCredentialSaved?: (info: { label: string; service: string }) => void;
}) {
  const isUser = message.role === "user";
  // Flat block style — no bubbles.
  // User messages: a neutral slate-gray block (bg-muted), left-aligned, full-width-ish.
  // Agent messages: no bubble at all — plain text on the page background, with a
  // small agent-name label above for context.
  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] space-y-1">
          <div className="rounded-md bg-[oklch(0.42_0.025_155)] px-3 py-2 text-sm text-white">
            <MarkdownText text={message.content} isUser />
          </div>
          {message.attachments && message.attachments.length > 0 && (
            <AssetCards attachments={message.attachments} onEdit={onEditArtifact} />
          )}
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
        {isStreaming && (
          <span className="flex items-center gap-1 text-primary">
            <Loader2 className="h-3 w-3 animate-spin" />
            Working…
          </span>
        )}
      </div>
      {message.executionTrace && message.executionTrace.length > 0 && (
        <ChatProgress steps={message.executionTrace} live={!!isStreaming} />
      )}
      <div className="text-sm text-foreground">
        {message.content ? (
          <MarkdownText text={message.content} />
        ) : isStreaming ? null : (
          <span className="text-muted-foreground italic">…</span>
        )}
      </div>
      {message.attachments && message.attachments.length > 0 && (
        <AssetCards attachments={message.attachments} onEdit={onEditArtifact} />
      )}
      {message.credentialRequest && (
        <CredentialBox request={message.credentialRequest} onSaved={onCredentialSaved} />
      )}
      {message.workflowSaved && (
        <div className="mt-2 flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary/5 px-2.5 py-1.5 text-[11px] text-muted-foreground">
          <Save className="h-3 w-3 text-primary" />
          Updated <span className="font-medium text-foreground">{message.workflowSaved.agentName}</span>&rsquo;s own workflow.
        </div>
      )}
      {message.workflowProposal && (
        <div className="mt-2 rounded-md border border-primary/30 bg-primary/5 p-2.5 text-xs">
          <div className="mb-1 font-semibold text-primary">Proposed workflow: {message.workflowProposal.name}</div>
          <div className="text-muted-foreground">{message.workflowProposal.description}</div>
          <div className="mt-1.5 text-[10px] text-muted-foreground">{message.workflowProposal.steps.steps.length} steps</div>
        </div>
      )}
      {message.automateOffer && (
        <div className="mt-2 rounded-md border border-primary/30 bg-primary/5 p-2.5 text-xs">
          <div className="mb-1 font-semibold text-primary">Automate this?</div>
          <p className="text-muted-foreground">{message.automateOffer.summary}</p>
          <div className="mt-1.5 text-[10px] text-muted-foreground">
            {message.automateOffer.steps.steps.length} steps
          </div>
        </div>
      )}
      <div className="text-[10px] text-muted-foreground">
        {new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
      </div>
    </div>
  );
}

// Lightweight in-chat thinking feed — shows reasoning only (not tool calls).
// Detailed tool activity lives in the Progress sidebar panel.
function ChatProgress({ steps, live }: { steps: ExecutionStep[]; live: boolean }) {
  const thoughts = React.useMemo(
    () => steps.filter((s) => s.tool === "reason"),
    [steps],
  );
  const [open, setOpen] = React.useState(true);
  React.useEffect(() => {
    if (!live) setOpen(false);
  }, [live]);

  if (thoughts.length === 0) return null;

  const latest = thoughts[thoughts.length - 1];

  return (
    <div className="rounded-md border border-border/70 bg-muted/30">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-[11px] font-medium text-muted-foreground hover:text-foreground"
      >
        {open ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
        {live ? (
          <Loader2 className="h-3 w-3 shrink-0 animate-spin text-primary" />
        ) : (
          <Brain className="h-3 w-3 shrink-0 text-reason" />
        )}
        <span className="truncate">
          {open
            ? live
              ? "Thinking…"
              : `${thoughts.length} update${thoughts.length === 1 ? "" : "s"}`
            : live && latest
              ? (latest.result || latest.action).slice(0, 100)
              : `${thoughts.length} update${thoughts.length === 1 ? "" : "s"}`}
        </span>
      </button>
      {open && (
        <div className="space-y-1.5 border-t border-border/60 px-2.5 py-2">
          {thoughts.map((step) => (
            <div key={step.id} className="flex items-start gap-1.5 text-[11px]">
              <Brain className="mt-0.5 h-3 w-3 shrink-0 text-reason" />
              <span className="italic text-muted-foreground">{step.result || step.action}</span>
            </div>
          ))}
        </div>
      )}
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

// ─── Right rail: preview sandbox + agent inspector ─────────────────────────

function RightRailPane({
  agent,
  showInspector,
  showData,
  tab,
  onTabChange,
}: {
  agent?: Workflow;
  showInspector: boolean;
  showData: boolean;
  tab: "preview" | "progress" | "inspector";
  onTabChange: (t: "preview" | "progress" | "inspector") => void;
}) {
  const sandboxItems = useAppStore((s) => s.sandboxItems);
  const hasResults = sandboxItems.some((i) => i.isResult);

  // Build the available tabs in display order.
  const tabs: Array<{ key: "preview" | "progress" | "inspector"; label: string }> = [];
  if (showData) {
    tabs.push({ key: "progress", label: "Progress" });
    tabs.push({ key: "preview", label: "Preview" });
  }
  if (showInspector && agent) tabs.push({ key: "inspector", label: "Agent" });

  // Progress is default; only land on Preview when there are actual results.
  const activeTab = (() => {
    if (tab === "preview" && !hasResults) return "progress";
    return tabs.some((t) => t.key === tab) ? tab : tabs[0]?.key;
  })();

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden border-l border-border">
      {tabs.length > 1 && (
        <div className="flex shrink-0 items-center gap-0.5 border-b border-border bg-background/50 p-1">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => onTabChange(t.key)}
              className={cn(
                "flex-1 rounded-md px-2 py-1 text-[10px] font-medium transition-colors",
                activeTab === t.key ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent/40",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-hidden">
        {activeTab === "preview" && showData && <SandboxPanel mode="preview" showClose={tabs.length === 1} className="border-l-0" />}
        {activeTab === "progress" && showData && <SandboxPanel mode="progress" showClose={tabs.length === 1} className="border-l-0" />}
        {activeTab === "inspector" && showInspector && agent && <InspectorPane agent={agent} embedded />}
      </div>
    </div>
  );
}

// ─── Right pane: inspector ─────────────────────────────────────────────────

function InspectorPane({ agent, embedded }: { agent: Workflow; embedded?: boolean }) {
  const [section, setSection] = React.useState<"overview" | "dashboard" | "workflow" | "config">("overview");
  const status = agentStatus(agent);
  const autoPct = Math.round((agent.automaticCount / Math.max(agent.itemsProcessed, 1)) * 100);

  return (
    <aside className={cn("flex h-full w-full min-w-0 flex-col overflow-hidden bg-muted/30", !embedded && "border-l border-border")}>
      {/* Section switcher — Overview / Dashboard / Workflow / Config as tabs WITHIN the right rail */}
      <div className="flex shrink-0 items-center gap-0.5 border-b border-border bg-background/50 p-1">
        {(["overview", "dashboard", "workflow", "config"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setSection(s)}
            className={cn(
              "flex-1 rounded-md px-2 py-1 text-[10px] font-medium capitalize transition-colors",
              section === s ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent/40 hover:text-foreground",
            )}
          >
            {s}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {section === "overview" && <InspectorOverview agent={agent} status={status} autoPct={autoPct} onGoSection={setSection} />}
        {section === "dashboard" && <AgentDashboard agent={agent} />}
        {section === "workflow" && <AgentWorkflow agent={agent} />}
        {section === "config" && <AgentConfig agent={agent} />}
      </div>
    </aside>
  );
}

function InspectorOverview({
  agent,
  status,
  autoPct,
  onGoSection,
}: {
  agent: Workflow;
  status: { color: string; label: string };
  autoPct: number;
  onGoSection: (s: "overview" | "dashboard" | "workflow" | "config") => void;
}) {
  return (
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

      {/* LOUD flagged button */}
      {agent.flaggedCount > 0 && (
        <button
          onClick={() => onGoSection("dashboard")}
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
          <button onClick={() => onGoSection("workflow")} className="text-[10px] text-primary hover:underline">View →</button>
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
          <button onClick={() => onGoSection("dashboard")} className="text-[10px] text-primary hover:underline">Full dashboard →</button>
        </div>
        <div className="grid grid-cols-2 gap-2 text-[10px]">
          <div><div className="text-muted-foreground">Processed</div><div className="font-semibold tabular-nums">{agent.itemsProcessed.toLocaleString()}</div></div>
          <div><div className="text-muted-foreground">Automatic</div><div className="font-semibold tabular-nums">{autoPct}%</div></div>
          <div><div className="text-muted-foreground">Flagged</div><div className="font-semibold tabular-nums text-gate">{agent.flaggedCount.toLocaleString()}</div></div>
          <div><div className="text-muted-foreground">Runs</div><div className="font-semibold tabular-nums">{agent.runsCount}</div></div>
        </div>
      </div>

      {/* Recent runs (mocked) */}
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
              <div className={cn("h-1.5 w-1.5 rounded-full", r.status === "completed" && "bg-emerald-500", r.status === "running" && "bg-primary", r.status === "failed" && "bg-destructive")} />
              <span className="capitalize">{r.status}</span>
              <span className="text-muted-foreground">· {r.items} items</span>
              <span className="ml-auto text-muted-foreground">{r.when}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Quick links to other sections */}
      <div className="flex flex-col gap-1">
        <button onClick={() => onGoSection("dashboard")} className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-left text-[11px] hover:border-primary/30">
          <Activity className="h-3.5 w-3.5 text-muted-foreground" /> Full dashboard
          <ChevronRight className="ml-auto h-3 w-3 text-muted-foreground" />
        </button>
        <button onClick={() => onGoSection("config")} className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-left text-[11px] hover:border-primary/30">
          <ShieldCheck className="h-3.5 w-3.5 text-muted-foreground" /> Edit config
          <ChevronRight className="ml-auto h-3 w-3 text-muted-foreground" />
        </button>
      </div>
    </div>
  );
}


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
  const [title, setTitle] = React.useState(agent.title ?? "");
  const [description, setDescription] = React.useState(agent.description);
  const [trigger, setTrigger] = React.useState<"manual" | "schedule">(agent.trigger);
  const [schedule, setSchedule] = React.useState(agent.schedule ?? "");
  const [runtime, setRuntime] = React.useState<AgentRuntime>(agent.runtime);
  const [modelPref, setModelPref] = React.useState(agent.modelPreference ?? "");
  const [availableModels, setAvailableModels] = React.useState<Array<{ id: string; name: string; provider: string }>>([]);
  const [confidenceThreshold, setConfidenceThreshold] = React.useState("0.85");
  const [autoHardenAfter, setAutoHardenAfter] = React.useState("50");
  const [saving, setSaving] = React.useState(false);
  const [savedAt, setSavedAt] = React.useState<Date | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    void fetch("/api/llm/models")
      .then((r) => r.json())
      .then((data: { models?: Array<{ id: string; name: string; provider: string; tier: string; configured?: boolean }> }) => {
        const hosted = (data.models ?? []).filter((m) => m.tier === "hosted" && m.configured !== false);
        setAvailableModels(hosted.map((m) => ({ id: m.id, name: m.name, provider: m.provider })));
      })
      .catch(() => setAvailableModels([]));
  }, []);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/workflows/${agent.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          title: title.trim() || null,
          description,
          trigger,
          schedule: trigger === "schedule" ? schedule.trim() || null : null,
          runtime,
          modelPreference: modelPref.trim() || null,
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
            <div className="space-y-1.5 sm:col-span-2">
              <Label className="text-xs">Title</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} className="h-9 text-sm" placeholder="e.g. Filing Agent" />
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
                <option value="">Default (first available)</option>
                {availableModels.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({m.provider})
                  </option>
                ))}
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
