// POST /api/auth/reset-password/request — request a password reset link.
//
// Body: { email: string }
//
// Looks up the user by email. If found, creates a VerificationToken row with
// identifier=email, token=<random 32 hex>, expires=1hr from now. In dev the
// token is returned in the response (so the dev can paste it into /reset-password
// without email); in prod the token would be emailed (SMTP wiring is a TODO —
// for now we just log it).
//
// Security: ALWAYS returns 200 with the same shape, even when the email doesn't
// exist — never reveal whether an email is registered.

import { NextResponse } from 'next/server'
import { randomBytes } from 'node:crypto'
import { db } from '@/lib/db'

interface RequestBody {
  email?: string
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as RequestBody
    const email = (body.email || '').trim().toLowerCase()
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json(
        { error: 'A valid email is required.' },
        { status: 400 },
      )
    }

    const user = await db.user.findUnique({ where: { email } })
    if (!user) {
      // Don't reveal whether the email exists. Return a generic success.
      // (We still 200 so the UI shows the "check your email" state.)
      return NextResponse.json({
        ok: true,
        message: 'If an account exists for that email, a reset link has been sent.',
      })
    }

    // Generate a 32-byte hex token. VerificationToken is keyed by
    // (identifier, token) so multiple pending resets per email are allowed.
    const token = randomBytes(32).toString('hex')
    const expires = new Date(Date.now() + 60 * 60 * 1000) // 1 hour

    // Clean up any old tokens for this email first (best-effort).
    try {
      await db.verificationToken.deleteMany({ where: { identifier: email } })
    } catch {
      // ignore — old tokens just expire naturally if delete fails
    }

    await db.verificationToken.create({
      data: {
        identifier: email,
        token,
        expires,
      },
    })

    // In production this would send an email. For now we log it so the
    // operator can fish it out of the logs (and dev mode returns it inline).
    const resetUrl = `${process.env.NEXTAUTH_URL || ''}/reset-password?token=${token}`
    console.log(
      `[api/auth/reset-password/request] reset link for ${email}: ${resetUrl}`,
    )

    const isDev = process.env.NODE_ENV === 'development'
    return NextResponse.json({
      ok: true,
      message: 'If an account exists for that email, a reset link has been sent.',
      // Dev-only convenience: surface the token so you can test the flow
      // without an SMTP server wired up.
      ...(isDev ? { devToken: token, devResetUrl: resetUrl } : {}),
    })
  } catch (err) {
    console.error('[api/auth/reset-password/request] failed:', err)
    return NextResponse.json(
      { error: 'Could not process request. Please try again.' },
      { status: 500 },
    )
  }
}
