'use client'

import type { Workflow } from './index'

export interface AgentRouteResult {
  action: 'continue' | 'route'
  targetAgentId?: string
  targetAgentName?: string
  changeSummary?: string
}

const EDIT_PATTERN =
  /\b(update|change|modify|edit|configure|adjust|tweak|fix|pause|resume|schedule|add|remove|rename|set)\b/i

/** Skip the LLM route call unless the message looks like an edit to another agent. */
export function shouldTryAgentRoute(
  message: string,
  agents: Workflow[],
  currentAgentId?: string | null,
): boolean {
  if (agents.length === 0) return false
  if (!EDIT_PATTERN.test(message)) return false

  const lower = message.toLowerCase()
  for (const agent of agents) {
    if (agent.id === currentAgentId) continue
    const name = agent.name.toLowerCase()
    if (name.length >= 3 && lower.includes(name)) return true
    if (agent.title && agent.title.length >= 3 && lower.includes(agent.title.toLowerCase())) return true
  }
  return false
}

export async function routeAgentMessage(input: {
  message: string
  currentAgentId?: string | null
  agents: Workflow[]
}): Promise<AgentRouteResult> {
  if (!shouldTryAgentRoute(input.message, input.agents, input.currentAgentId)) {
    return { action: 'continue' }
  }

  try {
    const res = await fetch('/api/agent/route', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: input.message,
        currentAgentId: input.currentAgentId ?? null,
      }),
    })
    if (!res.ok) return { action: 'continue' }
    return (await res.json()) as AgentRouteResult
  } catch {
    return { action: 'continue' }
  }
}
