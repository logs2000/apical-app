"use client";

import * as React from "react";
import { useAppStore } from "@/lib/apical/store";
import {
  DEFAULT_PROMPTS,
  agentWelcomeMessage,
  relativeTime,
  formatDuration,
  STEP_KIND_META,
  type ChatMessage,
  type Workflow,
  type AgentRuntime,
} from "@/lib/apical";
import { formatSendError, isSendError, isRetryableSendError } from "@/lib/apical/send-error";
import { SendFailureNotice } from "./send-failure-notice";
import {
  AgentsDataProvider,
  NEW_CHAT_CONVERSATION_ID,
  conversationIdForWorkflow,
  useActiveAgent,
  useAgentsData,
  sortSidebarConversations,
} from "@/lib/apical/agents-data";
import { agentWorkflowRingClass, buildEditHandoffPrompt, agentHasSavedWorkflow } from "@/lib/apical/agent-display";
import { routeAgentMessage } from "@/lib/apical/agent-route";
import { useToast } from "@/hooks/use-toast";
import { ApicalMark, RuntimeBadge, AgentAvatar, FlaggedCountBadge } from "./logo";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { IS_TAURI, openAppWindow, desktopPopoutPath } from "@/lib/desktop/tauri-bridge";
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
  Pin,
  Trash2,
  X,
  ChevronRight,
  ChevronDown,
  Database,
  Columns2,
  SquareStack,
} from "lucide-react";
import {
  mapPersistedMessages,
  streamAgentThink,
  chatHistoryForApi,
  eventsForPersistedMessage,
  analyzeRun,
  buildChatRun,
  automationSaveSucceeded,
} from "@/lib/apical/chat-stream";
import { ChatComposer } from "./chat-composer";
import { workflowStepDetail, workflowStepToolLabel } from "@/lib/apical/workflow-display";
import { ArtifactEditor, type ArtifactEditorInitial } from "./artifact-editor";
import { AssetCards } from "./asset-cards";
import { SandboxPanel } from "./sandbox-panel";
import { CredentialBox } from "./credential-box";
import { AgentChecklist } from "./agent-checklist";
import { ClarificationCard } from "./clarification-card";
import { MarkdownText } from "./markdown-text";
import { CopyMessageButton } from "./copy-message-button";
import { RunTimeline } from "./run-timeline";
import { AgentRunSection, RunLog, RunNowControls } from "./workflow-runs-console";
import { fetchArtifactText } from "@/lib/apical/attachments";
import { sandboxItemFromAttachment } from "@/lib/apical/sandbox";
import type { ChatAttachment } from "@/lib/apical";
import { useQueryClient } from "@tanstack/react-query";
import { useAgentMessages } from "@/lib/queries";
import { useAuth } from "@/components/auth/AuthDialog";

// ─── Helpers ────────────────────────────────────────────────────────────────

