/**
 * App-wide UI state for the logged-in Apical shell.
 */
import { create } from "zustand";
import type { SandboxItem } from "@/lib/apical/sandbox";
import { isAccumulatingDeliverable } from "@/lib/apical/sandbox";

export type Mode =
  | "agents"
  | "vault"
  | "data"
  | "billing"
  | "settings"
  | "templates"
  | "activity"
  | "memory";

/** Which section is expanded in the right-rail inspector (desktop) or the
 *  detail slide-up (mobile). */
export type InspectorSection = "overview" | "dashboard" | "workflow" | "config";
export type VaultSection = "connections" | "tokens" | "integrations" | "desktop";
export type RightRailTab = "preview" | "progress" | "inspector";
export type MobilePane = "list" | "chat" | "detail" | "preview" | "progress";

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
  /** Mobile: which pane is active (list / chat / detail / preview). */
  mobilePane: MobilePane;
  setMobilePane: (p: MobilePane) => void;
  /** Preview/sandbox panel — tool outputs, data, code results. */
  sandboxItems: SandboxItem[];
  sandboxOpen: boolean;
  rightRailTab: RightRailTab;
  addSandboxItem: (item: SandboxItem) => void;
  clearSandbox: () => void;
  setSandboxOpen: (v: boolean) => void;
  setRightRailTab: (t: RightRailTab) => void;
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
  popoutConversationId: null,
  setPopoutConversation: (id) => set({ popoutConversationId: id }),
  inspectorOpen: true,
  setInspectorOpen: (v) => set({ inspectorOpen: v }),
  toggleInspector: () => set((s) => ({ inspectorOpen: !s.inspectorOpen })),
  mobilePane: "list",
  setMobilePane: (p) => set({ mobilePane: p }),
  sandboxItems: [],
  sandboxOpen: false,
  rightRailTab: "progress",
  addSandboxItem: (item) =>
    set((s) => {
      let items = [...s.sandboxItems];
      // Preview shows user deliverables. Files/images accumulate; tables and
      // other primary outputs replace the previous one (latest end result wins).
      if (item.isResult && !isAccumulatingDeliverable(item.resultFormat)) {
        items = items.filter(
          (x) => !x.isResult || isAccumulatingDeliverable(x.resultFormat),
        );
      }
      items.push(item);

      const nextTab: RightRailTab = item.isResult
        ? "preview"
        : s.rightRailTab === "inspector"
          ? "inspector"
          : "progress";
      return { sandboxItems: items, sandboxOpen: true, rightRailTab: nextTab };
    }),
  clearSandbox: () => set({ sandboxItems: [] }),
  setSandboxOpen: (v) => set({ sandboxOpen: v }),
  setRightRailTab: (t) => set({ rightRailTab: t }),
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
