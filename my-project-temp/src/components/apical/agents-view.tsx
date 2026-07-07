"use client";

import * as React from "react";
import { useAppStore } from "@/lib/apical/store";
import {
  DEFAULT_PROMPTS,
  agentWelcomeMessage,
  relativeTime,
  formatDuration,
  STEP_KIND_META,
  stepKind,
  type ChatMessage,
  type Workflow,
  type AgentRuntime,
  type PlanItem,
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
import { agentWorkflowRingClass, buildEditHandoffPrompt } from "@/lib/apical/agent-display";
import type { AgentRingState } from "@/lib/apical/agent-display";
import { routeAgentMessage } from "@/lib/apical/agent-route";
import { useToast } from "@/hooks/use-toast";
import { ApicalMark, RuntimeBadge, AgentAvatar, FlaggedCountBadge } from "./logo";
import { DesktopStatusChip } from "@/components/desktop/desktop-status-chip";
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
  ListChecks,
  Columns2,
  SquareStack,
} from "lucide-react";
import {
  mapPersistedMessages,
  streamAgentThink,
  attachToAgentRun,
  chatHistoryForApi,
  eventsForPersistedMessage,
  analyzeRun,
  automationSaveSucceeded,
  STOPPED_SUMMARY,
  INTERRUPTED_SUMMARY,
} from "@/lib/apical/chat-stream";
import { ChatComposer } from "./chat-composer";
import { ScheduleEditor } from "./schedule-editor";
import { humanizeSchedule, workflowStepDetail, workflowStepToolLabel } from "@/lib/apical/workflow-display";
import { ArtifactEditor, type ArtifactEditorInitial } from "./artifact-editor";
import { AssetCards } from "./asset-cards";
import { SandboxPanel } from "./sandbox-panel";
import { CredentialRequestList } from "./credential-box";
import { ConnectAccountCardList } from "./connect-account-card";
import { ClarificationCard } from "./clarification-card";
import { MarkdownText } from "./markdown-text";
import { CopyMessageButton } from "./copy-message-button";
import { ActivityFlow } from "./activity-flow";
import { AgentRunSection, AgentRunsPanel, JobsPanel, RunNowControls } from "./workflow-runs-console";
import { fetchArtifactText } from "@/lib/apical/attachments";
import { sandboxItemFromAttachment } from "@/lib/apical/sandbox";
import type { ChatAttachment } from "@/lib/apical";
import { useQueryClient } from "@tanstack/react-query";
import { useAgentMessages, useCreateWorkflow } from "@/lib/queries";
import { syncChatThreadCache } from "@/lib/apical/chat-cache";
import { useAuth } from "@/components/auth/AuthDialog";

// ─── Helpers ────────────────────────────────────────────────────────────────

function agentStatus(agent: Workflow): { color: string; label: string } {
  if (agent.status === "paused") return { color: "bg-muted-foreground", label: "Paused" };
  if (agent.flaggedCount > 0) return { color: "bg-gate", label: "Flagged" };
  return { color: "bg-foreground", label: "Active" };
}

/**
 * The most recent checklist in the thread that still has unfinished items —
 * passed to the next turn so the agent RESUMES it instead of re-planning from
 * scratch. Returns undefined when the latest plan is fully done (or absent).
 */
function latestUnfinishedPlan(messages: ChatMessage[]): PlanItem[] | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const plan = messages[i].checklist;
    if (plan && plan.length > 0) {
      return plan.some((p) => p.status !== "done") ? plan : undefined;
    }
  }
  return undefined;
}

