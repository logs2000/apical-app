'use client'

import { create } from 'zustand'
import type { ChatMessage } from './types'

export type Tab = 'chat' | 'agents' | 'vault' | 'data' | 'billing'
export type Mode = Tab | 'settings'
export type DevTab = 'overview' | 'library' | 'schema' | 'employees' | 'runs' | 'vault'
export type AgentDetailTab = 'dashboard' | 'workflow' | 'config' | 'data'

interface AppState {
  // Top-level: which tab (Chat primary, Workspace secondary, Developer hidden).
  mode: Mode
  setMode: (m: Mode) => void

  // Active workspace (filters agents + conversations). null = Main/default.
  activeWorkspaceId: string | null
  setActiveWorkspace: (id: string | null) => void

  // Active conversation in the chat tab.
  activeConversationId: string | null
  setActiveConversation: (id: string | null) => void

  // Which agent we're "talking about" in the chat (for edit-existing context).
  activeAgentId: string | null
  setActiveAgent: (id: string | null) => void

  // Chat messages for the active conversation (client-held for snappy UX).
  messages: ChatMessage[]
  setMessages: (m: ChatMessage[]) => void
  addMessage: (m: ChatMessage) => void
  clearMessages: () => void

  // The workflow illustration pane (right side of chat) shows the "focused" workflow —
  // either the active agent's, or the most recent proposal.
  focusWorkflowId: string | null
  setFocusWorkflow: (id: string | null) => void

  // Right pane visibility + sizes (configurable organization).
  rightPaneOpen: boolean
  setRightPaneOpen: (open: boolean) => void
  leftPaneOpen: boolean
  setLeftPaneOpen: (open: boolean) => void

  // Developer console tab.
  devTab: DevTab
  setDevTab: (t: DevTab) => void

  // Selected run (dev runs tab + live shift viewing).
  selectedRunId: string | null
  selectRun: (id: string | null) => void

  // Selected workflow (dev agents tab detail).
  selectedWorkflowId: string | null
  selectWorkflow: (id: string | null) => void

  // ---- Agent detail page (revamped) ----
  // Which tab is active on the agent detail page.
  agentDetailTab: AgentDetailTab
  setAgentDetailTab: (t: AgentDetailTab) => void
  // Collapsible left roster rail on the agent detail page.
  agentRosterRailOpen: boolean
  setAgentRosterRailOpen: (open: boolean) => void
  // Collapsible right chat rail on the agent detail page.
  agentChatRailOpen: boolean
  setAgentChatRailOpen: (open: boolean) => void
}

export const useAppStore = create<AppState>((set) => ({
  mode: 'chat',
  setMode: (m) => set({ mode: m }),

  activeWorkspaceId: null,
  setActiveWorkspace: (id) => set({ activeWorkspaceId: id }),

  activeConversationId: null,
  setActiveConversation: (id) => set({ activeConversationId: id }),

  activeAgentId: null,
  setActiveAgent: (id) => set({ activeAgentId: id, rightPaneOpen: true }),

  messages: [],
  setMessages: (m) => set({ messages: m }),
  addMessage: (m) => set((s) => ({ messages: [...s.messages, m] })),
  clearMessages: () => set({ messages: [] }),

  focusWorkflowId: null,
  setFocusWorkflow: (id) => set({ focusWorkflowId: id, rightPaneOpen: true }),

  rightPaneOpen: false,
  setRightPaneOpen: (open) => set({ rightPaneOpen: open }),
  leftPaneOpen: true,
  setLeftPaneOpen: (open) => set({ leftPaneOpen: open }),

  devTab: 'overview',
  setDevTab: (t) => set({ devTab: t }),

  selectedRunId: null,
  selectRun: (id) => set({ selectedRunId: id }),

  selectedWorkflowId: null,
  selectWorkflow: (id) => set({ selectedWorkflowId: id }),

  agentDetailTab: 'dashboard',
  setAgentDetailTab: (t) => set({ agentDetailTab: t }),
  agentRosterRailOpen: true,
  setAgentRosterRailOpen: (open) => set({ agentRosterRailOpen: open }),
  // On mobile the chat rail defaults closed; we'll detect viewport in the component.
  agentChatRailOpen: true,
  setAgentChatRailOpen: (open) => set({ agentChatRailOpen: open }),
}))

export function newId() {
  return Math.random().toString(36).slice(2, 10)
}
