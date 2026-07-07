/**
 * App-wide UI state for the logged-in Apical shell.
 */
import { create } from "zustand";
import type { SandboxItem } from "@/lib/apical/sandbox";
import { isAccumulatingDeliverable } from "@/lib/apical/sandbox";

const PINNED_CONVERSATIONS_KEY = "apical:pinned-conversations";
const DEFAULT_PINNED: string[] = [];

function readPinnedConversationIds(): string[] {
  if (typeof window === "undefined") return DEFAULT_PINNED;
  try {
    const raw = localStorage.getItem(PINNED_CONVERSATIONS_KEY);
    if (!raw) return DEFAULT_PINNED;
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : DEFAULT_PINNED;
  } catch {
    return DEFAULT_PINNED;
  }
}

function writePinnedConversationIds(ids: string[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(PINNED_CONVERSATIONS_KEY, JSON.stringify(ids));
}

export type Mode =
  | "agents"
  | "vault"
  | "data"
  | "billing"
  | "settings"
  | "templates"
  | "activity"
  | "memory"
  | "skills";

/** Active tab in the right-rail inspector (desktop) or detail pane (mobile). */
export type InspectorSection = "overview" | "progress" | "workflow" | "config" | "runs";
export type VaultSection = "apps" | "connections" | "tokens" | "integrations" | "desktop";
export type MobilePane = "list" | "chat" | "detail";

/** Auto-navigate to an agent chat and send an opening prompt (edit routing or first message). */
export interface PendingAgentHandoff {
  id: string;
  agentId: string;
  agentName: string;
  prompt: string;
  /** Edit handoffs require the agent to confirm before applying changes. */
  kind?: "edit" | "continue";
  attachments?: Array<{
    id: string;
    name: string;
    mimeType: string;
    kind: string;
    url: string;
    localPath?: string | null;
  }>;
}

/** A template the user has installed (one-click from the Templates gallery). */
export interface InstalledTemplate {
  id: string;
  name: string;
  category: string;
  installedAt: string;
}

interface AppState {
  mode: Mode;
  setMode: (m: Mode) => void;
  activeConversationId: string | null;
  setActiveConversation: (id: string | null) => void;
  selectedWorkflowId: string | null;
  selectWorkflow: (id: string | null) => void;
  /** When set, this window is a "pop-out" focused on a single conversation
   *  (desktop multi-window). The agent navigator rail is hidden. */
  popoutConversationId: string | null;
  setPopoutConversation: (id: string | null) => void;
  /** Whether the right-hand inspector panel is open (desktop). */
  inspectorOpen: boolean;
  setInspectorOpen: (v: boolean) => void;
  toggleInspector: () => void;
  /** Mobile: which pane is active (list / chat / detail). */
  mobilePane: MobilePane;
  setMobilePane: (p: MobilePane) => void;
  /** Right-rail inspector tab (Overview / Progress / Workflow / Config / Runs). */
  inspectorSection: InspectorSection;
  setInspectorSection: (s: InspectorSection) => void;
  /** Sandbox panel — tool outputs, data, code results (shown on Progress tab). */
  sandboxItems: SandboxItem[];
  sandboxOpen: boolean;
  /** True while the agent is actively working a turn — used to reveal the
   *  Progress rail immediately, before the first tool observation lands. */
  agentWorking: boolean;
  setAgentWorking: (v: boolean) => void;
  addSandboxItem: (item: SandboxItem) => void;
  clearSandbox: () => void;
  setSandboxOpen: (v: boolean) => void;
  /** A chat action row asked to reveal its matching Progress item — the panel
   *  scrolls to and briefly highlights the item with this step id. */
  highlightedStepId: string | null;
  setHighlightedStepId: (id: string | null) => void;
  vaultSection: VaultSection;
  setVaultSection: (s: VaultSection) => void;
  /** Templates the user has installed from the gallery (demo-only, no backend). */
  installedTemplates: InstalledTemplate[];
  installTemplate: (t: InstalledTemplate) => void;
  uninstallTemplate: (id: string) => void;
  /** Deleted memory-entry ids, per agent (demo-only). Keyed by agentId. */
  deletedMemory: Record<string, string[]>;
  deleteMemoryEntry: (agentId: string, entryId: string) => void;
  /** Drives tab switch + auto-sent prompt when routing to another agent. */
  pendingAgentHandoff: PendingAgentHandoff | null;
  setPendingAgentHandoff: (handoff: PendingAgentHandoff | null) => void;
  /** Sidebar pin order — persisted in localStorage (conversation ids). */
  pinnedConversationIds: string[];
  hydratePinnedConversations: () => void;
  togglePinConversation: (id: string) => void;
  /** Long-task mode: the next send runs as a DURABLE agent run (survives
   *  tab close; executed by the agent-worker). Persisted in localStorage. */
  durableMode: boolean;
  setDurableMode: (v: boolean) => void;
}

export const useAppStore = create<AppState>((set) => ({
  mode: "agents",
  setMode: (m) => set({ mode: m }),
  activeConversationId: "new-chat",
  setActiveConversation: (id) => set({ activeConversationId: id }),
  selectedWorkflowId: null,
  selectWorkflow: (id) => set({ selectedWorkflowId: id }),
  popoutConversationId: null,
  setPopoutConversation: (id) => set({ popoutConversationId: id }),
  // Open by default so the full Agent inspector (overview / progress /
  // workflow / config / runs) shows in the right rail whenever an agent is open
  // on a wide screen. Users can still collapse it via the header toggle / ⌘I.
  inspectorOpen: true,
  setInspectorOpen: (v) => set({ inspectorOpen: v }),
  toggleInspector: () => set((s) => ({ inspectorOpen: !s.inspectorOpen })),
  mobilePane: "list",
  setMobilePane: (p) => set({ mobilePane: p }),
  inspectorSection: "overview",
  setInspectorSection: (s) => set({ inspectorSection: s }),
  sandboxItems: [],
  sandboxOpen: false,
  agentWorking: false,
  setAgentWorking: (v) => set({ agentWorking: v }),
  addSandboxItem: (item) =>
    set((s) => {
      let items = [...s.sandboxItems];
      // Files/images accumulate; tables and other primary outputs replace the
      // previous one (latest end result wins).
      if (item.isResult && !isAccumulatingDeliverable(item.resultFormat)) {
        items = items.filter(
          (x) => !x.isResult || isAccumulatingDeliverable(x.resultFormat),
        );
      }
      items.push(item);
      return { sandboxItems: items, sandboxOpen: true };
    }),
  clearSandbox: () => set({ sandboxItems: [] }),
  setSandboxOpen: (v) => set({ sandboxOpen: v }),
  highlightedStepId: null,
  setHighlightedStepId: (id) => set({ highlightedStepId: id }),
  vaultSection: "apps",
  setVaultSection: (s) => set({ vaultSection: s }),
  installedTemplates: [],
  installTemplate: (t) =>
    set((s) =>
      s.installedTemplates.some((x) => x.id === t.id)
        ? s
        : { installedTemplates: [...s.installedTemplates, t] },
    ),
  uninstallTemplate: (id) =>
    set((s) => ({
      installedTemplates: s.installedTemplates.filter((x) => x.id !== id),
    })),
  deletedMemory: {},
  deleteMemoryEntry: (agentId, entryId) =>
    set((s) => ({
      deletedMemory: {
        ...s.deletedMemory,
        [agentId]: [...(s.deletedMemory[agentId] ?? []), entryId],
      },
    })),
  pendingAgentHandoff: null,
  setPendingAgentHandoff: (handoff) => set({ pendingAgentHandoff: handoff }),
  pinnedConversationIds: DEFAULT_PINNED,
  hydratePinnedConversations: () =>
    set({ pinnedConversationIds: readPinnedConversationIds() }),
  togglePinConversation: (id) =>
    set((s) => {
      const has = s.pinnedConversationIds.includes(id);
      const next = has
        ? s.pinnedConversationIds.filter((x) => x !== id)
        : [...s.pinnedConversationIds, id];
      writePinnedConversationIds(next);
      return { pinnedConversationIds: next };
    }),
  durableMode:
    typeof window !== "undefined" &&
    window.localStorage?.getItem("apical.durableMode") === "1",
  setDurableMode: (v) => {
    try {
      window.localStorage?.setItem("apical.durableMode", v ? "1" : "0");
    } catch {
      // private mode — in-memory only
    }
    set({ durableMode: v });
  },
}));
