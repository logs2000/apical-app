/**
 * App-wide UI state for the logged-in Apical shell.
 */
import { create } from "zustand";

export type Mode =
  | "chat"
  | "agents"
  | "vault"
  | "data"
  | "billing"
  | "settings"
  | "templates"
  | "activity"
  | "memory";
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
  mode: "chat",
  setMode: (m) => set({ mode: m }),
  activeConversationId: "c1",
  setActiveConversation: (id) => set({ activeConversationId: id }),
  selectedWorkflowId: null,
  selectWorkflow: (id) => set({ selectedWorkflowId: id }),
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
