import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth-helpers'
import { mapWorkflow } from '@/lib/mappers'
import { serializeWorkflowJSON } from '@/lib/apical-server'
import type { WorkflowJSON } from '@/lib/types'

// GET /api/workflows?workspaceId=... — list the current user's workflows
// (steps parsed). Always scoped by userId so data is isolated between users.
//
// If `workspaceId` is provided, additionally filter to that workspace OR
// legacy null-workspace rows (which belong to no workspace).
export async function GET(req: Request) {
  try {
    const user = await getCurrentUser(req)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const url = new URL(req.url)
    const workspaceId = url.searchParams.get('workspaceId')
    // Always scope by userId so users only see their own agents. Legacy
    // seeded rows with userId=null are visible only when the bypass dev user
    // (also null in dev seeds) is the caller — in production, every row has
    // a userId and the OR fallback is a no-op.
    const where: Record<string, unknown> = { userId: user.id }
    if (workspaceId) {
      where.OR = [{ workspaceId }, { workspaceId: null }]
    }
    const rows = await db.workflow.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
    })
    return NextResponse.json(rows.map(mapWorkflow))
  } catch (err) {
    console.error('[api/workflows] GET failed:', err)
    return NextResponse.json(
      { error: 'Failed to load workflows' },
      { status: 500 },
    )
  }
}

interface CreateBody {
  name?: string
  description?: string
  steps?: WorkflowJSON
  trigger?: 'manual' | 'schedule'
  schedule?: string | null
  /** Free-form department label the agent creates (e.g. "Filing", "Inbox"). */
  department?: string
  /** Role title, e.g. "Filing Agent". */
  title?: string
  /** Which workspace this agent belongs to (null = default). */
  workspaceId?: string | null
  /** Where this agent runs: local (desktop) or hosted (server). Default hosted. */
  runtime?: 'local' | 'hosted'
}

// POST /api/workflows — create a new workflow (typically from the agent chat's
// "approve agent" flow). Accepts department + title + workspaceId so the new
// agent lands in the right place.
export async function POST(req: Request) {
  try {
    const user = await getCurrentUser(req)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const body = (await req.json()) as CreateBody
    const name = (body.name || '').trim()
    if (!name) {
      return NextResponse.json(
        { error: 'name is required' },
        { status: 400 },
      )
    }
    const steps: WorkflowJSON =
      body.steps && Array.isArray(body.steps.steps)
        ? { version: 1, steps: body.steps.steps }
        : { version: 1, steps: [] }

    // Tool steps may carry an inline `http` spec — accept them as-is. The
    // runtime knows how to execute http steps directly (no named tool needed).
    // We just sanitize the shape so the JSON stays valid.

    const department =
      typeof body.department === 'string' && body.department.trim()
        ? body.department.trim()
        : 'General'

    const title =
      typeof body.title === 'string' && body.title.trim()
        ? body.title.trim()
        : null

    const workspaceId =
      typeof body.workspaceId === 'string' && body.workspaceId.trim()
        ? body.workspaceId.trim()
        : null

    const created = await db.workflow.create({
      data: {
        userId: user.id,
        name,
        description: body.description || '',
        stepsJson: serializeWorkflowJSON(steps),
        trigger: body.trigger || 'manual',
        schedule: body.schedule ?? null,
        status: 'active',
        origin: 'agent',
        department,
        title,
        workspaceId,
        runtime: body.runtime === 'local' ? 'local' : 'hosted',
      },
    })
    return NextResponse.json(mapWorkflow(created))
  } catch (err) {
    console.error('[api/workflows] POST failed:', err)
    return NextResponse.json(
      { error: 'Failed to create workflow' },
      { status: 500 },
    )
  }
}
