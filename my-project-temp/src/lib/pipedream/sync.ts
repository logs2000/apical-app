// Apical — materialize a Pipedream Connect account into first-class Apical
// records: a ConnectorCatalogEntry (lazy catalog row), a Credential
// (kind="pipedream", secretless reference), and an Integration (kind="mcp"
// with the pipedream marker) whose tools come from the app's Pipedream MCP
// server. After this runs, the entire existing runtime — mcp_list_servers,
// mcp_call_tool, workflow freeze, production execution — sees the connection
// like any other MCP integration.

import { db } from '../db'
import { connectMcpServer } from '../mcp-client'
import type { IntegrationConfig, ToolDef } from '../types'
import { getAccount } from './connect'
import { getApp } from './apps'
import { buildPipedreamMcpConfig, pipedreamMcpUrl } from './mcp'

export interface MaterializedConnection {
  credentialId: string
  integrationId: string
  tools: ToolDef[]
  accountLabel: string | null
}

/** Category mapping from Pipedream's categories to Apical's catalog buckets. */
function mapCategory(categories: string[]): string {
  const joined = categories.join(' ').toLowerCase()
  if (/email|mail/.test(joined)) return 'email'
  if (/chat|communication|messaging/.test(joined)) return 'messaging'
  if (/file|storage|document/.test(joined)) return 'files'
  if (/account|payment|finance|invoic/.test(joined)) return 'finance'
  if (/crm|sales/.test(joined)) return 'crm'
  if (/developer|devops|code/.test(joined)) return 'dev'
  if (/project|task|productivity/.test(joined)) return 'project-mgmt'
  if (/commerce|shop/.test(joined)) return 'e-commerce'
  if (/marketing|social/.test(joined)) return 'marketing'
  if (/database|data/.test(joined)) return 'database'
  return 'general'
}

/**
 * Verify + persist a freshly connected Pipedream account. Idempotent: safe to
 * call from the connect/complete route, the webhook, and account polling.
 *
 * SECURITY: `accountId` arrives from the client — we always re-fetch the
 * account from Pipedream and require that its external_user_id matches the
 * session user before persisting anything.
 */
