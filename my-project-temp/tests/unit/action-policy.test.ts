/// <reference types="bun-types" />
// Unit: the gate decision brain. The safety-critical invariants are the table.
import { test, expect, describe } from 'bun:test'
import { decideGate, actionSignature, evaluateActionGate } from '../../src/lib/platform/action-policy'
import type { GateContext } from '../../src/lib/platform/action-policy'

const d = (o: Partial<GateContext>) =>
  decideGate({ level: 'caution', tier: 'ask', headless: false, approved: false, ...o }).outcome

describe('safe always runs', () => {
  for (const tier of ['ask', 'allowlist', 'always'] as const) {
    test(`safe/${tier}`, () => expect(d({ level: 'safe', tier })).toBe('run'))
  }
})

describe('critical is a hard floor', () => {
  test('critical gates even under full authority', () => expect(d({ level: 'critical', tier: 'always' })).toBe('gate'))
  test('critical gates under ask', () => expect(d({ level: 'critical', tier: 'ask' })).toBe('gate'))
  test('critical is DENIED when headless (no one to approve)', () =>
    expect(d({ level: 'critical', tier: 'always', headless: true })).toBe('deny'))
  test('a prior approval lets even critical through once', () =>
    expect(d({ level: 'critical', tier: 'ask', approved: true })).toBe('run'))
})

describe('caution follows the tier', () => {
  test('always → run', () => expect(d({ level: 'caution', tier: 'always' })).toBe('run'))
  test('ask → gate (human present)', () => expect(d({ level: 'caution', tier: 'ask' })).toBe('gate'))
  test('ask + headless → deny', () => expect(d({ level: 'caution', tier: 'ask', headless: true })).toBe('deny'))
  test('allowlist + on list → run', () => expect(d({ level: 'caution', tier: 'allowlist', allowlisted: true })).toBe('run'))
  test('allowlist + not on list → gate', () =>
    expect(d({ level: 'caution', tier: 'allowlist', allowlisted: false })).toBe('gate'))
  test('allowlist + not on list + headless → deny', () =>
    expect(d({ level: 'caution', tier: 'allowlist', allowlisted: false, headless: true })).toBe('deny'))
  test('approved caution runs regardless of tier', () =>
    expect(d({ level: 'caution', tier: 'ask', approved: true })).toBe('run'))
})

describe('evaluateActionGate (classify + allowlist + decide, end to end)', () => {
  test('safe tool runs (non-gradable)', () =>
    expect(evaluateActionGate('web_read', { url: 'x' }, { tier: 'ask', headless: false }).outcome).toBe('run'))
  test('rm -rf / is gated even under always (critical floor)', () =>
    expect(evaluateActionGate('cli_run', { command: 'rm -rf /' }, { tier: 'always', headless: false }).outcome).toBe('gate'))
  test('rm -rf / is DENIED when headless', () =>
    expect(evaluateActionGate('cli_run', { command: 'rm -rf /' }, { tier: 'always', headless: true }).outcome).toBe('deny'))
  test('routine ls runs under always (default), gates under ask', () => {
    expect(evaluateActionGate('cli_run', { command: 'ls' }, { tier: 'always', headless: false }).outcome).toBe('run')
    expect(evaluateActionGate('cli_run', { command: 'ls' }, { tier: 'ask', headless: false }).outcome).toBe('gate')
  })
  test('allowlist tier: git allowed, curl gated', () => {
    const pol = { tier: 'allowlist' as const, headless: false, cliAllowlist: ['git', 'npm'] }
    expect(evaluateActionGate('cli_run', { command: 'git status' }, pol).outcome).toBe('run')
    expect(evaluateActionGate('cli_run', { command: 'curl http://x' }, pol).outcome).toBe('gate')
  })
  test('a matching approval token lets a critical action run once', () => {
    const sig = actionSignature('cli_run', { command: 'rm -rf /' })
    const r = evaluateActionGate('cli_run', { command: 'rm -rf /' }, { tier: 'ask', headless: false, approvedSignatures: new Set([sig]) })
    expect(r.outcome).toBe('run')
    expect(r.consumedApproval).toBe(true)
  })
})

describe('actionSignature is stable + specific', () => {
  test('same cli command → same signature', () =>
    expect(actionSignature('cli_run', { command: 'rm x' })).toBe(actionSignature('cli_run', { command: 'rm x' })))
  test('different path → different signature', () =>
    expect(actionSignature('fs_write', { path: '/a' })).not.toBe(actionSignature('fs_write', { path: '/b' })))
  test('fs_move encodes both ends', () =>
    expect(actionSignature('fs_move', { from: '/a', to: '/b' })).toBe('fs_move:/a->/b'))
})
