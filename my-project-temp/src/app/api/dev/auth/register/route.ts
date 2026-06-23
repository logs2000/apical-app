import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { db } from '@/lib/db'
import { generateApiKey, hashApiKey, DEV_KEY_COOKIE } from '@/lib/dev-auth'

// POST /api/dev/auth/register — create a developer account + an initial API key.
//
// Solves the chicken/egg: the dashboard's "log in with API key" flow needs a
// key, but creating a key needs to be logged in. This endpoint creates both
// at once, returns the raw key (shown ONCE), and sets the console cookie.
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      email?: string
      name?: string
    }
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return NextResponse.json(
        { error: 'A valid email is required.' },
        { status: 400 },
      )
    }

    // Refuse duplicate emails — they should log in instead.
    const existing = await db.developerAccount.findUnique({ where: { email } })
    if (existing) {
      return NextResponse.json(
        {
          error:
            'An account with that email already exists. Log in with your API key instead.',
        },
        { status: 409 },
      )
    }

    // Default new developers to the main workspace so their deployed agents
    // show up alongside the seeded ones in the demo.
    let workspaceId: string | null = 'ws_main'
    const main = await db.workspace.findUnique({ where: { id: 'ws_main' } })
    if (!main) {
      // Fall back to the first workspace, or null.
      const first = await db.workspace.findFirst()
      workspaceId = first?.id ?? null
    }

    const dev = await db.developerAccount.create({
      data: {
        email,
        name: name || email.split('@')[0],
        plan: 'free',
        balanceCents: 500, // $5.00 starting credit for new developers.
        billingEmail: email,
        workspaceId,
        status: 'active',
      },
    })

    const { raw, hash, prefix } = generateApiKey()
    const apiKey = await db.apiKey.create({
      data: {
        developerId: dev.id,
        label: 'Default',
        keyHash: hash,
        keyPrefix: prefix,
        status: 'active',
        lastUsedAt: new Date(),
        lastUsedFrom: 'web',
      },
    })

    // Welcome log.
    await db.mcpAuditLog.create({
      data: {
        developerId: dev.id,
        apiKeyId: apiKey.id,
        action: 'account:register',
        target: dev.id,
        success: true,
        costCents: 0,
        detail: `Account created (${email}). Initial plan: free, $5.00 starting credit.`,
        source: 'web',
      },
    })

    // Set the cookie so the console is immediately authenticated.
    const c = await cookies()
    c.set(DEV_KEY_COOKIE, raw, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 30, // 30 days
    })

    return NextResponse.json({
      developer: {
        id: dev.id,
        email: dev.email,
        name: dev.name,
        plan: dev.plan,
        balanceCents: dev.balanceCents,
        workspaceId: dev.workspaceId,
      },
      apiKey: {
        id: apiKey.id,
        label: apiKey.label,
        prefix: apiKey.keyPrefix,
        raw, // shown ONCE
        createdAt: apiKey.createdAt.toISOString(),
      },
    })
  } catch (err) {
    console.error('[api/dev/auth/register] failed:', err)
    return NextResponse.json(
      { error: 'Failed to create developer account.' },
      { status: 500 },
    )
  }
}
