'use client'

import * as React from 'react'
import { useWorkflows, useCreateWorkflow, useDeleteWorkflow } from '@/lib/queries'
import type { Workflow as ApiWorkflow } from '@/lib/types'
import type { Conversation, Workflow } from './index'
import { useAppStore } from './store'

/** Ephemeral draft conversation — not shown in the sidebar until the first message. */
export const NEW_CHAT_CONVERSATION_ID = 'new-chat'

export function conversationIdForWorkflow(workflowId: string): string {
  return `agent-${workflowId}`
}

export function conversationsFromWorkflows(
  workflows: Workflow[],
  pinnedIds: string[],
): Conversation[] {
  return workflows.map((w) => ({
    id: conversationIdForWorkflow(w.id),
    title: w.name,
    pinned: pinnedIds.includes(conversationIdForWorkflow(w.id)),
    workflowId: w.id,
    createdAt: w.createdAt,
    updatedAt: w.updatedAt,
  }))
}

function toApicalWorkflow(w: ApiWorkflow): Workflow {
  return w as unknown as Workflow
}

type AgentsDataContextValue = {
  workflows: Workflow[]
  conversations: Conversation[]
  isLoading: boolean
  createConversationFromMessage: (message: string) => Promise<Workflow>
  deleteAgent: (workflowId: string) => Promise<void>
  isCreating: boolean
  isDeleting: boolean
  togglePin: (conversationId: string) => void
}

const AgentsDataContext = React.createContext<AgentsDataContextValue | null>(null)

export function AgentsDataProvider({ children }: { children: React.ReactNode }) {
  const { data, isLoading } = useWorkflows()
  const createMutation = useCreateWorkflow()
  const deleteMutation = useDeleteWorkflow()
  const pinnedConversationIds = useAppStore((s) => s.pinnedConversationIds)
  const hydratePinnedConversations = useAppStore((s) => s.hydratePinnedConversations)
  const togglePinConversation = useAppStore((s) => s.togglePinConversation)

  React.useEffect(() => {
    hydratePinnedConversations()
  }, [hydratePinnedConversations])

  const workflows = React.useMemo(
    () => (data ?? []).map(toApicalWorkflow),
    [data],
  )

  const conversations = React.useMemo(
    () => conversationsFromWorkflows(workflows, pinnedConversationIds),
    [workflows, pinnedConversationIds],
  )

  const createConversationFromMessage = React.useCallback(
    async (message: string) => {
      const fallbackName =
        message.trim().slice(0, 40).replace(/\s+/g, ' ').trim() || 'New chat'
      const created = await createMutation.mutateAsync({
        name: fallbackName,
        description: 'A conversation with Apical — ask anything or describe work to automate.',
        steps: { version: 1, steps: [] },
        department: 'General',
        origin: 'agent',
      })

      // Generate a nicer title in the background — don't block the first reply.
      void fetch('/api/agent/title', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      })
        .then(async (titleRes) => {
          if (!titleRes.ok) return
          const { name, description } = (await titleRes.json()) as {
            name: string
            description: string
          }
          await fetch(`/api/workflows/${created.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, description }),
          })
        })
        .catch(() => {})

      return toApicalWorkflow(created)
    },
    [createMutation],
  )

  const deleteAgent = React.useCallback(
    async (workflowId: string) => {
      const convoId = conversationIdForWorkflow(workflowId)
      await deleteMutation.mutateAsync(workflowId)
      if (pinnedConversationIds.includes(convoId)) {
        togglePinConversation(convoId)
      }
    },
    [deleteMutation, pinnedConversationIds, togglePinConversation],
  )

  const value = React.useMemo(
    () => ({
      workflows,
      conversations,
      isLoading,
      createConversationFromMessage,
      deleteAgent,
      isCreating: createMutation.isPending,
      isDeleting: deleteMutation.isPending,
      togglePin: togglePinConversation,
    }),
    [
      workflows,
      conversations,
      isLoading,
      createConversationFromMessage,
      deleteAgent,
      createMutation.isPending,
      deleteMutation.isPending,
      togglePinConversation,
    ],
  )

  return <AgentsDataContext.Provider value={value}>{children}</AgentsDataContext.Provider>
}

export function useAgentsData() {
  const ctx = React.useContext(AgentsDataContext)
  if (!ctx) throw new Error('useAgentsData must be used within AgentsDataProvider')
  return ctx
}

export function workflowIdFromConversation(conversationId: string | null): string | undefined {
  if (!conversationId?.startsWith('agent-')) return undefined
  return conversationId.slice('agent-'.length)
}

export function useActiveAgent() {
  const activeConversationId = useAppStore((s) => s.activeConversationId)
  const setActiveConversation = useAppStore((s) => s.setActiveConversation)
  const pendingAgentHandoff = useAppStore((s) => s.pendingAgentHandoff)
  const { conversations, workflows, isLoading, isCreating } = useAgentsData()
  const isNewChat = activeConversationId === NEW_CHAT_CONVERSATION_ID
  const workflowId = isNewChat ? undefined : workflowIdFromConversation(activeConversationId)
  const activeConvo = workflowId
    ? conversations.find((c) => c.workflowId === workflowId)
    : conversations.find((c) => c.id === activeConversationId)
  const activeAgent = workflowId ? workflows.find((w) => w.id === workflowId) : undefined

  React.useEffect(() => {
    if (!activeConversationId || isNewChat) return
    if (!workflowId) return

    // Never reset while a handoff is in flight — avoids blank new-chat race.
    if (pendingAgentHandoff) return

    const exists = workflows.some((w) => w.id === workflowId)
    if (!exists) {
      if (isLoading || isCreating) return
      setActiveConversation(NEW_CHAT_CONVERSATION_ID)
    }
  }, [
    isLoading,
    isCreating,
    workflows,
    activeConversationId,
    workflowId,
    isNewChat,
    setActiveConversation,
    pendingAgentHandoff,
  ])

  return { activeConvo, activeAgent, isNewChat, conversations, workflows, workflowId }
}

/** Sort sidebar rows: pinned first, then most recently updated. */
export function sortSidebarConversations(conversations: Conversation[]): Conversation[] {
  return [...conversations].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  })
}
