import type { Workflow } from './index'
import type { Run } from '@/lib/types'

export interface SchedulerJobSummary {
  workflowId: string
  status: string
}

export interface AgentRingState {
  runningWorkflowIds: ReadonlySet<string>
  scheduledWorkflowIds: ReadonlySet<string>
  workingWorkflowId: string | null
}

const ACTIVE_RUN_STATUSES = new Set(['running', 'awaiting_gate'])

/** Build ring lookup sets from runs, scheduler jobs, and the in-chat working agent. */
export function buildAgentRingState(opts: {
  runs?: Pick<Run, 'workflowId' | 'status'>[]
  schedulerJobs?: SchedulerJobSummary[]
  workingWorkflowId?: string | null
}): AgentRingState {
  const runningWorkflowIds = new Set<string>()
  for (const run of opts.runs ?? []) {
    if (ACTIVE_RUN_STATUSES.has(run.status)) {
      runningWorkflowIds.add(run.workflowId)
    }
  }
  if (opts.workingWorkflowId) {
    runningWorkflowIds.add(opts.workingWorkflowId)
  }

  const scheduledWorkflowIds = new Set<string>()
  for (const job of opts.schedulerJobs ?? []) {
    if (job.status === 'active') {
      scheduledWorkflowIds.add(job.workflowId)
    }
  }

  return {
    runningWorkflowIds,
    scheduledWorkflowIds,
    workingWorkflowId: opts.workingWorkflowId ?? null,
  }
}

/** Green ring when a workflow run is active or the agent has a live schedule. */
export function agentShowsLiveRing(agent: Workflow, state: AgentRingState): boolean {
  if (agent.status === 'paused' || agent.status === 'draft') return false
  if (state.runningWorkflowIds.has(agent.id)) return true
  if (state.scheduledWorkflowIds.has(agent.id)) return true
  return false
}

/** Sidebar avatar ring — only scheduled or in-progress agents; high-contrast green. */
export function agentWorkflowRingClass(
  agent: Workflow,
  state?: AgentRingState,
): string | undefined {
  if (!state || !agentShowsLiveRing(agent, state)) return undefined
  return 'ring-2 ring-emerald-500 ring-offset-1 ring-offset-background'
}

export function buildEditHandoffPrompt(originalMessage: string, changeSummary: string): string {
  return (
    `The user requested changes to your configuration or workflow:\n\n` +
    `${changeSummary}\n\n` +
    `Original message: "${originalMessage}"\n\n` +
    `Before making ANY changes (workflow_update, schedule changes, etc.), confirm your understanding. ` +
    `Reply with what you understand they want — list the specific changes as X, Y, and Z — and ask: "Is this correct?" ` +
    `Do NOT call workflow_update or apply changes until the user confirms.`
  )
}
