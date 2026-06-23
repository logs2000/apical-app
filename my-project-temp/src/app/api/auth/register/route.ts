// POST /api/auth/register — create a new user account (email + password).
//
// Used by the /signup page. Hashes the password with bcrypt (10 rounds) and
// creates a User row with provider='credentials'. Returns a safe user shape
// (never the passwordHash). The frontend then calls signIn('credentials', ...)
// to log in via NextAuth.

import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { db } from '@/lib/db'

interface RegisterBody {
  name?: string
  email?: string
  password?: string
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as RegisterBody
    const name = (body.name || '').trim()
    const email = (body.email || '').trim().toLowerCase()
    const password = body.password || ''

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json(
        { error: 'A valid email is required.' },
        { status: 400 },
      )
    }
    if (password.length < 8) {
      return NextResponse.json(
        { error: 'Password must be at least 8 characters.' },
        { status: 400 },
      )
    }
    if (!name) {
      return NextResponse.json(
        { error: 'Name is required.' },
        { status: 400 },
      )
    }

    const existing = await db.user.findUnique({ where: { email } })
    if (existing) {
      return NextResponse.json(
        { error: 'An account with that email already exists.' },
        { status: 409 },
      )
    }

    const passwordHash = await bcrypt.hash(password, 10)
    const user = await db.user.create({
      data: {
        email,
        name,
        passwordHash,
        provider: 'credentials',
      },
    })

    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        provider: user.provider,
        createdAt: user.createdAt.toISOString(),
      },
    })
  } catch (err) {
    console.error('[api/auth/register] failed:', err)
    return NextResponse.json(
      { error: 'Could not create account. Please try again.' },
      { status: 500 },
    )
  }
}
