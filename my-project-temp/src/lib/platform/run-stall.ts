// Worker-unavailable signal for durable agent runs. A run that's still queued
// and unclaimed past this grace window means no agent-worker picked it up — the
// worker service is probably down — so the client can say so instead of
// spinning on an indefinite "queued" state.

export const RUN_STALL_MS = 25_000

export function isAgentRunStalled(
  run: { status: string; claimedBy: string | null; createdAt: Date },
  now: number = Date.now(),
): boolean {
  return run.status === 'queued' && !run.claimedBy && now - run.createdAt.getTime() > RUN_STALL_MS
}
