import { NextResponse } from 'next/server'

// Force nodejs runtime — Stripe webhook signature verification needs the
// raw body + Node's crypto module, both of which are unavailable (or behave
// differently) on the edge runtime.
export const runtime = 'nodejs'

import { handleWebhookEvent, isDemoMode, verifyStripeWebhook } from '@/lib/platform/billing'

// POST /api/billing/webhook — Stripe webhook receiver (real mode) OR a
// demo-mode manual trigger.
//
// This route does NOT use `withUser` — it's a public webhook endpoint
// authenticated by the Stripe-Signature header. In demo mode there's no
// signature to verify, so we accept a JSON body `{ event, plan, userId }`
// and apply it directly.
//
// Real mode:
//   1. Read the raw body via `req.text()`.
//   2. Read the `Stripe-Signature` header.
//   3. Verify the signature with STRIPE_WEBHOOK_SECRET.
//   4. Parse the event JSON, hand it to `handleWebhookEvent`.
//
// Demo mode:
//   1. Parse the JSON body.
//   2. Synthesize a Stripe-like event:
//        {
//          type: body.event ?? 'checkout.session.completed',
//          data: { object: { client_reference_id: body.userId, metadata: { plan, userId } } }
//        }
//   3. Hand it to `handleWebhookEvent` (same code path as real mode).
//
// Always returns `{ received: true }` with 200 (so Stripe doesn't retry) —
// unless the signature is invalid, in which case 400.
export async function POST(req: Request) {
  // Always read the raw body first — Stripe needs the exact bytes for
  // signature verification, and Next.js may have already consumed it if we
  // call req.json() first.
  const raw = await req.text()

  // ---- Demo mode: parse JSON, apply a synthetic event. ----
  if (isDemoMode()) {
    let body: { event?: string; plan?: string; userId?: string }
    try {
      body = JSON.parse(raw) as { event?: string; plan?: string; userId?: string }
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON body (demo mode expects { event, plan, userId })' },
        { status: 400 },
      )
    }

    const eventType = body.event ?? 'checkout.session.completed'
    const plan = body.plan ?? 'pro'
    const userId = body.userId

    if (!userId) {
      return NextResponse.json(
        { error: 'userId is required in demo mode' },
        { status: 400 },
      )
    }

    // Synthesize a Stripe-like event so the same handleWebhookEvent code
    // path runs in demo + real mode.
    const synthetic = {
      type: eventType,
      data: {
        object: {
          client_reference_id: userId,
          metadata: { plan, userId },
          // demo_* ids so handleWebhookEvent knows not to fetch the
          // subscription's period end from Stripe.
          subscription: `demo_sub_${userId.slice(0, 8)}`,
          customer: `demo_cus_${userId.slice(0, 8)}`,
        },
      },
    }

    try {
      await handleWebhookEvent(synthetic)
      return NextResponse.json({ received: true, demoMode: true })
    } catch (err) {
      console.error('[api/billing/webhook] demo handler failed:', err)
      const msg = err instanceof Error ? err.message : 'Webhook handler failed'
      return NextResponse.json({ error: msg }, { status: 500 })
    }
  }

  // ---- Real mode: verify signature, parse, apply. ----
  const sig = req.headers.get('stripe-signature') || req.headers.get('Stripe-Signature')
  const secret = process.env.STRIPE_WEBHOOK_SECRET

  if (!sig) {
    return NextResponse.json(
      { error: 'Missing Stripe-Signature header' },
      { status: 400 },
    )
  }
  if (!secret) {
    return NextResponse.json(
      { error: 'STRIPE_WEBHOOK_SECRET is not configured' },
      { status: 500 },
    )
  }

  let event: unknown
  try {
    event = verifyStripeWebhook(raw, sig, secret)
  } catch (err) {
    console.error('[api/billing/webhook] signature verification failed:', err)
    const msg = err instanceof Error ? err.message : 'Invalid signature'
    return NextResponse.json({ error: msg }, { status: 400 })
  }

  try {
    await handleWebhookEvent(event)
    return NextResponse.json({ received: true })
  } catch (err) {
    console.error('[api/billing/webhook] handler failed:', err)
    const msg = err instanceof Error ? err.message : 'Webhook handler failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
