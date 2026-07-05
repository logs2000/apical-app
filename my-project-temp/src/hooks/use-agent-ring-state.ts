'use client'

import * as React from 'react'
import type { Workflow } from '@/lib/apical'
import {
  buildAgentRingState,
  type AgentRingState,
} from '@/lib/apical/agent-display'
import { useAppStore } from '@/lib/apical/store'
import { useRuns, useSchedulerJobs } from '@/lib/queries'

const NEW_CHAT_CONVERSATION_ID = 'new-chat'

function workflowIdFromConversation(conversationId: string): string | null {
  if (!conversationId.startsWith('agent-')) return null
  return conversationId.slice('agent-'.length)
}

/** Live ring inputs: running workflow runs, active scheduler jobs, in-chat work. */
export function useAgentRingState(workflows: Workflow[]): AgentRingState {
  const agentWorking = useAppStore((s) => s.agentWorking)
  const activeConversationId = useAppStore((s) => s.activeConversationId)
  const { data: runs } = useRuns(100)
  const { data: schedulerJobs } = useSchedulerJobs()

  const workingWorkflowId = React.useMemo(() => {
    if (
      !agentWorking ||
      !activeConversationId ||
      activeConversationId === NEW_CHAT_CONVERSATION_ID
    ) {
      return null
    }
    const wfId = workflowIdFromConversation(activeConversationId)
    if (!wfId || !workflows.some((w) => w.id === wfId)) return null
    return wfId
  }, [agentWorking, activeConversationId, workflows])

  return React.useMemo(
    () =>
      buildAgentRingState({
        runs: runs ?? [],
        schedulerJobs: schedulerJobs ?? [],
        workingWorkflowId,
      }),
    [runs, schedulerJobs, workingWorkflowId],
  )
}
