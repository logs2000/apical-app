// Apical — outbound webhooks. Workspaces register endpoints; the runtime
// emits run lifecycle events (run.completed, run.failed, step.failed) which
// are POSTed to each subscribed endpoint with an HMAC-SHA256 signature.
//
// Signature header (Stripe-style):
//   X-Apical-Signature: t=<unix-seconds>,v1=<hex hmac of `${t}.${body}`>
//
// Delivery is best-effort with in-process retries (3 attempts, exponential
// backoff) and a persistent WebhookDelivery log. Exhausted deliveries stay
// as status "failed" (the dead-letter record) and can be inspected via
// GET /v1/webhooks/{id}/deliveries.

import { createHmac, randomBytes } from 'crypto'
import { db } from '@/lib/db'

export type WebhookEvent = 'run.completed' | 'run.failed' | 'step.failed'

const MAX_ATTEMPTS = 3
const BACKOFF_MS = [0, 5_000, 30_000]
const DELIVERY_TIMEOUT_MS = 10_000

export function generateWebhookSecret(): string {
  return `whsec_${randomBytes(24).toString('hex')}`
}

export function signWebhookPayload(
  secret: string,
  body: string,
  timestampSeconds: number,
): string {
  const mac = createHmac('sha256', secret)
    .update(`${timestampSeconds}.${body}`)
    .digest('hex')
  return `t=${timestampSeconds},v1=${mac}`
}

/**
 * Emit an event to every active endpoint in the workspace subscribed to it.
 * Fire-and-forget: never throws, never blocks the runtime.
 */
export function emitWebhookEvent(
  workspaceId: string | null | undefined,
  event: WebhookEvent,
  payload: Record<string, unknown>,
): void {
  if (!workspaceId) return
  void dispatchEvent(workspaceId, event, payload).catch((err) => {
    console.error('[webhooks] dispatch failed:', err)
  })
}

async function dispatchEvent(
  workspaceId: string,
  event: WebhookEvent,
  payload: Record<string, unknown>,
): Promise<void> {
  const endpoints = await db.webhookEndpoint.findMany({
    where: { workspaceId, active: true },
  })
  const subscribed = endpoints.filter((e) => {
    try {
      const events = JSON.parse(e.eventsJson) as string[]
      return events.length === 0 || events.includes(event)
    } catch {
      return true
    }
  })
  if (subscribed.length === 0) return

  const body = JSON.stringify({
    id: `evt_${randomBytes(12).toString('hex')}`,
    event,
    createdAt: new Date().toISOString(),
    data: payload,
  })

  await Promise.all(
    subscribed.map(async (endpoint) => {
      const delivery = await db.webhookDelivery.create({
        data: {
          endpointId: endpoint.id,
          event,
          payloadJson: body,
          status: 'pending',
        },
      })
      void attemptDelivery(endpoint.id, endpoint.url, endpoint.secret, delivery.id, body)
    }),
  )
}

async function attemptDelivery(
  endpointId: string,
  url: string,
  secret: string,
  deliveryId: string,
  body: string,
): Promise<void> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (attempt > 1) {
      await new Promise((r) => setTimeout(r, BACKOFF_MS[attempt - 1]))
    }
    const timestamp = Math.floor(Date.now() / 1000)
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Apical-Signature': signWebhookPayload(secret, body, timestamp),
          'X-Apical-Delivery': deliveryId,
        },
        body,
        signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
      })
      if (res.ok) {
        await db.webhookDelivery.update({
          where: { id: deliveryId },
          data: {
            status: 'delivered',
            attempts: attempt,
            responseStatus: res.status,
            deliveredAt: new Date(),
          },
        })
        return
      }
      await db.webhookDelivery.update({
        where: { id: deliveryId },
        data: {
          attempts: attempt,
          responseStatus: res.status,
          lastError: `HTTP ${res.status}`,
          ...(attempt === MAX_ATTEMPTS ? { status: 'failed' } : {}),
        },
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await db.webhookDelivery
        .update({
          where: { id: deliveryId },
          data: {
            attempts: attempt,
            lastError: message.slice(0, 500),
            ...(attempt === MAX_ATTEMPTS ? { status: 'failed' } : {}),
          },
        })
        .catch(() => {})
    }
  }
}
