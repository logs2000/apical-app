import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { mapWorkflow } from '@/lib/mappers'
import { serializeWorkflowJSON } from '@/lib/apical-server'
import type { WorkflowJSON } from '@/lib/types'

interface RouteCtx {
  params: Promise<{ id: string }>
}

interface EditBody {
  /** The Assistant's plain-English description of the change. */
  description?: string
  /** Explicit fields to patch (the direct-edit case). */
  steps?: WorkflowJSON
  name?: string
  title?: string | null
  department?: string
  workspaceId?: string | null
}

// POST /api/employees/[id]/edit — apply a chat-proposed edit (or a direct
// programmatic patch) to an existing employee.
//
// For reliability we prefer the explicit-fields path: if `steps` is provided,
// patch the steps; if `name`/`title`/`department` are provided, patch those.
// The `description` field is saved onto the workflow's description (so the
// manager's plain-English summary of the change is visible to the owner). We
// don't currently call the LLM here — the manager already described the change
// in plain English in `description`, and that's good enough for the demo.
export async function POST(req: Request, { params }: RouteCtx) {
  try {
    const { id } = await params
    const body = (await req.json()) as EditBody

    const existing = await db.workflow.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json(
        { error: 'Employee not found' },
        { status: 404 },
      )
    }

    const data: Record<string, unknown> = {}

    // Description — the manager's plain-English summary of the change.
    if (typeof body.description === 'string' && body.description.trim()) {
      data.description = body.description.trim()
    }

    // Steps — patch if provided.
    if (body.steps && Array.isArray(body.steps.steps)) {
      data.stepsJson = serializeWorkflowJSON({
        version: 1,
        steps: body.steps.steps,
      })
    }

    // Name / title / department — patch if provided.
    if (typeof body.name === 'string' && body.name.trim()) {
      data.name = body.name.trim()
    }
    if (typeof body.title === 'string') {
      data.title = body.title.trim() || null
    }
    if (typeof body.department === 'string' && body.department.trim()) {
      data.department = body.department.trim()
    }
    if (typeof body.workspaceId === 'string' && body.workspaceId.trim()) {
      data.workspaceId = body.workspaceId.trim()
    } else if (body.workspaceId === null) {
      data.workspaceId = null
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json(
        {
          error:
            'No changes provided. Send `description`, `steps`, `name`, `title`, `department`, or `workspaceId`.',
        },
        { status: 400 },
      )
    }

    const updated = await db.workflow.update({ where: { id }, data })
    return NextResponse.json(mapWorkflow(updated))
  } catch (err) {
    console.error('[api/employees/[id]/edit] failed:', err)
    return NextResponse.json(
      { error: 'Failed to apply edit.' },
      { status: 500 },
    )
  }
}
