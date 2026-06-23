/**
 * App-wide UI state for the logged-in Apical shell.
 */
import { create } from "zustand";

export type Mode =
  | "agents"
  | "vault"
  | "data"
  | "billing"
  | "settings"
  | "templates"
  | "activity"
  | "memory";

/** The center-pane mode within the Agents view. */
export type AgentCenterMode = "chat" | "dashboard" | "workflow" | "config";
export type VaultSection = "connections" | "tokens" | "integrations" | "desktop";

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
  /** The center-pane mode within the Agents view (Chat / Dashboard / Workflow / Config). */
  agentCenterMode: AgentCenterMode;
  setAgentCenterMode: (m: AgentCenterMode) => void;
  /** Whether the right-hand inspector panel is open. */
  inspectorOpen: boolean;
  setInspectorOpen: (v: boolean) => void;
  toggleInspector: () => void;
  vaultSection: VaultSection;
  setVaultSection: (s: VaultSection) => void;
  /** Templates the user has installed from the gallery (demo-only, no backend). */
  installedTemplates: InstalledTemplate[];
  installTemplate: (t: InstalledTemplate) => void;
  uninstallTemplate: (id: string) => void;
  /** Deleted memory-entry ids, per agent (demo-only). Keyed by agentId. */
  deletedMemory: Record<string, string[]>;
  deleteMemoryEntry: (agentId: string, entryId: string) => void;
}

export const useAppStore = create<AppState>((set) => ({
  mode: "agents",
  setMode: (m) => set({ mode: m }),
  activeConversationId: "orchestrator",
  setActiveConversation: (id) => set({ activeConversationId: id }),
  selectedWorkflowId: null,
  selectWorkflow: (id) => set({ selectedWorkflowId: id }),
  agentCenterMode: "chat",
  setAgentCenterMode: (m) => set({ agentCenterMode: m }),
  inspectorOpen: true,
  setInspectorOpen: (v) => set({ inspectorOpen: v }),
  toggleInspector: () => set((s) => ({ inspectorOpen: !s.inspectorOpen })),
  vaultSection: "connections",
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
}));
