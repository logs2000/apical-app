// CLOUD PLANE (proprietary — not part of the ELv2 open core; see LICENSING.md).
//
// Registers the cloud implementations of the core's seams at server boot
// (instrumentation.ts). Skipped when APICAL_EDITION=core — that is how the
// open-core build runs with the default unlimited-local entitlements and no
// hosted relay. In the public open-core repo this file simply doesn't exist.

import { setEntitlements } from '@/lib/platform/entitlements'
import { setCloudAdapter } from '@/lib/platform/cloud-adapter'
import { setRunEventPublisher } from '@/lib/platform/run-events'
import { getPlan, isOverAllowance } from '@/lib/platform/pricing'
import { resolveEffectiveAllowance } from '@/lib/platform/token-allowance-config'
import { cloudChat, cloudChatStream, cloudListModels } from '@/lib/platform/cloud-llm'
import { isCloudRelayAvailable } from '@/lib/platform/cloud-pat'
import { broadcastRun as relayBroadcastRun } from '@/lib/relay-client'

export function registerCloudServices(): void {
  setEntitlements({
    defaultTokenAllowance: getPlan('free').tokenAllowanceMonthly,
    planFeatures: (planId) => {
      const plan = getPlan(planId)
      return {
        localModelsAllowed: plan.localModelsAllowed,
        overrunAvailable: plan.overrunAvailable,
      }
    },
    effectiveAllowance: (sub) => resolveEffectiveAllowance(sub),
    isOverAllowance,
  })

  setCloudAdapter({
    isAvailable: isCloudRelayAvailable,
    chat: cloudChat,
    chatStream: cloudChatStream,
    listModels: cloudListModels,
  })

  setRunEventPublisher(relayBroadcastRun)
}
