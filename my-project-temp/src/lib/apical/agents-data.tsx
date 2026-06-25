'use client'

import * as React from 'react'
import { useWorkflows, useCreateWorkflow } from '@/lib/queries'
import type { Workflow as ApiWorkflow } from '@/lib/types'
import type { Conversation, Workflow } from './index'
import { useAppStore } from './store'

export const ORCHESTRATOR_CONVERSATION: Conversation = {
  id: 'orchestrator',
  title: 'Orchestrator',
  pinned: true,
  workflowId: undefined,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
}

export function conversationIdForWorkflow(workflowId: string): string {
  return `agent-${workflowId}`
}

export function conversationsFromWorkflows(workflows: Workflow[]): Conversation[] {
  return [
    ORCHESTRATOR_CONVERSATION,
    ...workflows.map((w) => ({
      id: conversationIdForWorkflow(w.id),
      title: w.name,
      pinned: false,
      workflowId: w.id,
      createdAt: w.createdAt,
      updatedAt: w.updatedAt,
    })),
  ]
}

function toApicalWorkflow(w: ApiWorkflow): Workflow {
  return w as unknown as Workflow
}

type AgentsDataContextValue = {
  workflows: Workflow[]
  conversations: Conversation[]
  isLoading: boolean
  createAgent: () => Promise<Workflow>
  isCreating: boolean
}

const AgentsDataContext = React.createContext<AgentsDataContextValue | null>(null)

export function AgentsDataProvider({ children }: { children: React.ReactNode }) {
  const { data, isLoading } = useWorkflows()
  const createMutation = useCreateWorkflow()

  const workflows = React.useMemo(
    () => (data ?? []).map(toApicalWorkflow),
    [data],
  )

  const conversations = React.useMemo(
    () => conversationsFromWorkflows(workflows),
    [workflows],
  )

  const createAgent = React.useCallback(async () => {
    const count = workflows.filter((w) => /^New agent(\s\d+)?$/.test(w.name)).length
    const name = count === 0 ? 'New agent' : `New agent ${count + 1}`
    const created = await createMutation.mutateAsync({
      name,
      description: 'Tell Apical what repetitive job this agent should take over.',
      steps: { version: 1, steps: [] },
      department: 'General',
      title: 'Agent',
    })
    return toApicalWorkflow(created)
  }, [workflows, createMutation])

  const value = React.useMemo(
    () => ({
      workflows,
      conversations,
      isLoading,
      createAgent,
      isCreating: createMutation.isPending,
    }),
    [workflows, conversations, isLoading, createAgent, createMutation.isPending],
  )

  return <AgentsDataContext.Provider value={value}>{children}</AgentsDataContext.Provider>
}

export function useAgentsData() {
  const ctx = React.useContext(AgentsDataContext)
  if (!ctx) throw new Error('useAgentsData must be used within AgentsDataProvider')
  return ctx
}

export function useActiveAgent() {
  const activeConversationId = useAppStore((s) => s.activeConversationId)
  const setActiveConversation = useAppStore((s) => s.setActiveConversation)
  const { conversations, workflows, isLoading } = useAgentsData()
  const activeConvo = conversations.find((c) => c.id === activeConversationId)
  const activeAgent = activeConvo?.workflowId
    ? workflows.find((w) => w.id === activeConvo.workflowId)
    : undefined
  const isOrchestrator = activeConversationId === 'orchestrator'

  React.useEffect(() => {
    if (isLoading || !activeConversationId) return
    const valid = conversations.some((c) => c.id === activeConversationId)
    if (!valid) setActiveConversation('orchestrator')
  }, [isLoading, conversations, activeConversationId, setActiveConversation])

  return { activeConvo, activeAgent, isOrchestrator, conversations, workflows }
}
