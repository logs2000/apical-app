import { db } from '@/lib/db'
import { loadIntegrations } from '@/lib/mappers'
import { savedWorkflowHasExecutableSteps } from './workflow-trace'

/** Workspace + roster context injected into every agent turn. */
export async function loadUserContextBlock(userId: string): Promise<string> {
  const [profile, agents, integrations] = await Promise.all([
    db.userProfile.findUnique({ where: { userId } }),
    db.workflow.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        name: true,
        title: true,
        description: true,
        status: true,
        stepsJson: true,
        schedule: true,
        trigger: true,
      },
    }),
    loadIntegrations(),
  ])

  const lines: string[] = ['USER & WORKSPACE CONTEXT:']

  if (profile) {
    const parts: string[] = []
    if (profile.companyName?.trim()) parts.push(`Company: ${profile.companyName.trim()}`)
    if (profile.industry?.trim()) parts.push(`Industry: ${profile.industry.trim()}`)
    if (profile.notes?.trim()) parts.push(`Notes: ${profile.notes.trim().slice(0, 500)}`)
    if (parts.length > 0) lines.push(parts.join('\n'))
  }

  const connected = integrations.filter((i) => i.status === 'connected')
  if (connected.length > 0) {
    lines.push(
      `Connected integrations (${connected.length}): ${connected.map((i) => i.name).join(', ')}`,
    )
  }

  if (agents.length > 0) {
    lines.push('\nUser\'s agents:')
    for (const a of agents) {
      const hasWf = savedWorkflowHasExecutableSteps(a.stepsJson)
      const wfLabel = hasWf ? 'has workflow' : 'no workflow yet'
      lines.push(
        `  - id="${a.id}" · ${a.name}${a.title ? ` (${a.title})` : ''} · ${a.status} · ${wfLabel}` +
          (a.description ? ` · ${a.description.slice(0, 120)}` : ''),
      )
    }
  } else {
    lines.push('\nUser has no agents yet.')
  }

  lines.push(
    '\nYou are a general intelligent assistant with this full context. Answer questions naturally and help with any task — you are not limited to automation-only replies.',
  )

  return lines.join('\n') + '\n\n'
}
