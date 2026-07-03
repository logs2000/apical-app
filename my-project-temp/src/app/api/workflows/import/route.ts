import { NextResponse } from 'next/server'
import { getCurrentUser, getWorkspaceForUser } from '@/lib/auth-helpers'
import {
  deployAutomationFile,
  parseAutomationFileBody,
  DeployError,
} from '@/lib/deploy'

// POST /api/workflows/import — import an AutomationFile (drag-and-drop JSON).
//
// Session-authenticated equivalent of the developer /api/dev/deploy endpoint.
// Installs the file's inline integrations + credentials and creates the
// workflow, all scoped to the caller's user + workspace.
//
// Replaces the old /api/employees/import ("employee" framing removed —
// workflows are automations, not hires).
export async function POST(req: Request) {
  try {
    const user = await getCurrentUser(req)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const workspace = await getWorkspaceForUser(user)

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
        workspaceId: workspace.id,
        userId: user.id,
        origin: 'agent',
      })
    } catch (e) {
      const status = e instanceof DeployError ? e.status : 400
      return NextResponse.json(
        { error: e instanceof Error ? e.message : 'Failed to import.' },
        { status },
      )
    }

    return NextResponse.json({
      workflow: result.agent,
      integrationsCreated: result.integrationsCreated,
      credentialsCreated: result.credentialsCreated,
    })
  } catch (err) {
    console.error('[api/workflows/import] POST failed:', err)
    return NextResponse.json(
      { error: 'Failed to import workflow.' },
      { status: 500 },
    )
  }
}
