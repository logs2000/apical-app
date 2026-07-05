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
    db.userProfile.findUnique({
      where: { userId },
      // NOTE: `select` intentionally omitted so newly-added geo columns are
      // included without a second edit here.
    }),
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

  lines.push(geographyBlock(profile))

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

/** Optional geography/locale fields on the profile (added incrementally). */
interface GeoProfile {
  timezone?: string | null
  locale?: string | null
  country?: string | null
  region?: string | null
  city?: string | null
}

/**
 * A TIME & PLACE block so the agent can resolve "today"/"now", business hours,
 * currency, local services, etc. — and knows when it must ASK. The current
 * local time is always included (falls back to UTC when the timezone is
 * unknown). Location fields are only listed when known.
 */
function geographyBlock(profile: GeoProfile | null): string {
  const tz = profile?.timezone?.trim() || ''
  const locale = profile?.locale?.trim() || ''
  const place = [profile?.city, profile?.region, profile?.country]
    .map((s) => (s ?? '').trim())
    .filter(Boolean)
    .join(', ')

  const now = new Date()
  let localNow: string
  let tzLabel: string
  if (tz) {
    try {
      localNow = new Intl.DateTimeFormat(locale || 'en-US', {
        dateStyle: 'full',
        timeStyle: 'long',
        timeZone: tz,
      }).format(now)
      tzLabel = tz
    } catch {
      localNow = now.toUTCString()
      tzLabel = 'UTC (user timezone invalid)'
    }
  } else {
    localNow = now.toUTCString()
    tzLabel = 'UTC (user timezone unknown)'
  }

  const out: string[] = ['\nTIME & PLACE:']
  out.push(`Current local time: ${localNow}`)
  out.push(`Timezone: ${tzLabel}`)
  if (locale) out.push(`Locale: ${locale}`)
  out.push(place ? `Approx. location: ${place}` : 'Approx. location: unknown')
  out.push(
    'When a task depends on the user\'s location or timezone — e.g. dates/"today", scheduling, business hours, currency, weather, local laws, or nearby services — use the values above. If a needed detail is missing (shown as "unknown"), ambiguous, or the task clearly hinges on a MORE PRECISE location than shown, ASK the user a brief clarifying question rather than guessing. Never invent a location or timezone.',
  )
  return out.join('\n')
}
