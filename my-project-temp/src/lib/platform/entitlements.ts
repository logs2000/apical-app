// Entitlements seam — how the gateway asks "what is this user allowed to do?"
//
// The open core ships `coreEntitlements`: everything unlimited, no billing.
// The cloud build swaps in its own implementation at server boot (see
// cloud-registration.ts) that wraps plans, allowance overrides, and overrun
// billing. Core code must never import pricing/billing modules directly —
// that is what keeps the open-core build free of the cloud plane
// (see OPEN-CORE-SPLIT.md).

export interface PlanFeatures {
  localModelsAllowed: boolean
  overrunAvailable: boolean
}

export interface Entitlements {
  /** Monthly token allowance written to a brand-new subscription. 0 = unlimited. */
  defaultTokenAllowance: number
  planFeatures(planId: string): PlanFeatures
  /** Effective monthly allowance for a subscription. 0 = unlimited. */
  effectiveAllowance(sub: {
    plan: string
    tokenAllowanceMonthly: number
  }): Promise<number>
  isOverAllowance(used: number, allowance: number): boolean
}

export const coreEntitlements: Entitlements = {
  defaultTokenAllowance: 0,
  planFeatures: () => ({ localModelsAllowed: true, overrunAvailable: false }),
  effectiveAllowance: async () => 0,
  isOverAllowance: () => false,
}

let current: Entitlements = coreEntitlements

export function setEntitlements(e: Entitlements): void {
  current = e
}

export function entitlements(): Entitlements {
  return current
}
