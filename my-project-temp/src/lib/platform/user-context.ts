import { db } from '@/lib/db'
import { loadIntegrations } from '@/lib/mappers'

/** Workspace + roster context injected into every agent turn. */
export async function loadUserContextBlock(userId: string): Promise<string> {
  // Resolve the user's primary workspace for integration visibility.
  const membership = await db.workspaceMember.findFirst({
    where: { userId },
    orderBy: { createdAt: 'asc' },
    select: { workspaceId: true },
  })
  const legacyWs = membership
    ? null
    : await db.workspace.findFirst({ where: { userId }, select: { id: true } })
  const workspaceId = membership?.workspaceId ?? legacyWs?.id ?? null

  const [profile, agents, integrations] = await Promise.all([
    db.userProfile.findUnique({ where: { userId } }),
    // Orientation only — the id/name/status is enough. Full stepsJson is loaded
    // separately for the acting agent, or fetched on demand via workflow tools.
    db.workflow.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        name: true,
        description: true,
        status: true,
        schedule: true,
        trigger: true,
      },
    }),
    loadIntegrations(workspaceId),
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
      lines.push(
        `  - id="${a.id}" · ${a.name} · ${a.status}` +
          (a.schedule ? ` · ${a.schedule}` : '') +
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