function agentStatus(agent: Workflow): { color: string; label: string } {
  if (agent.status === "paused") return { color: "bg-muted-foreground", label: "Paused" };
  if (agent.flaggedCount > 0) return { color: "bg-gate", label: "Flagged" };
  return { color: "bg-foreground", label: "Active" };
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
  const { activeAgent, isNewChat } = useActiveAgent();

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

  // Pop-out windows get a descriptive title in the OS window chrome.
  React.useEffect(() => {
    if (!IS_TAURI || !isPopout) return;
    const title = isNewChat
      ? "New chat"
      : activeAgent?.name
        ? `${activeAgent.name} — Apical`
        : "Apical";
    void import("@tauri-apps/api/window").then(({ getCurrentWindow }) => {
      void getCurrentWindow().setTitle(title);
    });
  }, [isPopout, isNewChat, activeAgent?.name]);

  const hasData = sandboxItems.length > 0;
  const showData = sandboxOpen && hasData;
  const showInspectorPanel = isWide && inspectorOpen && !!activeAgent && !isNewChat;
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
          isNewChat={isNewChat}
          conversationId={activeConversationId}
          isPopout={isPopout}
          inspectorOpen={inspectorOpen}
          onToggleInspector={toggleInspector}
          showInspectorToggle={isWide}
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
  const { workflows, conversations, deleteAgent, togglePin, isLoading } = useAgentsData();
  const { toast } = useToast();
  const [deleteTarget, setDeleteTarget] = React.useState<{ id: string; name: string } | null>(null);

  const agentConvos = sortSidebarConversations(conversations);
  const filtered = sortSidebarConversations(
    agentConvos.filter((c) => {
      if (!search) return true;
      const wf = workflows.find((w) => w.id === c.workflowId);
      return (
        c.title.toLowerCase().includes(search.toLowerCase()) ||
        (wf?.title ?? "").toLowerCase().includes(search.toLowerCase())
      );
    }),
  );
  const pinnedAgents = filtered.filter((c) => c.pinned);
  const recentAgents = filtered.filter((c) => !c.pinned);

  async function handleDeleteAgent(workflowId: string, name: string) {
    const convoId = conversationIdForWorkflow(workflowId);
    try {
      await deleteAgent(workflowId);
      if (activeId === convoId) {
        onPick(NEW_CHAT_CONVERSATION_ID);
      }
      toast({ title: "Agent deleted", description: `${name} was removed.` });
      setDeleteTarget(null);
    } catch (err) {
      toast({
        title: "Could not delete agent",
        description: err instanceof Error ? err.message : "Something went wrong",
        variant: "warning",
      });
    }
  }

  function handleNewChat() {
    onPick(NEW_CHAT_CONVERSATION_ID);
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
          variant="default"
          size="sm"
          className="mt-1.5 w-full justify-start gap-1.5 text-[11px]"
          onClick={handleNewChat}
        >
          <Plus className="h-3 w-3" />
          New chat
        </Button>
        {IS_TAURI && (
          <p className="mt-2 px-1 text-[9px] leading-relaxed text-muted-foreground">
            Drag an agent outside this window, click{" "}
            <SquareStack className="inline h-2.5 w-2.5 align-text-bottom" />, or right-click
            to open in a separate window.
          </p>
        )}
      </div>
      <div className="flex-1 min-h-0 space-y-3 overflow-y-auto overscroll-contain p-2">
        <div className="space-y-3">
          {pinnedAgents.length > 0 && (
            <div>
              <div className="px-1.5 pb-1 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
                Pinned
              </div>
              <div className="space-y-0.5">
                {pinnedAgents.map((c) => {
                  const wf = workflows.find((w) => w.id === c.workflowId);
                  if (!wf) return null;
                  return (
                    <AgentRailRow
                      key={c.id}
                      convo={c}
                      agent={wf}
                      active={c.id === activeId}
                      onClick={() => onPick(c.id)}
                      onTogglePin={() => togglePin(c.id)}
                      onDelete={() => setDeleteTarget({ id: wf.id, name: wf.name })}
                    />
                  );
                })}
              </div>
            </div>
          )}
          {recentAgents.length > 0 && (
            <div>
              <div className="px-1.5 pb-1 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
                {pinnedAgents.length > 0 ? "Recent" : "Agents"}
              </div>
              <div className="space-y-0.5">
                {recentAgents.map((c) => {
                  const wf = workflows.find((w) => w.id === c.workflowId);
                  if (!wf) return null;
                  return (
                    <AgentRailRow
                      key={c.id}
                      convo={c}
                      agent={wf}
                      active={c.id === activeId}
                      onClick={() => onPick(c.id)}
                      onTogglePin={() => togglePin(c.id)}
                      onDelete={() => setDeleteTarget({ id: wf.id, name: wf.name })}
                    />
                  );
                })}
              </div>
            </div>
          )}
          {filtered.length === 0 && !isLoading && (
            <p className="px-1.5 py-2 text-[10px] text-muted-foreground">No agents match your search.</p>
          )}
        </div>
      </div>
      <DeleteAgentDialog
        target={deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        onConfirm={() => deleteTarget && void handleDeleteAgent(deleteTarget.id, deleteTarget.name)}
      />
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
  void openAppWindow(desktopPopoutPath(conversationId));
}

/** A drag that ends outside the window bounds pops the agent into a new window. */
function rowDragStartHandler() {
  return (e: React.DragEvent) => {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", "apical-agent-popout");
  };
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

/** Wraps a row with pin/delete actions and optional desktop pop-out menu. */
function AgentRowMenu({
  conversationId,
  pinned,
  canDelete,
  onTogglePin,
  onDelete,
  children,
}: {
  conversationId: string;
  pinned: boolean;
  canDelete?: boolean;
  onTogglePin: () => void;
  onDelete?: () => void;
  children: React.ReactNode;
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-52">
        <ContextMenuItem onClick={onTogglePin} className="gap-2 text-xs">
          <Pin className={cn("h-3.5 w-3.5", pinned && "fill-current")} />
          {pinned ? "Unpin" : "Pin"}
        </ContextMenuItem>
        {IS_TAURI && (
          <ContextMenuItem
            onClick={() => openAgentPopout(conversationId)}
            className="gap-2 text-xs"
          >
            <SquareStack className="h-3.5 w-3.5" /> Open in new window
          </ContextMenuItem>
        )}
        {canDelete && onDelete && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={onDelete} className="gap-2 text-xs text-destructive focus:text-destructive">
              <Trash2 className="h-3.5 w-3.5" /> Delete agent
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}

function DeleteAgentDialog({
  target,
  onOpenChange,
  onConfirm,
}: {
  target: { id: string; name: string } | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={!!target} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {target?.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            This removes the agent, its chat history, runs, and saved data. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function RailRowActions({
  conversationId,
  pinned,
  canDelete,
  onTogglePin,
  onDelete,
}: {
  conversationId: string;
  pinned: boolean;
  canDelete?: boolean;
  onTogglePin: () => void;
  onDelete?: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <button
        type="button"
        title={pinned ? "Unpin" : "Pin"}
        onClick={(e) => {
          e.stopPropagation();
          onTogglePin();
        }}
        className={cn(
          "rounded p-0.5 transition-opacity transition-colors",
          pinned
            ? "text-foreground opacity-100"
            : "text-muted-foreground opacity-0 hover:bg-surface-hover hover:text-foreground group-hover:opacity-100 group-focus-within:opacity-100",
        )}
      >
        <Pin className={cn("h-3 w-3", pinned && "fill-current")} />
      </button>
      {IS_TAURI && <PopoutButton conversationId={conversationId} />}
      {canDelete && onDelete && (
        <button
          type="button"
          title="Delete agent"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100 group-focus-within:opacity-100"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}


function PopoutButton({ conversationId }: { conversationId: string }) {
  return (
    <button
      type="button"
      title="Open in new window"
      onClick={(e) => {
        e.stopPropagation();
        openAgentPopout(conversationId);
      }}
      className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-surface-hover hover:text-foreground group-hover:opacity-100"
    >
      <SquareStack className="h-3 w-3" />
    </button>
  );
}

function AgentRailRow({
  convo,
  agent,
  active,
  onClick,
  onTogglePin,
  onDelete,
}: {
  convo: { id: string; title: string; pinned?: boolean };
  agent: Workflow;
  active: boolean;
  onClick: () => void;
  onTogglePin: () => void;
  onDelete: () => void;
}) {
  const ringClass = agentWorkflowRingClass(agent);
  return (
    <AgentRowMenu
      conversationId={convo.id}
      pinned={!!convo.pinned}
      canDelete
      onTogglePin={onTogglePin}
      onDelete={onDelete}
    >
    <div
      draggable={IS_TAURI}
      onDragStart={IS_TAURI ? rowDragStartHandler() : undefined}
      onDragEnd={IS_TAURI ? rowDragEndHandler(convo.id) : undefined}
      className={cn(
        "group flex w-full items-center gap-2 rounded-md px-2 py-1.5 transition-colors",
        active ? "bg-surface-active text-foreground" : "text-muted-foreground hover:bg-surface-hover hover:text-foreground",
      )}
    >
      <button
        type="button"
        onClick={onClick}
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
      >
        <div className="relative shrink-0">
          <AgentAvatar name={agent.name} className={cn("h-6 w-6", ringClass)} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1">
            <span className="truncate text-[11px] font-medium">{convo.title}</span>
            <FlaggedCountBadge count={agent.flaggedCount} />
          </div>
          <div className="truncate text-[9px] text-muted-foreground">{agent.title ?? "Agent"}</div>
        </div>
      </button>
      <RailRowActions
        conversationId={convo.id}
        pinned={!!convo.pinned}
        canDelete
        onTogglePin={onTogglePin}
        onDelete={onDelete}
      />
    </div>
    </AgentRowMenu>
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
  const { activeAgent, isNewChat, workflows } = useActiveAgent();

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
      {/* Top bar — current agent name (no logo on desktop) */}
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3">
        {!IS_TAURI && <ApicalMark className="h-5 w-5" />}
        <span className="text-sm font-semibold">
          {isNewChat ? "New chat" : activeAgent?.name ?? "Agents"}
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
          <ChatPane
            key={isNewChat ? NEW_CHAT_CONVERSATION_ID : activeAgent?.id ?? "pending-agent"}
            agent={activeAgent}
            isNewChat={isNewChat}
          />
        )}
        {mobilePane === "detail" && activeAgent && !isNewChat && (
          <MobileDetailPane agent={activeAgent} />
        )}
        {mobilePane === "preview" && hasPreview && <SandboxPanel mode="preview" showClose={false} />}
        {mobilePane === "detail" && (isNewChat || !activeAgent) && (
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
          disabled={isNewChat || !activeAgent}
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
        active ? "text-foreground" : "text-muted-foreground",
        disabled && "opacity-30",
      )}
    >
      <div className="relative">
        <Icon className="h-5 w-5" />
        {badge && badge > 0 ? (
          <span className="absolute -top-1 -right-2 flex h-3.5 min-w-3.5 items-center justify-center rounded-full border border-amber-600/70 bg-amber-500 px-1 text-[7px] font-bold leading-none text-amber-950">
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
  const { workflows, conversations, deleteAgent, togglePin, isLoading } = useAgentsData();
  const { toast } = useToast();
  const [deleteTarget, setDeleteTarget] = React.useState<{ id: string; name: string } | null>(null);
  const agentConvos = sortSidebarConversations(conversations);
  const pinnedAgents = agentConvos.filter((c) => c.pinned);
  const recentAgents = agentConvos.filter((c) => !c.pinned);

  function handleNewChat() {
    onPick(NEW_CHAT_CONVERSATION_ID);
  }

  async function handleDeleteAgent(workflowId: string, name: string) {
    const convoId = conversationIdForWorkflow(workflowId);
    try {
      await deleteAgent(workflowId);
      if (activeId === convoId) {
        onPick(NEW_CHAT_CONVERSATION_ID);
      }
      toast({ title: "Agent deleted", description: `${name} was removed.` });
      setDeleteTarget(null);
    } catch (err) {
      toast({
        title: "Could not delete agent",
        description: err instanceof Error ? err.message : "Something went wrong",
        variant: "warning",
      });
    }
  }

  function renderAgentRow(c: (typeof agentConvos)[number]) {
    const wf = workflows.find((w) => w.id === c.workflowId);
    if (!wf) return null;
    const ringClass = agentWorkflowRingClass(wf);
    return (
      <AgentRowMenu
        key={c.id}
        conversationId={c.id}
        pinned={!!c.pinned}
        canDelete
        onTogglePin={() => togglePin(c.id)}
        onDelete={() => setDeleteTarget({ id: wf.id, name: wf.name })}
      >
        <div
          className={cn(
            "group flex w-full items-center gap-2.5 rounded-lg p-2.5 transition-colors",
            c.id === activeId ? "bg-surface-active" : "hover:bg-surface-hover",
          )}
        >
          <button
            type="button"
            onClick={() => onPick(c.id)}
            className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
          >
            <div className="relative shrink-0">
              <AgentAvatar name={wf.name} className={cn("h-9 w-9", ringClass)} textClassName="text-[11px] font-semibold" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-sm font-medium">{wf.name}</span>
                <FlaggedCountBadge count={wf.flaggedCount} />
              </div>
              <div className="truncate text-[10px] text-muted-foreground">{wf.title ?? "Agent"}</div>
            </div>
          </button>
          <RailRowActions
            conversationId={c.id}
            pinned={!!c.pinned}
            canDelete
            onTogglePin={() => togglePin(c.id)}
            onDelete={() => setDeleteTarget({ id: wf.id, name: wf.name })}
          />
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        </div>
      </AgentRowMenu>
    );
  }

  return (
    <div className="h-full overflow-y-auto overscroll-contain p-2">
      <Button
        variant="default"
        size="sm"
        className="mb-2 w-full gap-1.5 text-[11px]"
        onClick={handleNewChat}
      >
        <Plus className="h-3 w-3" />
        New chat
      </Button>
      {pinnedAgents.length > 0 && (
        <div className="mb-2">
          <div className="mb-1 px-1.5 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">Pinned</div>
          <div className="space-y-1">{pinnedAgents.map(renderAgentRow)}</div>
        </div>
      )}
      {recentAgents.length > 0 && (
        <div>
          <div className="mb-1 px-1.5 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
            {pinnedAgents.length > 0 ? "Recent" : "Agents"}
          </div>
          <div className="space-y-1">{recentAgents.map(renderAgentRow)}</div>
        </div>
      )}
      <DeleteAgentDialog
        target={deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        onConfirm={() => deleteTarget && void handleDeleteAgent(deleteTarget.id, deleteTarget.name)}
      />
    </div>
  );
}

function MobileDetailPane({ agent }: { agent: Workflow }) {
  const [section, setSection] = React.useState<"overview" | "dashboard" | "workflow" | "config" | "runs">("overview");
  const status = agentStatus(agent);
  const autoPct = Math.round((agent.automaticCount / Math.max(agent.itemsProcessed, 1)) * 100);

  return (
    <div className="flex h-full flex-col">
      {/* Section tabs */}
      <div className="flex shrink-0 items-center gap-0.5 border-b border-border bg-background/50 p-1">
        {(["overview", "dashboard", "workflow", "config", "runs"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setSection(s)}
            className={cn(
              "flex-1 rounded-md px-2 py-1.5 text-[11px] font-medium capitalize transition-colors",
              section === s ? "bg-surface-active text-foreground" : "text-muted-foreground hover:bg-surface-hover hover:text-foreground",
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
        {section === "runs" && (
          <div className="p-3">
            <AgentRunSection workflowId={agent.id} />
          </div>
        )}
      </div>
    </div>
  );
}


function CenterPane({
  agent,
  isNewChat,
  conversationId,
  isPopout,
  inspectorOpen,
  onToggleInspector,
  showInspectorToggle = true,
  previewOpen,
  onTogglePreview,
  hasPreviewContent,
}: {
  agent: Workflow | undefined;
  isNewChat: boolean;
  conversationId: string | null;
  isPopout: boolean;
  inspectorOpen: boolean;
  onToggleInspector: () => void;
  showInspectorToggle?: boolean;
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
        {isNewChat ? (
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-accent text-foreground">
              <MessageSquare className="h-4 w-4" />
            </div>
            <div>
              <div className="text-sm font-semibold">New chat</div>
              <div className="text-[10px] text-muted-foreground">Ask anything · start a new task</div>
            </div>
          </div>
        ) : agent ? (
          <div className="flex items-center gap-2">
            <AgentAvatar name={agent.name} className={cn("h-7 w-7", agentWorkflowRingClass(agent))} textClassName="text-[10px] font-semibold" />
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
          {IS_TAURI && !isPopout && conversationId && conversationId !== NEW_CHAT_CONVERSATION_ID && (
            <button
              onClick={() => openAgentPopout(conversationId)}
              className="flex items-center gap-1 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground"
              title="Open in new window"
            >
              <SquareStack className="h-4 w-4" />
            </button>
          )}
          {hasPreviewContent && onTogglePreview && (
            <button
              onClick={onTogglePreview}
              className={cn(
                "flex items-center gap-1 rounded-md p-1.5 transition-colors",
                previewOpen ? "bg-surface-active text-foreground" : "text-muted-foreground hover:bg-surface-hover hover:text-foreground",
              )}
              title={previewOpen ? "Hide preview" : "Show preview"}
            >
              <Database className="h-4 w-4" />
            </button>
          )}
          {showInspectorToggle && !isNewChat && agent && (
            <button
              onClick={onToggleInspector}
              className={cn(
                "flex items-center gap-1 rounded-md p-1.5 transition-colors",
                inspectorOpen ? "bg-surface-active text-foreground" : "text-muted-foreground hover:bg-surface-hover hover:text-foreground",
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
        <ChatPane
          key={isNewChat ? NEW_CHAT_CONVERSATION_ID : agent?.id ?? "pending-agent"}
          agent={agent}
          isNewChat={isNewChat}
        />
      </div>
    </>
  );
}

// ─── Chat pane (center) ────────────────────────────────────────────────────

function ChatPane({ agent, isNewChat }: { agent: Workflow | undefined; isNewChat: boolean }) {
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [input, setInput] = React.useState("");
  const [isThinking, setIsThinking] = React.useState(false);
  const [composerAttachments, setComposerAttachments] = React.useState<ChatAttachment[]>([]);
  const [composerError, setComposerError] = React.useState<string | null>(null);
  const [editorOpen, setEditorOpen] = React.useState(false);
  const [editorInitial, setEditorInitial] = React.useState<ArtifactEditorInitial | null>(null);
  const addSandboxItem = useAppStore((s) => s.addSandboxItem);
  const setActiveConversation = useAppStore((s) => s.setActiveConversation);
  const setPendingAgentHandoff = useAppStore((s) => s.setPendingAgentHandoff);
  const setMobilePane = useAppStore((s) => s.setMobilePane);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { workflows, createConversationFromMessage } = useAgentsData();
  const { user } = useAuth();
  const agentIdForQuery = isNewChat ? null : agent?.id ?? null;
  const { data: persistedRows, isLoading: messagesLoading } = useAgentMessages(agentIdForQuery);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const abortRef = React.useRef<AbortController | null>(null);
  const lastFailedSendRef = React.useRef<{
    text: string;
    attachments: ChatAttachment[];
    priorMessages: ChatMessage[];
    pendingUserMsg: ChatMessage;
  } | null>(null);
  const [analyzingId, setAnalyzingId] = React.useState<string | null>(null);
  // ChatPane is keyed by agent id, so these refs reset on a genuine agent
  // switch via remount. We intentionally do NOT reset them in an effect — doing
  // so makes the handoff guard fire twice under React StrictMode, which double-
  // invokes runTurn and aborts the first (live) turn, leaving a blank reply.
  const processedHandoffIdRef = React.useRef<string | null>(null);
  // Tracks the agent id we've already hydrated from the server. Once hydrated
  // (or once a handoff turn starts), local message state owns this session so a
  // background refetch can never wipe a streaming/finished reply.
  const hydratedAgentRef = React.useRef<string | null>(null);
  const mountedRef = React.useRef(true);
  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const runTurnRef = React.useRef<
    (
      text: string,
      priorMessages: ChatMessage[],
      turnAttachments: ChatAttachment[],
      pendingUserMsg: ChatMessage,
      clearHandoffId?: string,
    ) => Promise<void>
  >(() => Promise.resolve());

  function filterLoadedMessages(rows: ChatMessage[]): ChatMessage[] {
    return rows.filter((m) => !(m.role === "agent" && isSendError(m.content)));
  }


  const lastMessage = messages[messages.length - 1];
  const scrollTick = `${messages.length}:${lastMessage?.content?.length ?? 0}:${lastMessage?.executionTrace?.length ?? 0}`;

  React.useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({
      top: el.scrollHeight,
      behavior: isThinking ? "auto" : "smooth",
    });
  }, [scrollTick, isThinking]);

  // Load chat history from React Query cache. New chat is ephemeral until first send.
  React.useEffect(() => {
    if (isNewChat) {
      const handoff = useAppStore.getState().pendingAgentHandoff;
      if (handoff) {
        setActiveConversation(conversationIdForWorkflow(handoff.agentId));
        return;
      }
      setMessages([]);
      return;
    }

    const handoff = useAppStore.getState().pendingAgentHandoff;
    const agentId = agent?.id ?? handoff?.agentId;
    if (!agentId) {
      setMessages([]);
      return;
    }

    const awaitingHandoff = handoff?.agentId === agentId;

    if (awaitingHandoff && handoff && processedHandoffIdRef.current !== handoff.id) {
      processedHandoffIdRef.current = handoff.id;
      // The handoff turn drives the conversation from here — local state owns it.
      hydratedAgentRef.current = agentId;
      setMessages([]);
      queueMicrotask(() => {
        if (!mountedRef.current) return;
        setIsThinking(true);
        const handoffAttachments = (handoff.attachments ?? []) as ChatAttachment[];
        const handoffUserMsg: ChatMessage = {
          id: Math.random().toString(36).slice(2),
          role: "user",
          content: handoff.prompt,
          attachments: handoffAttachments.length ? handoffAttachments : undefined,
          createdAt: new Date().toISOString(),
        };
        void runTurnRef.current(
          handoff.prompt,
          [handoffUserMsg],
          handoffAttachments,
          handoffUserMsg,
          handoff.id,
        );
      });
      return;
    }

    if (awaitingHandoff) return;

    // Cold-hydrate from the server exactly once per agent. After that, local
    // message state is the source of truth for this session, so a background
    // refetch (triggered by persisting messages) can never clobber a streaming
    // or just-finished reply.
    if (hydratedAgentRef.current === agentId) return;
    if (isThinking) return;
    if (!persistedRows) return;
    hydratedAgentRef.current = agentId;
    const loaded =
      persistedRows.length > 0
        ? filterLoadedMessages(mapPersistedMessages(persistedRows))
        : agent
          ? [agentWelcomeMessage(agent, user)]
          : [];
    setMessages(loaded);
  }, [isNewChat, agent?.id, agent, persistedRows, user, setActiveConversation, isThinking]);

  function resolveAgentId(): string | undefined {
    return agent?.id ?? useAppStore.getState().pendingAgentHandoff?.agentId;
  }

  async function persistMessage(msg: ChatMessage): Promise<string | null> {
    const agentId = resolveAgentId();
    if (!agentId) return null;
    const payload = {
      ...msg,
      events: eventsForPersistedMessage(msg),
    };
    try {
      const res = await fetch(`/api/agents/${agentId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role: payload.role,
          content: payload.content,
          events: payload.events,
        }),
      });
      if (!res.ok) {
        throw new Error(`Failed to save message (${res.status})`);
      }
      const saved = (await res.json()) as { id: string };
      void queryClient.invalidateQueries({ queryKey: ["agent-messages", agentId] });
      void queryClient.invalidateQueries({ queryKey: ["workflows"] });
      return saved.id;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save message";
      toast({ title: "Could not save message", description: message, variant: "destructive" });
      return null;
    }
  }

  async function patchMessage(serverId: string, msg: ChatMessage) {
    const agentId = resolveAgentId();
    if (!agentId) return;
    try {
      const res = await fetch(`/api/agents/${agentId}/messages/${serverId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: msg.content,
          events: eventsForPersistedMessage(msg),
        }),
      });
      if (!res.ok) {
        throw new Error(`Failed to update message (${res.status})`);
      }
      void queryClient.invalidateQueries({ queryKey: ["agent-messages", agentId] });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to update message";
      toast({ title: "Could not update message", description: message, variant: "destructive" });
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
    pendingUserMsg: ChatMessage,
    clearHandoffId?: string,
  ) {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    if (!mountedRef.current) return;
    setIsThinking(true);
    setComposerError(null);
    const handoff = useAppStore.getState().pendingAgentHandoff;
    const agentId = agent?.id ?? handoff?.agentId ?? null;
    const agentName = agent?.name ?? handoff?.agentName ?? "Agent";
    const agentTitle = agent?.title;
    const agentDescription = agent?.description;
    const replyId = Math.random().toString(36).slice(2);
    const replyMsg: ChatMessage = {
      id: replyId,
      role: "agent",
      content: "",
      createdAt: new Date().toISOString(),
    };

    let userCommitted = false;
    const commitUser = () => {
      if (userCommitted) return;
      userCommitted = true;
      if (!mountedRef.current) return;
      setMessages((m) => {
        const hasUser = m.some((msg) => msg.id === pendingUserMsg.id);
        const hasReply = m.some((msg) => msg.id === replyId);
        if (hasUser && hasReply) return m;
        const base = m.filter((msg) => msg.id !== pendingUserMsg.id && msg.id !== replyId);
        return [...base, pendingUserMsg, replyMsg];
      });
      void persistMessage(pendingUserMsg);
      setInput("");
      setComposerAttachments([]);
      if (clearHandoffId && handoff?.id === clearHandoffId) {
        setPendingAgentHandoff(null);
      }
    };

    // Show the user message and an empty agent bubble immediately — don't wait
    // for the SSE stream to open or the first model token.
    commitUser();

    try {
      const agentContext = agentId
        ? `You are acting as the agent "${agentName}"${agentTitle ? ` (${agentTitle})` : ""}. What it does: ${agentDescription ?? "A general assistant."}`
        : undefined;
      const result = await streamAgentThink(text, {
        context: agentContext,
        history: chatHistoryForApi(priorMessages, true),
        agentId,
        attachments: turnAttachments,
        allowCli: IS_TAURI,
        isDesktop: IS_TAURI,
        maxIterations: 64,
        signal: controller.signal,
        onStreamOpen: commitUser,
        onTraceUpdate: (trace) => {
          commitUser();
          if (!mountedRef.current) return;
          setMessages((prev) =>
            prev.some((m) => m.id === replyId)
              ? prev.map((m) => (m.id === replyId ? { ...m, executionTrace: trace } : m))
              : prev,
          );
        },
        onAnswerDelta: (answerSoFar) => {
          commitUser();
          if (!mountedRef.current) return;
          setMessages((prev) =>
            prev.some((m) => m.id === replyId)
              ? prev.map((m) => (m.id === replyId ? { ...m, content: answerSoFar } : m))
              : prev,
          );
        },
        onPlanUpdate: (items) => {
          commitUser();
          if (!mountedRef.current) return;
          setMessages((prev) =>
            prev.some((m) => m.id === replyId)
              ? prev.map((m) => (m.id === replyId ? { ...m, checklist: items } : m))
              : prev,
          );
        },
        onSandboxItem: addSandboxItem,
      });

      if (!userCommitted) commitUser();

      const finalContent =
        result.finalAnswer?.trim() ||
        "I couldn't produce a response. Please try again.";
      if (isSendError(finalContent)) {
        throw new Error(finalContent);
      }
      if (!finalContent) {
        throw new Error("No response from the assistant.");
      }
      lastFailedSendRef.current = null;
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

      if (!mountedRef.current) return;
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === replyId
            ? {
                ...msg,
                content: finalContent,
                executionTrace: result.trace,
                attachments: producedAttachments,
                ...(result.checklist ? { checklist: result.checklist } : {}),
                ...(result.clarificationRequest
                  ? { clarificationRequest: result.clarificationRequest }
                  : {}),
                ...(result.credentialRequest
                  ? { credentialRequest: result.credentialRequest }
                  : {}),
                ...(automationSaveSucceeded(result.trace, result.workflowSavedToAgentId)
                  ? { workflowSaved: { agentName: agent?.name ?? "this agent" } }
                  : {}),
                ...(result.createdAgentId
                  ? {
                      createdAgent: {
                        agentId: result.createdAgentId,
                        agentName: result.createdAgentName ?? "New agent",
                      },
                    }
                  : {}),
                ...(result.proposedWorkflow && !result.createdAgentId
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

      const finishedMsg: ChatMessage = {
        ...replyMsg,
        content: finalContent,
        executionTrace: result.trace,
        attachments: producedAttachments,
        ...(result.checklist ? { checklist: result.checklist } : {}),
        ...(result.clarificationRequest ? { clarificationRequest: result.clarificationRequest } : {}),
        ...(result.credentialRequest ? { credentialRequest: result.credentialRequest } : {}),
        ...(result.createdAgentId
          ? {
              createdAgent: {
                agentId: result.createdAgentId,
                agentName: result.createdAgentName ?? "New agent",
              },
            }
          : {}),
      };
      if (result.createdAgentId) {
        setPendingAgentHandoff({
          id: newHandoffId(),
          agentId: result.createdAgentId,
          agentName: result.createdAgentName ?? "New agent",
          prompt: text,
          kind: "continue",
          attachments: turnAttachments.length ? turnAttachments : undefined,
        });
        await queryClient.refetchQueries({ queryKey: ["workflows"] });
        setActiveConversation(conversationIdForWorkflow(result.createdAgentId));
        setMobilePane("chat");
      }

      void persistMessage(finishedMsg).then((serverId) => {
        setAnalyzingId(replyId);
        void analyzeRun({
          goal: text,
          trace: result.trace,
          finalAnswer: finalContent,
          agentId: agent?.id ?? null,
        })
          .then((analysis) => {
            if (!mountedRef.current) return;
            const showWorkflowSaved =
              automationSaveSucceeded(result.trace, result.workflowSavedToAgentId) &&
              (analysis.workflowAutoSaved || !!result.workflowSavedToAgentId) &&
              analysis.success &&
              analysis.outcomeAchieved !== false;
            const analyzedMsg: ChatMessage = {
              ...finishedMsg,
              runAnalysis: analysis,
              ...(showWorkflowSaved
                ? { workflowSaved: { agentName: agent?.name ?? "this agent" } }
                : {}),
            };
            setMessages((prev) =>
              prev.map((m) =>
                m.id === replyId
                  ? {
                      ...m,
                      runAnalysis: analysis,
                      ...(showWorkflowSaved
                        ? { workflowSaved: { agentName: agent?.name ?? "this agent" } }
                        : {}),
                    }
                  : m,
              ),
            );
            if (serverId) {
              void patchMessage(serverId, analyzedMsg);
            }
            if (analysis.workflowAutoSaved && showWorkflowSaved) {
              void queryClient.refetchQueries({ queryKey: ["workflows"] });
            }
          })
          .catch(() => {
            // Trace already persisted — analysis is optional.
          })
          .finally(() => {
            if (mountedRef.current) {
              setAnalyzingId((id) => (id === replyId ? null : id));
            }
          });
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        if (userCommitted && mountedRef.current) {
          setMessages((prev) => {
            const trace = prev.find((m) => m.id === replyId)?.executionTrace;
            const stoppedAnalysis = { success: false, summary: "Run was stopped before completion." };
            void persistMessage({
              ...replyMsg,
              content: "Stopped.",
              executionTrace: trace,
              runAnalysis: stoppedAnalysis,
            });
            return prev.map((msg) =>
              msg.id === replyId
                ? {
                    ...msg,
                    content: msg.content.trim() || "Stopped.",
                    runAnalysis: stoppedAnalysis,
                  }
                : msg,
            );
          });
        } else if (mountedRef.current) {
          setMessages((prev) => prev.filter((m) => m.id !== replyId));
        }
        return;
      }
      if (!mountedRef.current) return;
      const errorMessage = formatSendError(err);
      const retryable = isRetryableSendError(errorMessage);
      lastFailedSendRef.current = {
        text,
        attachments: turnAttachments,
        priorMessages: priorMessages.filter((m) => m.id !== pendingUserMsg.id),
        pendingUserMsg,
      };
      // Surface the failure ONCE — as an in-chat notice (with Retry). Do not
      // also set the composer banner, which would double-show the same error.
      setMessages((prev) => [
        ...prev.filter((m) => m.id !== replyId && m.id !== pendingUserMsg.id),
        {
          id: `delivery-error-${Date.now()}`,
          role: "agent",
          content: "",
          deliveryError: { message: errorMessage, retryable },
          retryPayload: { text, attachments: turnAttachments },
          createdAt: new Date().toISOString(),
        },
      ]);
      setInput(text);
      setComposerAttachments(turnAttachments);
    } finally {
      if (mountedRef.current) setIsThinking(false);
      if (abortRef.current === controller) abortRef.current = null;
    }
  }
  runTurnRef.current = runTurn;

  function newHandoffId() {
    return `handoff_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function retryFailedSend() {
    const failed = lastFailedSendRef.current;
    if (!failed || isThinking) return;
    setComposerError(null);
    setMessages((prev) => prev.filter((m) => !m.deliveryError));
    void runTurn(
      failed.text,
      failed.priorMessages,
      failed.attachments,
      failed.pendingUserMsg,
    );
  }

  // User clicked a multiple-choice clarification option — mark it answered and
  // send the choice back so the agent resumes with the answer.
  function handleClarificationAnswer(messageId: string, answer: string) {
    if (isThinking) return;
    setMessages((prev) =>
      prev.map((m) => (m.id === messageId ? { ...m, clarificationAnswered: true } : m)),
    );
    void send({ text: answer });
  }

  function dismissDeliveryError(messageId: string) {
    setMessages((prev) => prev.filter((m) => m.id !== messageId));
    if (lastFailedSendRef.current) {
      setInput(lastFailedSendRef.current.text);
      setComposerAttachments(lastFailedSendRef.current.attachments);
    }
  }

  function retryFromDeliveryError(payload: { text: string; attachments?: ChatAttachment[] }) {
    const failed = lastFailedSendRef.current;
    if (!failed || isThinking) return;
    setComposerError(null);
    setMessages((prev) => prev.filter((m) => !m.deliveryError));
    void runTurn(
      payload.text,
      failed.priorMessages,
      payload.attachments ?? [],
      failed.pendingUserMsg,
    );
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

  async function send(payload: {
    text: string;
    attachments?: ChatAttachment[];
  }) {
    const text = payload.text.trim();
    const attachments = payload.attachments ?? [];
    if ((!text && attachments.length === 0) || isThinking) return;

    setComposerError(null);
    setIsThinking(true);

    const content =
      text ||
      (attachments.length === 1
        ? `[Attached ${attachments[0].name}]`
        : `[Attached ${attachments.length} files]`);

    try {
      const route = await routeAgentMessage({
        message: content,
        currentAgentId: agent?.id ?? null,
        agents: workflows,
      });

      if (route.action === "route" && route.targetAgentId && route.targetAgentId !== agent?.id) {
        setPendingAgentHandoff({
          id: newHandoffId(),
          agentId: route.targetAgentId,
          agentName: route.targetAgentName ?? "Agent",
          prompt: buildEditHandoffPrompt(content, route.changeSummary ?? content),
          kind: "edit",
          attachments: attachments.length ? attachments : undefined,
        });
        setActiveConversation(conversationIdForWorkflow(route.targetAgentId));
        setMobilePane("chat");
        return;
      }

      if (isNewChat) {
        const created = await createConversationFromMessage(content);
        if (!mountedRef.current) return;
        setPendingAgentHandoff({
          id: newHandoffId(),
          agentId: created.id,
          agentName: created.name,
          prompt: content,
          kind: "continue",
          attachments: attachments.length ? attachments : undefined,
        });
        setActiveConversation(conversationIdForWorkflow(created.id));
        setMobilePane("chat");
        setIsThinking(false);
        return;
      }

      const pendingUserMsg: ChatMessage = {
        id: Math.random().toString(36).slice(2),
        role: "user",
        content,
        attachments: attachments.length ? attachments : undefined,
        createdAt: new Date().toISOString(),
      };
      void runTurn(text || content, messages, attachments, pendingUserMsg, undefined);
    } catch (err) {
      if (mountedRef.current) {
        setComposerError(formatSendError(err));
        setIsThinking(false);
      }
    }
  }

  const handoff = useAppStore((s) => s.pendingAgentHandoff);
  const awaitingHandoff = !isNewChat && handoff?.agentId === agent?.id;
  const loading = !isNewChat && messagesLoading && !persistedRows && !awaitingHandoff && !isThinking;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Messages */}
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4">
        {loading && (
          <div className="flex items-center justify-center py-8 text-xs text-muted-foreground">
            <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Loading chat history…
          </div>
        )}
        {!loading && messages.length === 0 && (isNewChat || !agent) && (
          <EmptyState onPick={(p) => void send({ text: p })} />
        )}
        {messages.map((m, i) => (
          <MessageBubble
            key={m.id}
            message={m}
            agentName={isNewChat ? "Apical" : agent?.name ?? "Agent"}
            isStreaming={isThinking && i === messages.length - 1 && m.role === "agent"}
            isAnalyzing={analyzingId === m.id}
            onEditArtifact={openArtifactForEdit}
            onCredentialSaved={(info) =>
              send({
                text: `I've saved the ${info.label} to the vault. Please continue.`,
              })
            }
            onPickPrompt={(prompt) => send({ text: prompt })}
            onClarify={handleClarificationAnswer}
            onRetryFailedSend={retryFromDeliveryError}
            onDismissDeliveryError={dismissDeliveryError}
          />
        ))}
        {isThinking && messages[messages.length - 1]?.role !== "agent" && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <div className="flex h-6 w-6 items-center justify-center rounded-md bg-accent text-foreground">
              {isNewChat ? <MessageSquare className="h-3.5 w-3.5" /> : <ApicalMark className="h-3.5 w-3.5" />}
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
        onChange={(v) => {
          setInput(v);
          if (composerError) setComposerError(null);
        }}
        disabled={isThinking}
        working={isThinking}
        onStop={stopTurn}
        attachments={composerAttachments}
        onAttachmentsChange={setComposerAttachments}
        sendError={composerError}
        onDismissError={() => setComposerError(null)}
        onRetrySend={composerError && isRetryableSendError(composerError) ? retryFailedSend : undefined}
        placeholder={
          isNewChat
            ? "Ask anything or describe work to automate…"
            : `Message ${agent?.name ?? "Apical"}…`
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
  isAnalyzing,
  onEditArtifact,
  onCredentialSaved,
  onPickPrompt,
  onClarify,
  onRetryFailedSend,
  onDismissDeliveryError,
}: {
  message: ChatMessage;
  agentName: string;
  isStreaming?: boolean;
  isAnalyzing?: boolean;
  onEditArtifact?: (a: ChatAttachment) => void;
  onCredentialSaved?: (info: { label: string; service: string }) => void;
  onPickPrompt?: (prompt: string) => void;
  onClarify?: (messageId: string, answer: string) => void;
  onRetryFailedSend?: (payload: { text: string; attachments?: ChatAttachment[] }) => void;
  onDismissDeliveryError?: (messageId: string) => void;
}) {
  if (message.deliveryError) {
    return (
      <SendFailureNotice
        message={message.deliveryError.message}
        retryable={message.deliveryError.retryable}
        onRetry={
          message.deliveryError.retryable && message.retryPayload && onRetryFailedSend
            ? () => onRetryFailedSend(message.retryPayload!)
            : undefined
        }
        onDismiss={onDismissDeliveryError ? () => onDismissDeliveryError(message.id) : undefined}
      />
    );
  }

  const isUser = message.role === "user";
  // Flat block style — no bubbles.
  // User messages: a neutral slate-gray block (bg-muted), left-aligned, full-width-ish.
  // Agent messages: no bubble at all — plain text on the page background, with a
  // small agent-name label above for context.
  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] space-y-1">
          <div className="rounded-md bg-muted px-3 py-2 text-sm text-foreground">
            <MarkdownText text={message.content} isUser />
          </div>
          {message.attachments && message.attachments.length > 0 && (
            <AssetCards attachments={message.attachments} onEdit={onEditArtifact} />
          )}
          <div className="select-none text-right text-[10px] text-muted-foreground">
            {new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </div>
        </div>
      </div>
    );
  }
  // Agent — no bubble, plain text. Name label for context (which agent is talking).
  return (
    <div className="group/message space-y-1">
      <div className="flex select-none items-center gap-1.5 text-[10px] font-medium text-muted-foreground">
        <span>{agentName}</span>
        {isStreaming && (
          <span className="flex items-center gap-1 text-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            Working…
          </span>
        )}
      </div>
      {(message.executionTrace?.length || isStreaming) && (
        <div className="select-none">
          <RunTimeline
            run={buildChatRun(message.id, message.executionTrace ?? [], {
              startedAt: message.createdAt,
              finishedAt: isStreaming ? undefined : message.createdAt,
              analysis: message.runAnalysis,
              live: !!isStreaming,
              stopped: message.runAnalysis?.summary === "Run was stopped before completion.",
              analyzing: !!isAnalyzing && !message.runAnalysis,
            })}
          />
        </div>
      )}
      {message.checklist && message.checklist.length > 0 && (
        <div className="select-none">
          <AgentChecklist items={message.checklist} />
        </div>
      )}
      <div className="text-sm text-foreground">
        {message.content ? (
          <MarkdownText text={message.content} />
        ) : isStreaming ? null : (
          <span className="text-muted-foreground italic">…</span>
        )}
      </div>
      {message.clarificationRequest && (
        <div className="select-none">
          <ClarificationCard
            request={message.clarificationRequest}
            answered={message.clarificationAnswered}
            onAnswer={(text) => onClarify?.(message.id, text)}
          />
        </div>
      )}
      {message.suggestions && message.suggestions.length > 0 && onPickPrompt && (
        <div className="select-none">
          <SuggestionCards suggestions={message.suggestions} onPick={onPickPrompt} />
        </div>
      )}
      {message.attachments && message.attachments.length > 0 && (
        <div className="select-none">
          <AssetCards attachments={message.attachments} onEdit={onEditArtifact} />
        </div>
      )}
      {message.credentialRequest && (
        <div className="select-none">
          <CredentialBox request={message.credentialRequest} onSaved={onCredentialSaved} />
        </div>
      )}
      {message.workflowSaved && (
        <div className="mt-2 flex select-none items-center gap-1.5 rounded-md border border-surface-subtle bg-surface-subtle px-2.5 py-1.5 text-[11px] text-muted-foreground">
          <Save className="h-3 w-3 text-foreground" />
          Updated <span className="font-medium text-foreground">{message.workflowSaved.agentName}</span>&rsquo;s own workflow.
        </div>
      )}
      {message.createdAgent && (
        <div className="mt-2 flex select-none items-center gap-1.5 rounded-md border border-surface-subtle bg-surface-subtle px-2.5 py-1.5 text-[11px] text-muted-foreground">
          <Boxes className="h-3 w-3 text-foreground" />
          Opened <span className="font-medium text-foreground">{message.createdAgent.agentName}</span> — onboarding context is in its chat.
        </div>
      )}
      {message.workflowProposal && (
        <div className="mt-2 select-none rounded-md border border-border bg-muted p-2.5 text-xs">
          <div className="mb-1 font-semibold text-foreground">Proposed workflow: {message.workflowProposal.name}</div>
          <div className="text-muted-foreground">{message.workflowProposal.description}</div>
          <div className="mt-1.5 text-[10px] text-muted-foreground">{message.workflowProposal.steps.steps.length} steps</div>
        </div>
      )}
      {message.automateOffer && (
        <div className="mt-2 select-none rounded-md border border-border bg-muted p-2.5 text-xs">
          <div className="mb-1 font-semibold text-foreground">Automate this?</div>
          <p className="text-muted-foreground">{message.automateOffer.summary}</p>
          <div className="mt-1.5 text-[10px] text-muted-foreground">
            {message.automateOffer.steps.steps.length} steps
          </div>
        </div>
      )}
      <div className="flex select-none items-center gap-1 text-[10px] text-muted-foreground">
        <span>
          {new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </span>
        {message.content && !isStreaming && (
          <CopyMessageButton
            text={message.content}
            className="opacity-0 transition-opacity group-hover/message:opacity-100 focus-visible:opacity-100"
          />
        )}
      </div>
    </div>
  );
}

function EmptyState({ onPick }: { onPick: (prompt: string) => void }) {
  return (
    <div className="mx-auto max-w-md py-8 text-center">
      <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-accent text-foreground">
        <MessageSquare className="h-5 w-5" />
      </div>
      <h3 className="text-sm font-semibold">Start a conversation</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Ask anything, describe a task, or pick a starting point:
      </p>
      <SuggestionCards suggestions={DEFAULT_PROMPTS} onPick={onPick} className="mt-4" />
    </div>
  );
}

function SuggestionCards({
  suggestions,
  onPick,
  className,
}: {
  suggestions: { title: string; prompt: string; reason: string }[];
  onPick: (prompt: string) => void;
  className?: string;
}) {
  return (
    <div className={cn("grid gap-2", className)}>
      {suggestions.map((p) => (
        <button
          key={p.title}
          type="button"
          onClick={() => onPick(p.prompt)}
          className="rounded-lg border border-border bg-card p-2.5 text-left transition-colors hover:border-border hover:bg-surface-hover"
        >
          <div className="text-xs font-medium">{p.title}</div>
          <div className="mt-0.5 line-clamp-2 text-[10px] text-muted-foreground">{p.prompt}</div>
          <div className="mt-1 text-[9px] uppercase tracking-wide text-muted-foreground/70">
            {p.reason}
          </div>
        </button>
      ))}
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
                activeTab === t.key ? "bg-surface-active text-foreground" : "text-muted-foreground hover:bg-surface-hover",
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
  const [section, setSection] = React.useState<"overview" | "dashboard" | "workflow" | "config" | "runs">("overview");
  const status = agentStatus(agent);
  const autoPct = Math.round((agent.automaticCount / Math.max(agent.itemsProcessed, 1)) * 100);

  return (
    <aside className={cn("flex h-full w-full min-w-0 flex-col overflow-hidden bg-muted/30", !embedded && "border-l border-border")}>
      {/* Section switcher — Overview / Dashboard / Workflow / Config as tabs WITHIN the right rail */}
      <div className="flex shrink-0 items-center gap-0.5 border-b border-border bg-background/50 p-1">
        {(["overview", "dashboard", "workflow", "config", "runs"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setSection(s)}
            className={cn(
              "flex-1 rounded-md px-2 py-1 text-[10px] font-medium capitalize transition-colors",
              section === s ? "bg-surface-active text-foreground" : "text-muted-foreground hover:bg-surface-hover hover:text-foreground",
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
        {section === "runs" && (
          <div className="p-3">
            <AgentRunSection workflowId={agent.id} />
          </div>
        )}
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
  onGoSection: (s: "overview" | "dashboard" | "workflow" | "config" | "runs") => void;
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
          <button onClick={() => onGoSection("workflow")} className="text-[10px] text-muted-foreground hover:text-foreground hover:underline">View →</button>
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
          <button onClick={() => onGoSection("dashboard")} className="text-[10px] text-muted-foreground hover:text-foreground hover:underline">Full dashboard →</button>
        </div>
        <div className="grid grid-cols-2 gap-2 text-[10px]">
          <div><div className="text-muted-foreground">Processed</div><div className="font-semibold tabular-nums">{agent.itemsProcessed.toLocaleString()}</div></div>
          <div><div className="text-muted-foreground">Automatic</div><div className="font-semibold tabular-nums">{autoPct}%</div></div>
          <div><div className="text-muted-foreground">Flagged</div><div className="font-semibold tabular-nums text-gate">{agent.flaggedCount.toLocaleString()}</div></div>
          <div><div className="text-muted-foreground">Runs</div><div className="font-semibold tabular-nums">{agent.runsCount}</div></div>
        </div>
      </div>

      {/* Run log shortcut */}
      <button
        onClick={() => onGoSection("runs")}
        className="flex w-full items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-left text-[11px] hover:border-border"
      >
        <Activity className="h-3.5 w-3.5 text-muted-foreground" />
        View full run log
        <ChevronRight className="ml-auto h-3 w-3 text-muted-foreground" />
      </button>

      {/* Quick links to other sections */}
      <div className="flex flex-col gap-1">
        <button onClick={() => onGoSection("dashboard")} className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-left text-[11px] hover:border-border">
          <Activity className="h-3.5 w-3.5 text-muted-foreground" /> Full dashboard
          <ChevronRight className="ml-auto h-3 w-3 text-muted-foreground" />
        </button>
        <button onClick={() => onGoSection("config")} className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-left text-[11px] hover:border-border">
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
          <StatCard label="Items processed" value={agent.itemsProcessed.toLocaleString()} icon={Activity} accent="bg-accent text-foreground" />
          <StatCard label="Automatic" value={`${autoPct}%`} icon={CheckCircle2} accent="bg-accent text-foreground" />
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
        <RunLog workflowId={agent.id} title="Recent runs" limit={15} maxHeight="max-h-96" />
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
                    {workflowStepToolLabel(step)}
                  </div>
                  {workflowStepDetail(step) && (
                    <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">
                      {workflowStepDetail(step)}
                    </p>
                  )}
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
                className={cn("rounded-lg border p-3 text-left transition", runtime === "local" ? "border-foreground/20 bg-muted" : "border-border hover:border-border/80")}
              >
                <div className="flex items-center gap-2">
                  <Monitor className={cn("h-4 w-4", runtime === "local" ? "text-foreground" : "text-muted-foreground")} />
                  <span className="text-xs font-semibold">Local (desktop)</span>
                  {runtime === "local" && <Check className="ml-auto h-3 w-3 text-foreground" />}
                </div>
                <div className="mt-1 text-[10px] text-muted-foreground">Runs on your machine via the Tauri shell. Filesystem + shell access. Private.</div>
              </button>
              <button
                onClick={() => setRuntime("hosted")}
                className={cn("rounded-lg border p-3 text-left transition", runtime === "hosted" ? "border-foreground/20 bg-muted" : "border-border hover:border-border/80")}
              >
                <div className="flex items-center gap-2">
                  <Cloud className={cn("h-4 w-4", runtime === "hosted" ? "text-foreground" : "text-muted-foreground")} />
                  <span className="text-xs font-semibold">Hosted (cloud)</span>
                  {runtime === "hosted" && <Check className="ml-auto h-3 w-3 text-foreground" />}
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
          <div className="rounded-md border border-orange-500/30 bg-orange-500/10 p-2.5 text-xs text-orange-950 dark:text-orange-100">{error}</div>
        )}
        {savedAt && !error && (
          <div className="flex items-center gap-2 rounded-md border border-border bg-muted p-2.5 text-xs text-foreground">
            <Check className="h-3.5 w-3.5" /> Saved at {savedAt.toLocaleTimeString()}
          </div>
        )}
        <div className="flex items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" className="gap-1.5">
              {agent.status === "paused" ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
              {agent.status === "paused" ? "Resume" : "Pause"}
            </Button>
            <RunNowControls workflowId={agent.id} />
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
