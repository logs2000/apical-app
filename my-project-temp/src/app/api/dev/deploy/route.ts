import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withDevAuth } from '@/lib/dev-auth'
import {
  deployAutomationFile,
  parseAutomationFileBody,
  DeployError,
} from '@/lib/deploy'

// POST /api/dev/deploy — authenticated via bearer API key (NOT cookie).
// Called by the apical-mcp server (or the REST API directly). Accepts an
// AutomationFile (same shape as /api/employees/import), installs its inline
// integrations + credentials, and creates a workflow scoped to the developer's
// workspaceId. Logs to McpAuditLog with source='mcp'.
export const POST = withDevAuth(async (req, { developer, apiKey }) => {
  try {
    let file
    try {
      file = await parseAutomationFileBody(req)
    } catch (e) {
      const status = e instanceof DeployError ? e.status : 400
      return NextResponse.json(
        { error: e instanceof Error ? e.message : 'Invalid body.' },
        { status },
      )
    }

    let result
    try {
      result = await deployAutomationFile(file, {
        workspaceId: developer.workspaceId,
        origin: 'agent',
      })
    } catch (e) {
      const status = e instanceof DeployError ? e.status : 400
      return NextResponse.json(
        { error: e instanceof Error ? e.message : 'Failed to deploy.' },
        { status },
      )
    }

    // Audit log.
    await db.mcpAuditLog.create({
      data: {
        developerId: developer.id,
        apiKeyId: apiKey.id,
        action: 'mcp:deploy',
        target: result.agent.id,
        success: true,
        costCents: 0,
        detail: `Deployed agent "${result.agent.name}" (${result.agent.id}). ${result.integrationsCreated} integration(s), ${result.credentialsCreated} credential(s).`,
        source: 'mcp',
      },
    })

    return NextResponse.json(result)
  } catch (err) {
    console.error('[api/dev/deploy] POST failed:', err)
    return NextResponse.json(
      { error: 'Failed to deploy.' },
      { status: 500 },
    )
  }
})
