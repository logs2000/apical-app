import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withDevAuth } from '@/lib/dev-auth'

// POST /api/dev/billing/topup — simulate a Stripe checkout session.
//
// Body: { amountCents: number }.
// For the demo: just adds to balanceCents, creates an audit log
// { action: 'billing:topup', success: true, costCents: -amountCents,
//   detail: 'Topped up $X.XX', source: 'web' }, returns { balanceCents, checkoutUrl: null }.
//
// ── To wire this to real Stripe later ─────────────────────────────────────────
// Replace the inline `balanceCents += amountCents` block with:
//   const session = await stripe.checkout.sessions.create({
//     mode: 'payment',
//     customer: developer.stripeCustomerId ?? undefined,
//     line_items: [{ price_data: { currency: 'usd', product_data: { name: 'Apical credits' }, unit_amount: amountCents }, quantity: 1 }],
//     success_url: `${origin}/developer?topup=ok&session_id={CHECKOUT_SESSION_ID}`,
//     cancel_url: `${origin}/developer?topup=cancel`,
//     metadata: { developerId: developer.id, amountCents: String(amountCents) },
//   })
//   return { balanceCents: developer.balanceCents, checkoutUrl: session.url }
// Then add a Stripe webhook handler (`/api/webhooks/stripe`) that listens for
// `checkout.session.completed`, verifies the signature, reads the metadata,
// and finally credits balanceCents + writes the audit log. The audit log should
// only be written ONCE (idempotent — key on the Stripe session id).
export const POST = withDevAuth(async (req, { developer }) => {
  try {
    const body = (await req.json().catch(() => ({}))) as { amountCents?: number }
    const amount = Number(body.amountCents)
    if (!Number.isFinite(amount) || amount < 100) {
      return NextResponse.json(
        { error: 'amountCents must be a number >= 100 (i.e. $1.00 minimum).' },
        { status: 400 },
      )
    }
    const amountCents = Math.round(amount)

    // Credit the balance.
    const updated = await db.developerAccount.update({
      where: { id: developer.id },
      data: { balanceCents: { increment: amountCents } },
    })

    // Audit log (negative costCents = credit; positive = charge).
    const dollars = (amountCents / 100).toLocaleString(undefined, {
      style: 'currency',
      currency: 'USD',
    })
    await db.mcpAuditLog.create({
      data: {
        developerId: developer.id,
        apiKeyId: null,
        action: 'billing:topup',
        target: developer.id,
        success: true,
        costCents: -amountCents,
        detail: `Topped up ${dollars}.`,
        source: 'web',
      },
    })

    return NextResponse.json({
      balanceCents: updated.balanceCents,
      checkoutUrl: null,
    })
  } catch (err) {
    console.error('[api/dev/billing/topup] POST failed:', err)
    return NextResponse.json(
      { error: 'Failed to process top-up.' },
      { status: 500 },
    )
  }
})
