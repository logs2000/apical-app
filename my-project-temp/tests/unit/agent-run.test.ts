/// <reference types="bun-types" />
// Unit: the worker-unavailable ("stalled") signal for durable runs.
import { test, expect, describe } from 'bun:test'
import { isAgentRunStalled, RUN_STALL_MS } from '../../src/lib/platform/run-stall'

const now = 1_000_000_000_000
const ago = (ms: number) => new Date(now - ms)

describe('isAgentRunStalled', () => {
  test('queued + unclaimed past the grace window → stalled (no worker)', () => {
    expect(isAgentRunStalled({ status: 'queued', claimedBy: null, createdAt: ago(RUN_STALL_MS + 1000) }, now)).toBe(true)
  })
  test('queued but still within the grace window → not yet stalled', () => {
    expect(isAgentRunStalled({ status: 'queued', claimedBy: null, createdAt: ago(1000) }, now)).toBe(false)
  })
  test('claimed by a worker → not stalled even if old', () => {
    expect(isAgentRunStalled({ status: 'queued', claimedBy: 'worker-1', createdAt: ago(60_000) }, now)).toBe(false)
  })
  test('running / finished runs are never stalled', () => {
    for (const status of ['running', 'succeeded', 'failed', 'cancelled']) {
      expect(isAgentRunStalled({ status, claimedBy: null, createdAt: ago(60_000) }, now)).toBe(false)
    }
  })
})
