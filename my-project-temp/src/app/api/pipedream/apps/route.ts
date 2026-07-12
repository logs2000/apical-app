import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth-helpers'
import { searchApps } from '@/lib/pipedream/apps'
import { isPipedreamConfigured } from '@/lib/pipedream/config'

// GET /api/pipedream/apps?q=&cursor= — live search of the Pipedream app
// catalog, merged with the caller's local connection state so the UI can show
// Connected badges without a second round trip.
export async function GET(req: Request) {
  try {
    const user = await getCurrentUser(req)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (!isPipedreamConfigured()) {
      return NextResponse.json({ apps: [], nextCursor: null, configured: false })
    }
    const url = new URL(req.url)
    const q = url.searchParams.get('q') ?? ''
    const cursor = url.searchParams.get('cursor') ?? undefined

    const { apps, nextCursor, error } = await searchApps(q, cursor)
    if (error) {
      return NextResponse.json({ error }, { status: 502 })
    }

    // Merge local connection state (active pipedream credentials by app slug).
    const slugs = apps.map((a) => a.slug)
    const credentials = slugs.length
      ? await db.credential.findMany({
          where: {
            userId: user.id,
            kind: 'pipedream',
            status: 'active',
            pipedreamApp: { in: slugs },
          },
          select: { id: true, pipedreamApp: true, pipedreamAccountId: true },
        })
      : []
    const credByApp = new Map(credentials.map((c) => [c.pipedreamApp, c]))

    // Map connected apps to their Integration rows (for tool visibility).
    const accountIds = credentials
      .map((c) => c.pipedreamAccountId)
      .filter((v): v is string => Boolean(v))
    const integrations = accountIds.length
      ? await db.integration.findMany({
          where: {
            kind: 'mcp',
            OR: accountIds.map((id) => ({ config: { contains: `"accountId":"${id}"` } })),
          },
          select: { id: true, config: true },
        })
      : []
    const integrationByAccount = new Map<string, string>()
    for (const row of integrations) {
      try {
        const cfg = JSON.parse(row.config) as { pipedream?: { accountId?: string } }
        if (cfg.pipedream?.accountId) integrationByAccount.set(cfg.pipedream.accountId, row.id)
      } catch {
        // Ignore unparseable configs.
      }
    }

    return NextResponse.json({
      configured: true,
      nextCursor,
      apps: apps.map((a) => {
        const cred = credByApp.get(a.slug)
        return {
          ...a,
          connected: Boolean(cred),
          credentialId: cred?.id ?? null,
          integrationId: cred?.pipedreamAccountId
            ? integrationByAccount.get(cred.pipedreamAccountId) ?? null
            : null,
        }
      }),
    })
  } catch (err) {
    console.error('[api/pipedream/apps] failed:', err)
    return NextResponse.json({ error: 'App search failed' }, { status: 500 })
  }
}