export async function materializePipedreamConnection(
  userId: string,
  workspaceId: string | null,
  accountId: string,
  appSlug: string,
): Promise<{ result: MaterializedConnection | null; error: string | null }> {
  const slug = appSlug.trim().toLowerCase()
  if (!userId || !accountId || !slug) {
    return { result: null, error: 'Missing user, account, or app' }
  }

  // 1. Verify ownership upstream — never trust a client-supplied apn_ id.
  const account = await getAccount(accountId)
  if (!account) {
    return { result: null, error: 'Account not found in Pipedream' }
  }
  if (account.externalUserId !== userId) {
    return { result: null, error: 'Account does not belong to this user' }
  }
  if (account.app && account.app !== slug) {
    return { result: null, error: `Account is for app "${account.app}", not "${slug}"` }
  }

  // 2. Lazy catalog upsert (only connected apps get catalog rows).
  const app = await getApp(slug)
  const displayName = app?.name || account.appName || slug
  await db.connectorCatalogEntry.upsert({
    where: { pipedreamAppSlug: slug },
    update: {
      name: displayName,
      authType: app?.authType ?? undefined,
      imgSrc: app?.imgSrc ?? undefined,
      description: app?.description || `${displayName} via Pipedream Connect.`,
    },
    create: {
      slug: `pd-${slug}`,
      name: displayName,
      kind: 'pipedream',
      source: 'pipedream',
      category: mapCategory(app?.categories ?? []),
      description: app?.description || `${displayName} via Pipedream Connect.`,
      shortDesc: `${displayName} (managed connection)`,
      pipedreamAppSlug: slug,
      authType: app?.authType ?? null,
      imgSrc: app?.imgSrc ?? null,
      status: 'live',
      supportsByoc: false,
      hasDemoMode: false,
    },
  }).catch((err) => {
    // A slug collision with a direct entry is non-fatal — the catalog row is
    // cosmetic; the Credential + Integration below are what the runtime uses.
    console.warn('[pipedream] catalog upsert failed:', err)
  })

  // 3. Upsert the Credential (secretless reference to the Pipedream account).
  const label = `${displayName} (Pipedream)`
  const existingCred = await db.credential.findFirst({
    where: { userId, pipedreamAccountId: accountId },
  })
  const credential = existingCred
    ? await db.credential.update({
        where: { id: existingCred.id },
        data: { status: 'active', label, workspaceId: workspaceId ?? undefined },
      })
    : await db.credential.create({
        data: {
          userId,
          workspaceId,
          service: slug,
          label,
          kind: 'pipedream',
          status: 'active',
          oauthProvider: null,
          pipedreamAccountId: accountId,
          pipedreamApp: slug,
          metaJson: JSON.stringify({
            provider: 'pipedream',
            accountName: account.name ?? null,
          }),
        },
      })

  // 4. Discover the app's MCP tools once (best-effort — the integration is
  //    still created on timeout; tools refresh lazily on the next call).
  let tools: ToolDef[] = []
  const mcpCfg = await buildPipedreamMcpConfig(userId, slug)
  if (mcpCfg) {
    const discovery = await connectMcpServer(mcpCfg)
    if (!discovery.error && Array.isArray(discovery.tools)) {
      tools = discovery.tools
    } else if (discovery.error) {
      console.warn(`[pipedream] tool discovery for ${slug} failed: ${discovery.error}`)
    }
  }

  // 5. Upsert the Integration. The config carries the mcp URL WITHOUT auth
  //    headers plus the pipedream marker; mcp_call_tool rebuilds headers per
  //    call.
  const config: IntegrationConfig = {
    mcp: { transport: 'http', url: pipedreamMcpUrl(userId, slug) },
    pipedream: { appSlug: slug, accountId, credentialId: credential.id },
  }
  const existingIntegration = await db.integration.findFirst({
    where: {
      workspaceId,
      kind: 'mcp',
      config: { contains: `"accountId":"${accountId}"` },
    },
  })
  const toolsJson = JSON.stringify(tools)
  const integration = existingIntegration
    ? await db.integration.update({
        where: { id: existingIntegration.id },
        data: {
          status: 'connected',
          config: JSON.stringify(config),
          ...(tools.length > 0 ? { tools: toolsJson } : {}),
        },
      })
    : await db.integration.create({
        data: {
          workspaceId,
          registrySlug: `pd-${slug}`,
          name: displayName,
          kind: 'mcp',
          description: `${displayName} — managed connection via Pipedream Connect.`,
          category: mapCategory(app?.categories ?? []),
          color: 'violet',
          status: 'connected',
          config: JSON.stringify(config),
          tools: toolsJson,
          source: 'private',
          visibility: 'private',
          installs: 0,
        },
      })

  // Stamp tools with the integration id (ToolDef.integrationId).
  if (tools.length > 0) {
    const stamped = tools.map((t) => ({ ...t, integrationId: integration.id }))
    await db.integration.update({
      where: { id: integration.id },
      data: { tools: JSON.stringify(stamped) },
    })
    tools = stamped
  }

  return {
    result: {
      credentialId: credential.id,
      integrationId: integration.id,
      tools,
      accountLabel: account.name,
    },
    error: null,
  }
}

/**
 * Disconnect: delete the account upstream, revoke the local Credential, and
 * remove the Integration so agents stop offering its tools. Dependent frozen
 * workflows surface the missing integration at run time (reconnect gate).
 */
export async function removePipedreamConnection(
  userId: string,
  credentialId: string,
): Promise<{ ok: boolean; error: string | null }> {
  const credential = await db.credential.findFirst({
    where: { id: credentialId, userId, kind: 'pipedream' },
  })
  if (!credential) return { ok: false, error: 'Connection not found' }

  if (credential.pipedreamAccountId) {
    const deleted = await import('./connect').then((m) =>
      m.deleteAccount(credential.pipedreamAccountId as string),
    )
    if (!deleted) {
      console.warn(
        `[pipedream] upstream delete failed for ${credential.pipedreamAccountId}; revoking locally anyway`,
      )
    }
  }

  await db.credential.update({
    where: { id: credential.id },
    data: { status: 'revoked' },
  })

  if (credential.pipedreamAccountId) {
    await db.integration.deleteMany({
      where: {
        kind: 'mcp',
        config: { contains: `"accountId":"${credential.pipedreamAccountId}"` },
      },
    })
  }

  return { ok: true, error: null }
}
