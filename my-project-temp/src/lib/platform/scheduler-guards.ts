/**
 * Shared scheduler guards — used by the scheduler mini-service and API routes
 * when deciding whether a local-runtime workflow can fire.
 */

import type { PrismaClient } from '@prisma/client'
import type { WorkflowStep } from '@/lib/types'
import {
  firstBlockedCapability,
  type DesktopCapability,
} from '@/lib/desktop/desktop-settings'
import { requiredDesktopCapabilitiesFromSteps } from '@/lib/workflow-schema'
import { parseSteps } from '@/lib/runtime'

const ONLINE_FRESHNESS_MS = 3 * 60 * 1000

export interface DesktopReadiness {
  online: boolean
  sessionId?: string
  capabilities: string[]
  blockedCapability: DesktopCapability | null
}

/** Parse workflow stepsJson into required desktop capabilities. */
export function capabilitiesRequiredByWorkflow(stepsJson: string): DesktopCapability[] {
  try {
    const steps = parseSteps(stepsJson) as WorkflowStep[]
    return requiredDesktopCapabilitiesFromSteps(steps)
  } catch {
    return []
  }
}

/** Check whether the user has an online desktop with sufficient remote capabilities. */
export async function checkDesktopReadiness(
  db: PrismaClient,
  userId: string,
  stepsJson: string,
): Promise<DesktopReadiness> {
  const required = capabilitiesRequiredByWorkflow(stepsJson)
  const freshSince = new Date(Date.now() - ONLINE_FRESHNESS_MS)

  const session = await db.desktopSession.findFirst({
    where: {
      userId,
      status: 'online',
      OR: [{ lastSeenAt: { gte: freshSince } }, { lastSeenAt: null }],
    },
    orderBy: { lastSeenAt: 'desc' },
    select: { id: true, capabilitiesJson: true },
  })

  if (!session) {
    return { online: false, capabilities: [], blockedCapability: required[0] ?? null }
  }

  let capabilities: string[] = []
  try {
    const parsed = JSON.parse(session.capabilitiesJson || '[]')
    if (Array.isArray(parsed)) capabilities = parsed.filter((v) => typeof v === 'string')
  } catch {
    capabilities = []
  }

  const blockedCapability = firstBlockedCapability(required, capabilities)

  return {
    online: true,
    sessionId: session.id,
    capabilities,
    blockedCapability,
  }
}

/** True when the user has at least one desktop session (linked), any status. */
export async function userHasDesktopSession(
  db: PrismaClient,
  userId: string,
): Promise<boolean> {
  const n = await db.desktopSession.count({ where: { userId } })
  return n > 0
}
