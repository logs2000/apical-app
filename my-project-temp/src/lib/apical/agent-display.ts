import type { Workflow } from './index'
import { savedWorkflowHasExecutableSteps } from '@/lib/platform/workflow-trace'

export function agentHasSavedWorkflow(agent: Workflow): boolean {
  return savedWorkflowHasExecutableSteps(JSON.stringify(agent.steps))
}

/** Subtle avatar ring: green = active + workflow, gray = paused + workflow, none = no workflow. */
export function agentWorkflowRingClass(agent: Workflow): string | undefined {
  if (!agentHasSavedWorkflow(agent)) return undefined
  if (agent.status === 'paused') return 'ring-1 ring-muted-foreground/35'
  if (agent.status === 'active') return 'ring-1 ring-emerald-500/45'
  return undefined
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
