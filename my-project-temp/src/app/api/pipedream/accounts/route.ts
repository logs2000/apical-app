import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth-helpers'
import { workspaceIdForUser } from '@/lib/integration-scope'
import { listAccounts } from '@/lib/pipedream/connect'
import { materializePipedreamConnection } from '@/lib/pipedream/sync'
import { isPipedreamConfigured } from '@/lib/pipedream/config'

// GET /api/pipedream/accounts?app=&sync=1 — the caller's managed connections.
// This is the polling target for the in-chat connect card: with `sync=1` we
// also check Pipedream for accounts that finished auth out-of-band (e.g. the
// Connect Link popup couldn't message us back) and materialize them.
export async function GET(req: Request) {
  try {
    const user = await getCurrentUser(req)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (!isPipedreamConfigured()) {
      return NextResponse.json({ accounts: [], configured: false })
    }
    const url = new URL(req.url)
    const app = (url.searchParams.get('app') || '').trim().toLowerCase() || undefined
    const sync = url.searchParams.get('sync') === '1'

    if (sync) {
      // Reconcile with Pipedream: materialize any account we don't know yet.
      const upstream = await listAccounts(user.id, app)
      if (upstream.length > 0) {
        const known = await db.credential.findMany({
          where: {
            userId: user.id,
            kind: 'pipedream',
            pipedreamAccountId: { in: upstream.map((a) => a.id) },
            status: 'active',
          },
          select: { pipedreamAccountId: true },
        })
        const knownIds = new Set(known.map((c) => c.pipedreamAccountId))
        const wsId = await workspaceIdForUser(user)
        for (const account of upstream) {
          if (knownIds.has(account.id) || !account.app) continue
          await materializePipedreamConnection(user.id, wsId, account.id, account.app)
        }
      }
    }

    const rows = await db.credential.findMany({
      where: {
        userId: user.id,
        kind: 'pipedream',
        status: 'active',
        ...(app ? { pipedreamApp: app } : {}),
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        label: true,
        status: true,
        pipedreamApp: true,
        pipedreamAccountId: true,
        createdAt: true,
      },
    })
    return NextResponse.json({
      configured: true,
      accounts: rows.map((r) => ({
        credentialId: r.id,
        app: r.pipedreamApp,
        label: r.label,
        status: r.status,
        createdAt: r.createdAt,
      })),
    })
  } catch (err) {
    console.error('[api/pipedream/accounts] failed:', err)
    return NextResponse.json({ error: 'Failed to list connections' }, { status: 500 })
  }
}
