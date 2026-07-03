import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { db } from '@/lib/db'
import { generateApiKey, DEV_KEY_COOKIE } from '@/lib/dev-auth'

// POST /api/dev/auth/register — create a developer workspace + an initial API key.
//
// Solves the chicken/egg: the dashboard's "log in with API key" flow needs a
// key, but creating a key needs to be logged in. This endpoint creates both
// at once, returns the raw key (shown ONCE), and sets the console cookie.
//
// A "developer account" is now simply a Workspace (plan/balance/billing live
// on the workspace).
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
    const existing = await db.workspace.findFirst({ where: { billingEmail: email } })
    if (existing) {
      return NextResponse.json(
        {
          error:
            'A workspace with that billing email already exists. Log in with your API key instead.',
        },
        { status: 409 },
      )
    }

    const workspace = await db.workspace.create({
      data: {
        name: name || email.split('@')[0],
        description: 'Developer workspace',
        plan: 'free',
        balanceCents: 500, // $5.00 starting credit for new developers.
        billingEmail: email,
        status: 'active',
      },
    })

    const { raw, hash, prefix } = generateApiKey()
    const apiKey = await db.apiKey.create({
      data: {
        workspaceId: workspace.id,
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
        workspaceId: workspace.id,
        apiKeyId: apiKey.id,
        action: 'account:register',
        target: workspace.id,
        success: true,
        costCents: 0,
        detail: `Workspace created (${email}). Initial plan: free, $5.00 starting credit.`,
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
        id: workspace.id,
        email: workspace.billingEmail,
        name: workspace.name,
        plan: workspace.plan,
        balanceCents: workspace.balanceCents,
        workspaceId: workspace.id,
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
      { error: 'Failed to create developer workspace.' },
      { status: 500 },
    )
  }
}
