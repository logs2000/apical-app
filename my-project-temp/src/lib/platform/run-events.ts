// Run event broadcast seam. In the cloud, run events fan out to connected
// browsers through the run-relay mini-service; the open core has no relay, so
// broadcasts are a no-op until a publisher is registered at boot
// (cloud-registration.ts). The desktop UI observes runs in-process instead.

export type RunEventPublisher = (
  runId: string,
  event: string,
  data: unknown,
) => void

let publisher: RunEventPublisher | null = null

export function setRunEventPublisher(p: RunEventPublisher): void {
  publisher = p
}

export function broadcastRun(runId: string, event: string, data: unknown): void {
  publisher?.(runId, event, data)
}