// ─── Main view: responsive 3-rail (desktop) / stacked (mobile) ─────────────
//
// DESKTOP (lg+): left rail (agent navigator) + center (chat) + right rail
// (inspector: Overview / Progress / Workflow / Config / Runs).
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
  const clearSandbox = useAppStore((s) => s.clearSandbox);
  const { activeAgent, isNewChat } = useActiveAgent();

  React.useEffect(() => {
    clearSandbox();
    useAppStore.getState().setInspectorSection("overview");
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

  const agentWorking = useAppStore((s) => s.agentWorking);
  const hasData = sandboxItems.length > 0;
  // Reveal the Progress rail as soon as the agent starts working, even before
  // the first tool observation produces a sandbox item.
  const showData = sandboxOpen && (hasData || agentWorking);
  const showInspectorPanel = inspectorOpen && !!activeAgent && !isNewChat;
  const showRightRailInline = isWide && (showData || showInspectorPanel);
  const showRightRailOverlay = !isWide && (showData || showInspectorPanel);
  const canOpenRightRail = !!activeAgent && !isNewChat;

  const closeRightRail = React.useCallback(() => {
    const store = useAppStore.getState();
    store.setInspectorOpen(false);
    store.setSandboxOpen(false);
  }, []);

  return (
    <>
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
          showInspectorToggle={canOpenRightRail}
          previewOpen={showData}
          onTogglePreview={() => {
            const store = useAppStore.getState();
            if (store.sandboxOpen) {
              store.setSandboxOpen(false);
            } else {
              store.setSandboxOpen(true);
              store.setInspectorSection("progress");
              store.setInspectorOpen(true);
            }
          }}
          hasPreviewContent={canOpenRightRail}
        />
      </ResizablePanel>

      {/* Right — agent inspector (Progress tab) or standalone progress panel */}
      {showRightRailInline && (
        <>
          <ResizableHandle withHandle />
          <ResizablePanel id="right-rail" order={3} defaultSize={26} minSize={18} maxSize={42}>
            <RightRailPane
              agent={activeAgent}
              showInspector={showInspectorPanel}
              showData={showData}
            />
          </ResizablePanel>
        </>
      )}
    </ResizablePanelGroup>

    {/* Below lg: right rail slides over instead of resizing the center pane. */}
    {showRightRailOverlay && (
      <div className="fixed inset-0 z-40 flex justify-end">
        <button
          type="button"
          aria-label="Close sidebar"
          className="absolute inset-0 bg-black/40"
          onClick={closeRightRail}
        />
        <div className="relative z-50 flex h-full w-full max-w-md flex-col border-l border-border bg-background shadow-xl">
          <RightRailPane
            agent={activeAgent}
            showInspector={showInspectorPanel}
            showData={showData}
          />
        </div>
      </div>
    )}
    </>
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
  const { workflows, conversations, deleteAgent, togglePin, isLoading, ringState } = useAgentsData();
  const { toast } = useToast();
  const [deleteTarget, setDeleteTarget] = React.useState<{ id: string; name: string } | null>(null);

  const agentConvos = sortSidebarConversations(conversations);
  const filtered = sortSidebarConversations(
    agentConvos.filter((c) => {
      if (!search) return true;
      const wf = workflows.find((w) => w.id === c.workflowId);
      return (
        c.title.toLowerCase().includes(search.toLowerCase()) ||
        (wf?.name ?? "").toLowerCase().includes(search.toLowerCase())
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
                      ringState={ringState}
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
                      ringState={ringState}
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
            // A brand-new account has no agents at all — don't imply a failed
            // search the user never made.
            <p className="px-1.5 py-2 text-[10px] leading-relaxed text-muted-foreground">
              {search
                ? "No agents match your search."
                : "No agents yet. Describe a job in the chat and Apical builds the agent for you."}
            </p>
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
  ringState,
  active,
  onClick,
  onTogglePin,
  onDelete,
}: {
  convo: { id: string; title: string; pinned?: boolean };
  agent: Workflow;
  ringState: AgentRingState;
  active: boolean;
  onClick: () => void;
  onTogglePin: () => void;
  onDelete: () => void;
}) {
  const ringClass = agentWorkflowRingClass(agent, ringState);
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
          <div className="truncate text-[9px] text-muted-foreground">{agent.trigger === "schedule" ? humanizeSchedule(agent.schedule) : "Manual"}</div>
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
// one visible at a time, switched via a bottom tab bar. Detail holds
// Overview / Progress / Workflow / Config / Runs. No 3-rail layout.

function MobileAgentsView() {
  const activeConversationId = useAppStore((s) => s.activeConversationId);
  const setActiveConversation = useAppStore((s) => s.setActiveConversation);
  const mobilePane = useAppStore((s) => s.mobilePane);
  const setMobilePane = useAppStore((s) => s.setMobilePane);
  const clearSandbox = useAppStore((s) => s.clearSandbox);
  const { activeAgent, isNewChat, workflows } = useActiveAgent();

  React.useEffect(() => {
    clearSandbox();
    useAppStore.getState().setInspectorSection("overview");
  }, [activeConversationId, clearSandbox]);

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Top bar — current agent name (no logo on desktop) */}
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3">
        {!IS_TAURI && <ApicalMark className="h-5" />}
        <span className="text-sm font-semibold">
          {isNewChat ? "New chat" : activeAgent?.name ?? "Agents"}
        </span>
        {activeAgent && (
          <span className="ml-auto text-[10px] text-muted-foreground">
            {activeAgent.trigger === "schedule" ? humanizeSchedule(activeAgent.schedule) : "Manual"}
          </span>
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
            // Key by the STABLE conversation id (not activeAgent?.id) so the pane
            // doesn't remount when the agent object arrives a render late after a
            // new chat is created — a remount would drop the queued first turn.
            key={activeConversationId ?? NEW_CHAT_CONVERSATION_ID}
            agent={activeAgent}
            isNewChat={isNewChat}
          />
        )}
        {mobilePane === "detail" && activeAgent && !isNewChat && (
          <MobileDetailPane agent={activeAgent} />
        )}
        {mobilePane === "detail" && (isNewChat || !activeAgent) && (
          <div className="flex h-full items-center justify-center p-4 text-center text-xs text-muted-foreground">
            Select an agent to see its details.
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
  const { workflows, conversations, deleteAgent, togglePin, isLoading, ringState } = useAgentsData();
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
    const ringClass = agentWorkflowRingClass(wf, ringState);
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
              <div className="truncate text-[10px] text-muted-foreground">{wf.trigger === "schedule" ? humanizeSchedule(wf.schedule) : "Manual"}</div>
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

const INSPECTOR_TABS = ["overview", "progress", "workflow", "config", "runs"] as const;

function MobileDetailPane({ agent }: { agent: Workflow }) {
  const section = useAppStore((s) => s.inspectorSection);
  const setSection = useAppStore((s) => s.setInspectorSection);
  const status = agentStatus(agent);
  const autoPct = Math.round((agent.automaticCount / Math.max(agent.itemsProcessed, 1)) * 100);

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-0.5 border-b border-border bg-background/50 p-1">
        {INSPECTOR_TABS.map((s) => (
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
        {section === "progress" && <SandboxPanel mode="progress" embedded showClose={false} className="border-l-0" />}
        {section === "workflow" && <AgentWorkflow agent={agent} />}
        {section === "config" && <AgentConfig agent={agent} />}
        {section === "runs" && (
          <div className="space-y-4 p-3">
            <AgentRunSection workflowId={agent.id} />
            <div>
              <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Long-task agent runs
              </div>
              <AgentRunsPanel agentId={agent.id} />
            </div>
            <div>
              <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Compute jobs
              </div>
              <JobsPanel agentId={agent.id} />
            </div>
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
  const { ringState } = useAgentsData();
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
            <AgentAvatar name={agent.name} className={cn("h-7 w-7", agentWorkflowRingClass(agent, ringState))} textClassName="text-[10px] font-semibold" />
            <div>
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-semibold">{agent.name}</span>
                <RuntimeBadge runtime={agent.runtime} />
              </div>
              <div className="text-[10px] text-muted-foreground">{agent.trigger === "schedule" ? humanizeSchedule(agent.schedule) : "Manual"}</div>
            </div>
          </div>
        ) : null}

        {/* Progress + inspector toggles */}
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
              title={previewOpen ? "Hide progress" : "Show progress"}
            >
              <ListChecks className="h-4 w-4" />
            </button>
          )}
          {showInspectorToggle && !isNewChat && agent && (
            <button
              onClick={() => {
                const store = useAppStore.getState();
                if (store.inspectorOpen || store.sandboxOpen) {
                  store.setInspectorOpen(false);
                  store.setSandboxOpen(false);
                } else {
                  store.setInspectorOpen(true);
                }
              }}
              className={cn(
                "flex items-center gap-1 rounded-md p-1.5 transition-colors",
                inspectorOpen || previewOpen
                  ? "bg-surface-active text-foreground"
                  : "text-muted-foreground hover:bg-surface-hover hover:text-foreground",
              )}
              title={inspectorOpen || previewOpen ? "Hide sidebar" : "Show sidebar"}
            >
              {inspectorOpen || previewOpen ? (
                <PanelRightClose className="h-4 w-4" />
              ) : (
                <PanelRightOpen className="h-4 w-4" />
              )}
            </button>
          )}
        </div>
      </div>

      {/* Chat only */}
      <div className="min-h-0 flex-1 overflow-hidden">
        <ChatPane
          // Key by the STABLE conversation id, not agent?.id. The agent object
          // can arrive a render late (React Query cache lag) right after a new
          // chat is created; keying by agent id would mount a throwaway
          // "pending-agent" pane and then remount, which unmounts the pane
          // before its queued first-turn runTurn fires — leaving dots but no
          // thinking. The conversation id is known immediately and never flips.
          key={conversationId ?? NEW_CHAT_CONVERSATION_ID}
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
  const [liveStatus, setLiveStatus] = React.useState<string | undefined>(undefined);
  const [composerAttachments, setComposerAttachments] = React.useState<ChatAttachment[]>([]);
  const [composerError, setComposerError] = React.useState<string | null>(null);
  const [editorOpen, setEditorOpen] = React.useState(false);
  const [editorInitial, setEditorInitial] = React.useState<ArtifactEditorInitial | null>(null);
  const addSandboxItem = useAppStore((s) => s.addSandboxItem);
  const openProgressPanel = React.useCallback((stepId: string) => {
    const store = useAppStore.getState();
    store.setSandboxOpen(true);
    store.setInspectorSection("progress");
    store.setHighlightedStepId(stepId);
  }, []);
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
  /** The in-flight durable AgentRun for this thread (null when inline). */
  const activeAgentRunIdRef = React.useRef<string | null>(null);
  /** Agent id we've already checked for a resumable durable run. */
  const reattachedAgentRef = React.useRef<string | null>(null);
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
  // Latest messages, for async callbacks that must not use a stale closure.
  const messagesRef = React.useRef<ChatMessage[]>([]);
  messagesRef.current = messages;
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
      const handoffAttachments = (handoff.attachments ?? []) as ChatAttachment[];
      const handoffUserMsg: ChatMessage = {
        id: Math.random().toString(36).slice(2),
        role: "user",
        content: handoff.prompt,
        attachments: handoffAttachments.length ? handoffAttachments : undefined,
        createdAt: new Date().toISOString(),
      };
      // Paint the user's message + thinking indicator synchronously so the
      // freshly mounted pane never flashes blank while the first turn spins up.
      setMessages([handoffUserMsg]);
      setIsThinking(true);
      queueMicrotask(() => {
        if (!mountedRef.current) return;
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

    // Cold-hydrate from cache/server exactly once per agent. After that, local
    // message state is the source of truth for this session, so a background
    // refetch (triggered by persisting messages) can never clobber a streaming
    // or just-finished reply.
    if (hydratedAgentRef.current === agentId) return;
    if (isThinking) return;
    if (persistedRows === undefined && messagesLoading) return;
    hydratedAgentRef.current = agentId;
    const loaded =
      persistedRows && persistedRows.length > 0
        ? filterLoadedMessages(mapPersistedMessages(persistedRows))
        : agent
          ? [agentWelcomeMessage(agent, user)]
          : [];
    setMessages(loaded);
  }, [isNewChat, agent?.id, agent, persistedRows, user, setActiveConversation, isThinking, messagesLoading]);

  // Keep local + disk chat cache in sync so conversations restore instantly.
  React.useEffect(() => {
    const agentId = agent?.id ?? useAppStore.getState().pendingAgentHandoff?.agentId;
    if (isNewChat || !agentId || isThinking || messages.length === 0) return;
    if (hydratedAgentRef.current !== agentId) return;
    syncChatThreadCache(agentId, messages);
  }, [isNewChat, agent?.id, messages, isThinking]);

  // Re-attach to an in-flight durable run when this thread opens (page reload,
  // new tab, or navigating back). The worker keeps executing regardless; here
  // we just resume streaming its events into the chat and persist the result.
  React.useEffect(() => {
    const agentId = agent?.id;
    if (isNewChat || !agentId || isThinking) return;
    if (reattachedAgentRef.current === agentId) return;
    reattachedAgentRef.current = agentId;
    let cancelled = false;
    void (async () => {
      const active = await fetch(`/api/agent-runs?agentId=${agentId}&active=1&limit=1`)
        .then((r) => (r.ok ? (r.json() as Promise<{ runs?: Array<{ id: string }> }>) : null))
        .catch(() => null);
      const runId = active?.runs?.[0]?.id;
      if (!runId || cancelled || !mountedRef.current) return;

      const controller = new AbortController();
      abortRef.current = controller;
      activeAgentRunIdRef.current = runId;
      setIsThinking(true);
      useAppStore.getState().setAgentWorking(true);
      const replyId = `reattach-${runId}`;
      setMessages((prev) =>
        prev.some((m) => m.id === replyId)
          ? prev
          : [...prev, { id: replyId, role: "agent", content: "", createdAt: new Date().toISOString() }],
      );
      try {
        const result = await attachToAgentRun(runId, {
          signal: controller.signal,
          onStatusUpdate: (label) => mountedRef.current && setLiveStatus(label),
          onTraceUpdate: (trace) =>
            mountedRef.current &&
            setMessages((prev) => prev.map((m) => (m.id === replyId ? { ...m, executionTrace: trace } : m))),
          onAnswerDelta: (ans) =>
            mountedRef.current &&
            setMessages((prev) => prev.map((m) => (m.id === replyId ? { ...m, content: ans } : m))),
          onPlanUpdate: (items) =>
            mountedRef.current &&
            setMessages((prev) => prev.map((m) => (m.id === replyId ? { ...m, checklist: items } : m))),
          onSandboxItem: addSandboxItem,
        });
        if (!mountedRef.current) return;
        // The worker persists the AgentMessage; drop the transient bubble and
        // refetch so the durable row (with its real id) renders.
        setMessages((prev) => prev.filter((m) => m.id !== replyId));
        if (result.finalAnswer) {
          void queryClient.invalidateQueries({ queryKey: ["agent-messages", agentId] });
        }
      } catch {
        if (mountedRef.current) setMessages((prev) => prev.filter((m) => m.id !== replyId));
      } finally {
        activeAgentRunIdRef.current = null;
        if (mountedRef.current) {
          setIsThinking(false);
          setLiveStatus(undefined);
        }
        useAppStore.getState().setAgentWorking(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [agent?.id, isNewChat, isThinking, addSandboxItem, queryClient]);

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
    // Durable runs keep executing server-side after an abort — Stop means
    // stop, so also request cancellation of the active AgentRun.
    const activeDurable = activeAgentRunIdRef.current;
    if (activeDurable) {
      activeAgentRunIdRef.current = null;
      void fetch(`/api/agent-runs/${activeDurable}/cancel`, { method: "POST" }).catch(() => {});
    }
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
    // Mark the agent as working. Auto-open Progress when the side panel is closed.
    {
      const store = useAppStore.getState();
      store.setAgentWorking(true);
      if (!store.sandboxOpen) {
        store.setSandboxOpen(true);
      }
      store.setInspectorSection("progress");
    }
    const handoff = useAppStore.getState().pendingAgentHandoff;
    const agentId = agent?.id ?? handoff?.agentId ?? null;
    const agentName = agent?.name ?? handoff?.agentName ?? "Agent";
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
        ? `You are acting as the agent "${agentName}". What it does: ${agentDescription ?? "A general assistant."}`
        : undefined;
      // Carry forward the most recent unfinished checklist so the agent resumes
      // it instead of planning from scratch.
      const priorPlan = latestUnfinishedPlan(priorMessages);
      const durable = useAppStore.getState().durableMode;
      const result = await streamAgentThink(text, {
        context: agentContext,
        history: chatHistoryForApi(priorMessages, true),
        priorPlan,
        agentId,
        attachments: turnAttachments,
        maxIterations: 64,
        signal: controller.signal,
        durable,
        onAgentRunId: (id) => {
          activeAgentRunIdRef.current = id;
        },
        onStreamOpen: commitUser,
        onStatusUpdate: (label) => {
          if (mountedRef.current) setLiveStatus(label);
        },
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
                ...(result.credentialRequests?.length
                  ? {
                      credentialRequests: result.credentialRequests.map((r) => ({
                        ...r,
                        status: "pending" as const,
                      })),
                    }
                  : {}),
                ...(result.connectionRequests?.length
                  ? {
                      connectionRequests: result.connectionRequests.map((r) => ({
                        ...r,
                        status: "pending" as const,
                      })),
                    }
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
        ...(result.credentialRequests?.length
          ? {
              credentialRequests: result.credentialRequests.map((r) => ({
                ...r,
                status: "pending" as const,
              })),
            }
          : {}),
        ...(result.connectionRequests?.length
          ? {
              connectionRequests: result.connectionRequests.map((r) => ({
                ...r,
                status: "pending" as const,
              })),
            }
          : {}),
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

      // Simple, tool-less turns (plain questions, chat) skip the post-run
      // outcome check entirely — there is nothing to verify, and no activity
      // scaffolding should appear.
      const usedTools = result.trace.some((s) => stepKind(s) === "tool");

      // Durable runs are persisted server-side by the agent-worker — a client
      // save here would duplicate the message.
      if (durable) {
        activeAgentRunIdRef.current = null;
        void queryClient.invalidateQueries({ queryKey: ["agent-messages", agentId] });
        return;
      }

      void persistMessage(finishedMsg).then((serverId) => {
        // Remember the server row id so interactive-card state (credential
        // boxes) can be PATCHed when the user saves/dismisses them.
        if (serverId && mountedRef.current) {
          setMessages((prev) =>
            prev.map((m) => (m.id === replyId ? { ...m, serverId } : m)),
          );
        }
        if (!usedTools) return;
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
            // Merge in the LIVE credential-box / connect-card state — the user
            // may have saved a key or connected an app while the analysis was
            // still running.
            const liveMsg = messagesRef.current.find((m) => m.id === replyId);
            const liveCreds = liveMsg?.credentialRequests;
            const liveConnections = liveMsg?.connectionRequests;
            const analyzedMsg: ChatMessage = {
              ...finishedMsg,
              ...(liveCreds ? { credentialRequests: liveCreds } : {}),
              ...(liveConnections ? { connectionRequests: liveConnections } : {}),
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
            const rawTrace = prev.find((m) => m.id === replyId)?.executionTrace;
            // Finalize any live-thought sentinel so implementation ids never
            // persist or render after a stop.
            const trace = rawTrace?.map((s, i) =>
              s.id.startsWith("__")
                ? { ...s, id: `e${i + 1}`, status: s.status === "running" ? ("done" as const) : s.status }
                : s,
            );
            const stoppedAnalysis = { success: false, summary: STOPPED_SUMMARY };
            const partial = prev.find((m) => m.id === replyId)?.content?.trim() || "";
            void persistMessage({
              ...replyMsg,
              content: partial || "Stopped.",
              executionTrace: trace,
              runAnalysis: stoppedAnalysis,
              interrupted: { reason: "stopped" },
            });
            return prev.map((msg) =>
              msg.id === replyId
                ? {
                    ...msg,
                    content: msg.content.trim() || "Stopped.",
                    executionTrace: trace,
                    runAnalysis: stoppedAnalysis,
                    interrupted: { reason: "stopped" as const },
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

      // If the agent already produced partial output before the failure
      // (disconnect, token limit, provider error mid-stream), KEEP that work in
      // the chat as an interrupted turn the user can continue — never discard it.
      const current = messagesRef.current.find((m) => m.id === replyId);
      const hasPartial =
        !!current &&
        (current.content.trim().length > 0 || (current.executionTrace?.length ?? 0) > 0);

      if (hasPartial) {
        lastFailedSendRef.current = null;
        const trace = current!.executionTrace?.map((s, i) =>
          s.id.startsWith("__")
            ? { ...s, id: `e${i + 1}`, status: s.status === "running" ? ("done" as const) : s.status }
            : s,
        );
        const interruptedAnalysis = { success: false, summary: INTERRUPTED_SUMMARY };
        const interruptedMsg: ChatMessage = {
          ...replyMsg,
          content: current!.content.trim() || "Interrupted.",
          executionTrace: trace,
          runAnalysis: interruptedAnalysis,
          interrupted: { reason: "error", message: errorMessage },
        };
        setMessages((prev) =>
          prev.map((msg) => (msg.id === replyId ? interruptedMsg : msg)),
        );
        void persistMessage(interruptedMsg).then((serverId) => {
          if (serverId && mountedRef.current) {
            setMessages((prev) =>
              prev.map((m) => (m.id === replyId ? { ...m, serverId } : m)),
            );
          }
        });
        return;
      }

      // Nothing produced yet — surface the failure ONCE as an in-chat notice
      // (with Retry). Do not also set the composer banner (double-show).
      lastFailedSendRef.current = {
        text,
        attachments: turnAttachments,
        priorMessages: priorMessages.filter((m) => m.id !== pendingUserMsg.id),
        pendingUserMsg,
      };
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
      if (mountedRef.current) {
        setIsThinking(false);
        setLiveStatus(undefined);
      }
      useAppStore.getState().setAgentWorking(false);
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

  // Send a continuation turn directly to the CURRENT agent — no routing. Used
  // for credential-saved resumes and clarification answers, which must never
  // be handed off to a different agent by the router.
  function sendDirect(text: string) {
    if (isThinking) return;
    const pendingUserMsg: ChatMessage = {
      id: Math.random().toString(36).slice(2),
      role: "user",
      content: text,
      createdAt: new Date().toISOString(),
    };
    void runTurn(text, messagesRef.current, [], pendingUserMsg, undefined);
  }

  // Resume a turn that was stopped or interrupted mid-flight. The prior partial
  // answer + reasoning are already in the history, so the agent picks up where
  // it left off instead of restarting.
  function continueInterrupted() {
    if (isThinking) return;
    sendDirect(
      "Continue from where you left off. Pick up exactly where the previous response stopped — do not repeat work you already completed.",
    );
  }

  // User saved or dismissed an inline credential box. Update + persist the box
  // state; once every box in the message is resolved and at least one key was
  // saved, resume the agent automatically.
  function handleCredentialResolved(
    messageId: string,
    info: { service: string; label: string },
    action: "saved" | "dismissed",
  ) {
    const msg = messagesRef.current.find((m) => m.id === messageId);
    if (!msg?.credentialRequests) return;
    const nextReqs = msg.credentialRequests.map((r) =>
      r.service === info.service && r.label === info.label ? { ...r, status: action } : r,
    );
    const nextMsg: ChatMessage = { ...msg, credentialRequests: nextReqs };
    setMessages((prev) => prev.map((m) => (m.id === messageId ? nextMsg : m)));
    if (nextMsg.serverId) void patchMessage(nextMsg.serverId, nextMsg);
    const pending = nextReqs.some((r) => !r.status || r.status === "pending");
    const saved = nextReqs.filter((r) => r.status === "saved").map((r) => r.label);
    const skipped = nextReqs
      .filter((r) => r.status === "dismissed")
      .map((r) => r.label);
    // Resume once every key has been resolved (saved OR skipped) — the user may
    // deliberately skip them all, in which case the agent should still continue
    // (using placeholders/mocks) rather than hang waiting for a key.
    if (!pending && !isThinking && (saved.length > 0 || skipped.length > 0)) {
      const parts: string[] = [];
      if (saved.length) parts.push(`saved ${saved.join(", ")} to the vault`);
      if (skipped.length) parts.push(`skipped ${skipped.join(", ")} for now`);
      const tail = saved.length
        ? "Please continue."
        : "Please continue without those keys — use placeholders/mocks where needed.";
      sendDirect(`I've ${parts.join(" and ")}. ${tail}`);
    }
  }

  // User connected or skipped an inline "Connect your <App>" card. Update +
  // persist the card state; once every card in the message is resolved, resume
  // the agent automatically with which apps were connected vs skipped.
  function handleConnectionResolved(
    messageId: string,
    info: { app: string; action: "connected" | "dismissed"; credentialId?: string },
  ) {
    const msg = messagesRef.current.find((m) => m.id === messageId);
    if (!msg?.connectionRequests) return;
    const nextReqs = msg.connectionRequests.map((r) =>
      r.app === info.app
        ? { ...r, status: info.action, credentialId: info.credentialId }
        : r,
    );
    const nextMsg: ChatMessage = { ...msg, connectionRequests: nextReqs };
    setMessages((prev) => prev.map((m) => (m.id === messageId ? nextMsg : m)));
    if (nextMsg.serverId) void patchMessage(nextMsg.serverId, nextMsg);
    const pending = nextReqs.some((r) => !r.status || r.status === "pending");
    const connected = nextReqs.filter((r) => r.status === "connected");
    const skipped = nextReqs.filter((r) => r.status === "dismissed").map((r) => r.name);
    // Resume once every connection is resolved (connected OR skipped) — like
    // credential boxes, an all-skipped turn still resumes so the agent can
    // adapt rather than hang.
    if (!pending && !isThinking && (connected.length > 0 || skipped.length > 0)) {
      const parts: string[] = [];
      if (connected.length) {
        parts.push(
          `connected ${connected
            .map((r) => `${r.name}${r.credentialId ? ` (credentialId: ${r.credentialId})` : ""}`)
            .join(", ")}`,
        );
      }
      if (skipped.length) parts.push(`skipped connecting ${skipped.join(", ")}`);
      const tail = connected.length
        ? "Please continue — the connected apps are now available via mcp_list_servers / app_search."
        : "Please continue without those connections — use placeholders where needed or suggest alternatives.";
      sendDirect(`I've ${parts.join(" and ")}. ${tail}`);
    }
  }

  // User clicked a multiple-choice clarification option — mark it answered and
  // send the choice back so the agent resumes with the answer.
  function handleClarificationAnswer(messageId: string, answer: string) {
    if (isThinking) return;
    const msg = messagesRef.current.find((m) => m.id === messageId);
    const nextMsg = msg ? { ...msg, clarificationAnswered: true } : undefined;
    setMessages((prev) =>
      prev.map((m) => (m.id === messageId ? { ...m, clarificationAnswered: true } : m)),
    );
    if (nextMsg?.serverId) void patchMessage(nextMsg.serverId, nextMsg);
    sendDirect(answer);
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
        // Show the user's message immediately so the send feels instant while
        // the agent is created in the background — the handoff seeds the same
        // content into the new pane, so there's no blank flash on remount.
        setMessages([
          {
            id: Math.random().toString(36).slice(2),
            role: "user",
            content,
            attachments: attachments.length ? attachments : undefined,
            createdAt: new Date().toISOString(),
          },
        ]);
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
        // Keep the thinking indicator up through the remount+handoff so the
        // stream appears continuous instead of momentarily going quiet.
        setActiveConversation(conversationIdForWorkflow(created.id));
        setMobilePane("chat");
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
            liveStatus={
              isThinking && i === messages.length - 1 && m.role === "agent"
                ? liveStatus
                : undefined
            }
            onEditArtifact={openArtifactForEdit}
            onCredentialResolved={handleCredentialResolved}
            onConnectionResolved={handleConnectionResolved}
            onPickPrompt={(prompt) => send({ text: prompt })}
            onClarify={handleClarificationAnswer}
            onRetryFailedSend={retryFromDeliveryError}
            onDismissDeliveryError={dismissDeliveryError}
            onOpenProgressPanel={openProgressPanel}
            isLast={i === messages.length - 1}
            onContinue={continueInterrupted}
          />
        ))}
        {isThinking && messages[messages.length - 1]?.role !== "agent" && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <div className="flex h-6 w-6 items-center justify-center rounded-md bg-accent text-foreground">
              {isNewChat ? <MessageSquare className="h-3.5 w-3.5" /> : <ApicalMark className="h-3.5" />}
            </div>
            <span className="flex gap-1">
              <Dot delay={0} />
              <Dot delay={150} />
              <Dot delay={300} />
            </span>
          </div>
        )}
      </div>

      {/* User-initiated freeze: until now only the model could decide to call
          workflow_freeze. This gives the user an explicit "keep this" control;
          the save still funnels through the validated workflow_freeze path. */}
      {!isNewChat && agent && !isThinking && messages.some((m) => m.role === "agent") && (
        <div className="flex justify-end px-3 pb-1">
          <button
            onClick={() =>
              sendDirect(
                "Save what you did in this conversation as my repeatable workflow. Distill the steps you actually executed (use workflow_freeze), keep it faithful to what happened, and tell me exactly what you saved.",
              )
            }
            className="flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            title="Distill this conversation into the agent's saved workflow"
          >
            <Save className="h-3 w-3" /> Save as workflow
          </button>
        </div>
      )}

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
  liveStatus,
  onEditArtifact,
  onCredentialResolved,
  onConnectionResolved,
  onPickPrompt,
  onClarify,
  onRetryFailedSend,
  onDismissDeliveryError,
  onOpenProgressPanel,
  isLast,
  onContinue,
}: {
  message: ChatMessage;
  agentName: string;
  isStreaming?: boolean;
  isAnalyzing?: boolean;
  liveStatus?: string;
  onEditArtifact?: (a: ChatAttachment) => void;
  onCredentialResolved?: (
    messageId: string,
    info: { service: string; label: string },
    action: "saved" | "dismissed",
  ) => void;
  onConnectionResolved?: (
    messageId: string,
    info: { app: string; action: "connected" | "dismissed"; credentialId?: string },
  ) => void;
  onPickPrompt?: (prompt: string) => void;
  onClarify?: (messageId: string, answer: string) => void;
  onRetryFailedSend?: (payload: { text: string; attachments?: ChatAttachment[] }) => void;
  onDismissDeliveryError?: (messageId: string) => void;
  onOpenProgressPanel?: (stepId: string) => void;
  isLast?: boolean;
  onContinue?: () => void;
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
    <div className="group/message space-y-1.5">
      <div className="flex select-none items-center gap-1.5 text-[10px] font-medium text-muted-foreground">
        <span>{agentName}</span>
      </div>
      {(message.executionTrace?.length ||
        isStreaming ||
        (message.checklist && message.checklist.length > 0) ||
        message.runAnalysis ||
        (isAnalyzing && !message.runAnalysis)) && (
        <div className="select-none">
          <ActivityFlow
            steps={message.executionTrace ?? []}
            plan={message.checklist}
            liveStatus={liveStatus}
            isStreaming={!!isStreaming}
            analysis={message.runAnalysis}
            analyzing={!!isAnalyzing && !message.runAnalysis}
            stopped={
              !!message.interrupted ||
              message.runAnalysis?.summary === STOPPED_SUMMARY ||
              message.runAnalysis?.summary === INTERRUPTED_SUMMARY
            }
            startedAt={message.createdAt}
            onOpenProgressPanel={onOpenProgressPanel}
          />
        </div>
      )}
      <div className="text-sm text-foreground">
        {message.content ? (
          <MarkdownText text={message.content} />
        ) : isStreaming ? null : (
          <span className="text-muted-foreground italic">…</span>
        )}
      </div>
      {message.interrupted && isLast && !isStreaming && onContinue && (
        <div className="mt-2 flex select-none flex-col gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2">
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <AlertTriangle className="h-3 w-3 text-amber-500" />
            {message.interrupted.reason === "stopped"
              ? "You stopped this response."
              : `This response was interrupted${message.interrupted.message ? ` (${message.interrupted.message})` : ""}.`}
          </div>
          <button
            type="button"
            onClick={onContinue}
            className="inline-flex w-fit items-center gap-1.5 rounded-md bg-foreground px-2.5 py-1 text-[11px] font-medium text-background transition-opacity hover:opacity-90"
          >
            <Play className="h-3 w-3" /> Continue where it left off
          </button>
        </div>
      )}
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
      {message.credentialRequests && message.credentialRequests.length > 0 && (
        <div className="select-none">
          <CredentialRequestList
            requests={message.credentialRequests}
            onSaved={(info) => onCredentialResolved?.(message.id, info, "saved")}
            onDismiss={(info) => onCredentialResolved?.(message.id, info, "dismissed")}
          />
        </div>
      )}
      {message.connectionRequests && message.connectionRequests.length > 0 && (
        <div className="select-none">
          <ConnectAccountCardList
            requests={message.connectionRequests}
            onResolved={(info) => onConnectionResolved?.(message.id, info)}
          />
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
        <ProposedWorkflowCard
          title={`Proposed workflow: ${message.workflowProposal.name}`}
          detail={message.workflowProposal.description}
          name={message.workflowProposal.name}
          description={message.workflowProposal.description}
          steps={message.workflowProposal.steps}
        />
      )}
      {message.automateOffer && (
        <ProposedWorkflowCard
          title="Automate this?"
          detail={message.automateOffer.summary}
          name={message.automateOffer.name}
          description={message.automateOffer.summary}
          steps={message.automateOffer.steps}
        />
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

/** Proposed-workflow chat card with a real Accept action → POST /v1/workflows. */
function ProposedWorkflowCard({
  title,
  detail,
  name,
  description,
  steps,
}: {
  title: string;
  detail: string;
  name: string;
  description: string;
  steps: { version: 1 | 2; steps: unknown[] };
}) {
  const createWorkflow = useCreateWorkflow();
  const [created, setCreated] = React.useState<{ id: string; name: string } | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function accept() {
    setError(null);
    try {
      const wf = await createWorkflow.mutateAsync({
        name,
        description,
        steps: steps as import("@/lib/types").WorkflowJSON,
        origin: "chat",
      });
      setCreated({ id: wf.id, name: wf.name });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save the workflow.");
    }
  }

  return (
    <div className="mt-2 select-none rounded-md border border-border bg-muted p-2.5 text-xs">
      <div className="mb-1 font-semibold text-foreground">{title}</div>
      <p className="text-muted-foreground">{detail}</p>
      <div className="mt-1.5 text-[10px] text-muted-foreground">{steps.steps.length} steps</div>
      {created ? (
        <div className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <CheckCircle2 className="h-3 w-3 text-foreground" />
          Saved as <span className="font-medium text-foreground">{created.name}</span> — it&rsquo;s in your agents list.
        </div>
      ) : (
        <div className="mt-2 flex items-center gap-2">
          <Button
            size="sm"
            className="h-6 px-2.5 text-[11px]"
            disabled={createWorkflow.isPending || steps.steps.length === 0}
            onClick={() => void accept()}
          >
            {createWorkflow.isPending ? (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            ) : (
              <Check className="mr-1 h-3 w-3" />
            )}
            Accept &amp; save
          </Button>
          {error && <span className="text-[10px] text-destructive">{error}</span>}
        </div>
      )}
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

// ─── Right rail: agent inspector + standalone progress ─────────────────────

function RightRailPane({
  agent,
  showInspector,
  showData,
}: {
  agent?: Workflow;
  showInspector: boolean;
  showData: boolean;
}) {
  if (showInspector && agent) {
    return <InspectorPane agent={agent} embedded />;
  }
  if (showData) {
    return <SandboxPanel mode="progress" showClose className="border-l-0" />;
  }
  return null;
}

// ─── Right pane: inspector ─────────────────────────────────────────────────

function InspectorPane({ agent, embedded }: { agent: Workflow; embedded?: boolean }) {
  const section = useAppStore((s) => s.inspectorSection);
  const setSection = useAppStore((s) => s.setInspectorSection);
  const status = agentStatus(agent);
  const autoPct = Math.round((agent.automaticCount / Math.max(agent.itemsProcessed, 1)) * 100);

  return (
    <aside className={cn("flex h-full w-full min-w-0 flex-col overflow-hidden bg-muted/30", !embedded && "border-l border-border")}>
      <div className="flex shrink-0 items-center gap-0.5 border-b border-border bg-background/50 p-1">
        {INSPECTOR_TABS.map((s) => (
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

      <div className="min-h-0 flex-1 overflow-hidden">
        {section === "overview" && (
          <div className="h-full overflow-y-auto overscroll-contain">
            <InspectorOverview agent={agent} status={status} autoPct={autoPct} onGoSection={setSection} />
          </div>
        )}
        {section === "progress" && (
          <SandboxPanel mode="progress" embedded showClose={false} className="border-l-0" />
        )}
        {section === "workflow" && (
          <div className="h-full overflow-y-auto overscroll-contain">
            <AgentWorkflow agent={agent} />
          </div>
        )}
        {section === "config" && (
          <div className="h-full overflow-y-auto overscroll-contain">
            <AgentConfig agent={agent} />
          </div>
        )}
        {section === "runs" && (
          <div className="h-full space-y-4 overflow-y-auto overscroll-contain p-3">
            <AgentRunSection workflowId={agent.id} />
            <div>
              <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Long-task agent runs
              </div>
              <AgentRunsPanel agentId={agent.id} />
            </div>
            <div>
              <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Compute jobs
              </div>
              <JobsPanel agentId={agent.id} />
            </div>
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
  onGoSection: (s: (typeof INSPECTOR_TABS)[number]) => void;
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
          {agent.trigger === "schedule" ? `Schedule · ${humanizeSchedule(agent.schedule)}` : "Manual trigger"}
        </div>
        <div className="mt-1 text-[10px] text-muted-foreground">
          {agent.runsCount} runs · {agent.itemsProcessed.toLocaleString()} items
        </div>
      </div>

      {/* About */}
      {agent.description && (
        <div className="rounded-lg border border-border bg-card p-3">
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">About</div>
          <p className="text-[11px] leading-relaxed">{agent.description}</p>
        </div>
      )}

      {/* LOUD flagged button */}
      {agent.flaggedCount > 0 && (
        <button
          onClick={() => onGoSection("progress")}
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

      {/* Schedule — edit time/frequency inline without digging into Config */}
      {agent.trigger === 'schedule' && (
        <div className="rounded-lg border border-border bg-card p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Schedule
            </span>
            <button
              type="button"
              onClick={() => onGoSection('config')}
              className="text-[10px] text-muted-foreground hover:text-foreground hover:underline"
            >
              More settings →
            </button>
          </div>
          <ScheduleEditor workflowId={agent.id} compact autoSave />
        </div>
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
          <button onClick={() => onGoSection("runs")} className="text-[10px] text-muted-foreground hover:text-foreground hover:underline">Run log →</button>
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
        <button onClick={() => onGoSection("progress")} className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-left text-[11px] hover:border-border">
          <ListChecks className="h-3.5 w-3.5 text-muted-foreground" /> View progress
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
  const [description, setDescription] = React.useState(agent.description);
  const [trigger, setTrigger] = React.useState<"manual" | "schedule">(agent.trigger);
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
      const res = await fetch(`/v1/workflows/${agent.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description,
          trigger,
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
            <div className="space-y-1.5 sm:col-span-2">
              <Label className="text-xs">Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} className="h-9 text-sm" />
            </div>
          </div>
          <div className="mt-3 space-y-1.5">
            <Label className="text-xs">Description</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className="text-sm" />
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Runtime &amp; schedule</h3>
          {runtime === "local" && (
            <div className="mb-3">
              <DesktopStatusChip />
            </div>
          )}
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
                <div className="mt-1 text-[10px] text-muted-foreground">Uses this computer&apos;s files and apps. Requires the desktop app running in the background; enable Remote Access in desktop Settings for web/scheduled runs.</div>
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
                <div className="mt-1 text-[10px] text-muted-foreground">Runs entirely in Apical&apos;s cloud. No desktop filesystem or CLI access.</div>
              </button>
            </div>
          </div>
          <div className="mt-3 space-y-1.5">
            <Label className="text-xs">Trigger</Label>
            <select
              value={trigger}
              onChange={(e) => setTrigger(e.target.value as "manual" | "schedule")}
              className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
            >
              <option value="manual">Manual — run on demand</option>
              <option value="schedule">Schedule — run automatically</option>
            </select>
          </div>
          {trigger === "schedule" && (
            <div className="mt-3 border-t border-border pt-3">
              <ScheduleEditor workflowId={agent.id} autoSave />
            </div>
          )}
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
