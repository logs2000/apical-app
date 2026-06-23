// POST /api/auth/reset-password/confirm — reset a password using a token.
//
// Body: { token: string, password: string }
//
// Validates the token (exists, not expired), finds the user by the token's
// identifier (their email), hashes the new password with bcrypt (10 rounds),
// updates user.passwordHash, and deletes the token (single-use).
//
// Returns 200 on success. 400 on missing/invalid input. 404 on invalid or
// expired token. 500 on server error.

import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { db } from '@/lib/db'

interface ConfirmBody {
  token?: string
  password?: string
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as ConfirmBody
    const token = typeof body.token === 'string' ? body.token.trim() : ''
    const password = body.password || ''

    if (!token) {
      return NextResponse.json(
        { error: 'A reset token is required.' },
        { status: 400 },
      )
    }
    if (password.length < 8) {
      return NextResponse.json(
        { error: 'Password must be at least 8 characters.' },
        { status: 400 },
      )
    }

    // The caller may not know the email — look the token up by `token` alone.
    // (identifier is part of the @@unique but we don't have it on the request.)
    const row = await db.verificationToken.findFirst({ where: { token } })

    if (!row) {
      return NextResponse.json(
        { error: 'Invalid or expired reset token.' },
        { status: 404 },
      )
    }
    if (row.expires.getTime() < Date.now()) {
      // Clean up the expired token.
      try {
        await db.verificationToken.delete({
          where: {
            identifier_token: {
              identifier: row.identifier,
              token: row.token,
            },
          },
        })
      } catch {
        // ignore — expiry cleanup is best-effort
      }
      return NextResponse.json(
        { error: 'This reset link has expired. Please request a new one.' },
        { status: 404 },
      )
    }

    // row.identifier is the user's email.
    const user = await db.user.findUnique({ where: { email: row.identifier } })
    if (!user) {
      try {
        await db.verificationToken.delete({
          where: {
            identifier_token: {
              identifier: row.identifier,
              token: row.token,
            },
          },
        })
      } catch {
        // ignore
      }
      return NextResponse.json(
        { error: 'No account found for this reset token.' },
        { status: 404 },
      )
    }

    // Hash + update password.
    const passwordHash = await bcrypt.hash(password, 10)
    await db.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        // Mark email as verified — they proved control via the reset email.
        emailVerified: user.emailVerified ?? new Date(),
        // Make sure credentials provider is the active one if it wasn't already.
        provider: user.provider || 'credentials',
      },
    })

    // Single-use: delete the token.
    try {
      await db.verificationToken.delete({
        where: {
          identifier_token: {
            identifier: row.identifier,
            token: row.token,
          },
        },
      })
    } catch {
      // ignore — token is already invalid once used; missing delete isn't fatal
    }

    return NextResponse.json({
      ok: true,
      message: 'Password updated. You can now sign in.',
    })
  } catch (err) {
    console.error('[api/auth/reset-password/confirm] failed:', err)
    return NextResponse.json(
      { error: 'Could not reset password. Please try again.' },
      { status: 500 },
    )
  }
}
