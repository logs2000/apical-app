// The gate decision: given a graded action, the user's approval tier, whether a
// human is present, and whether this exact action was already approved, decide
// whether to run it, gate it (pause for approval), or deny it outright.
//
// Pure + dependency-free (unit-tested). The enforcement wiring lives in
// executeWorkTool (agent) and the workflow runtime; this is the policy brain.

import type { RiskLevel } from './action-risk'

/** The three user-facing tiers (Protection 1). 'off' means the capability is
 *  disabled entirely (handled upstream); the tiers here govern what happens to
 *  a *destructive* action once the capability is allowed. */
export type ApprovalTier = 'ask' | 'allowlist' | 'always'

export type GateOutcome = 'run' | 'gate' | 'deny'

export interface GateDecision {
  outcome: GateOutcome
  /** Why — for the approval card / audit / observation text. */
  message: string
}

export interface GateContext {
  level: RiskLevel
  tier: ApprovalTier
  /** No human is present to approve (scheduled/cron/background run). */
  headless: boolean
  /** This exact action signature was already approved (one-shot token). */
  approved: boolean
  /** For allowlist tier: the invoked program was on the allowlist. */
  allowlisted?: boolean
}

/**
 * The core rule. Key invariants:
 *  - 'safe' always runs.
 *  - 'critical' is a HARD FLOOR: always gated, even under 'always' — and in a
 *    headless run it is DENIED (no one can approve, and we never auto-run a
 *    catastrophic action).
 *  - 'caution' runs under 'always'/allowlisted; gates under 'ask'; in headless
 *    'ask' it is denied (can't ask no one).
 *  - A prior approval (one-shot token) lets the exact action through once.
 */
export function decideGate(ctx: GateContext): GateDecision {
  if (ctx.level === 'safe') return { outcome: 'run', message: '' }

  if (ctx.approved) {
    return { outcome: 'run', message: 'Previously approved by the user.' }
  }

  if (ctx.level === 'critical') {
    if (ctx.headless) {
      return {
        outcome: 'deny',
        message:
          'This is a critical, hard-to-undo action and no one is present to approve it. Blocked. Run it interactively, or narrow it so it is not critical.',
      }
    }
    return {
      outcome: 'gate',
      message: 'This is a critical action and always needs your explicit approval — even with full authority enabled.',
    }
  }

  // caution
  if (ctx.tier === 'always') return { outcome: 'run', message: '' }
  if (ctx.tier === 'allowlist') {
    return ctx.allowlisted
      ? { outcome: 'run', message: '' }
      : ctx.headless
        ? { outcome: 'deny', message: 'Not on the allowlist and no one is present to approve.' }
        : { outcome: 'gate', message: 'This program is not on your allowlist — approve it to continue.' }
  }
  // tier === 'ask'
  return ctx.headless
    ? { outcome: 'deny', message: 'This action needs approval and no one is present (scheduled run). Blocked.' }
    : { outcome: 'gate', message: 'You asked to approve actions like this before they run.' }
}

/** Stable signature for a one-shot approval token: same action → same key. */
export function actionSignature(tool: string, input: Record<string, unknown>): string {
  const pick = (k: string) => (typeof input[k] === 'string' ? (input[k] as string).trim() : '')
  switch (tool) {
    case 'cli_run':
      return `cli_run:${pick('command')} ${Array.isArray(input.args) ? input.args.join(' ') : ''}`.trim()
    case 'fs_write':
      return `fs_write:${pick('path')}`
    case 'fs_move':
      return `fs_move:${pick('from')}->${pick('to')}`
    case 'script_run':
      return `script_run:${pick('language')}:${(pick('code') || pick('source')).slice(0, 200)}`
    default:
      // Fall back to a hash-ish of the whole input for other gradable tools.
      return `${tool}:${JSON.stringify(input).slice(0, 200)}`
  }
}
