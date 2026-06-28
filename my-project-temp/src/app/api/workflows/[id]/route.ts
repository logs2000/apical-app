import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth-helpers'
import { mapWorkflow, mapExecutionPattern } from '@/lib/mappers'
import { serializeWorkflowJSON } from '@/lib/apical-server'
import type { WorkflowJSON, Department } from '@/lib/types'

interface RouteCtx {
  params: Promise<{ id: string }>
}

// GET /api/workflows/[id] — one workflow with its execution patterns.
export async function GET(req: Request, { params }: RouteCtx) {
  try {
    const user = await getCurrentUser(req)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const { id } = await params
    const row = await db.workflow.findUnique({
      where: { id },
      include: { patterns: { orderBy: { occurrences: 'desc' } } },
    })
    if (!row || row.userId !== user.id) {
      return NextResponse.json(
        { error: 'Workflow not found' },
        { status: 404 },
      )
    }
    const workflow = mapWorkflow(row)
    const patterns = row.patterns.map(mapExecutionPattern)
    return NextResponse.json({ workflow, patterns })
  } catch (err) {
    console.error('[api/workflows/[id]] GET failed:', err)
    return NextResponse.json(
      { error: 'Failed to load workflow' },
      { status: 500 },
    )
  }
}

interface PatchBody {
  name?: string
  description?: string
  steps?: WorkflowJSON
  trigger?: 'manual' | 'schedule'
  schedule?: string | null
  status?: 'draft' | 'active' | 'paused'
  department?: Department
  title?: string | null
  origin?: 'agent' | 'manual' | 'chat'
  workspaceId?: string | null
  runtime?: 'local' | 'hosted'
  // ---- Phase 3 config fields ----
  modelPreference?: string | null
  confidenceThreshold?: number | null
  autoHardenAfter?: number | null
  allowedTools?: string[] | null
  allowedCredentials?: string[] | null
}

// PATCH /api/workflows/[id] — partial update (name, description, steps, etc).
export async function PATCH(req: Request, { params }: RouteCtx) {
  try {
    const user = await getCurrentUser(req)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const { id } = await params
    const body = (await req.json()) as PatchBody

    const existing = await db.workflow.findUnique({ where: { id } })
    if (!existing || existing.userId !== user.id) {
      return NextResponse.json(
        { error: 'Workflow not found' },
        { status: 404 },
      )
    }

    const data: Record<string, unknown> = {}
    if (typeof body.name === 'string' && body.name.trim()) data.name = body.name.trim()
    if (typeof body.description === 'string') data.description = body.description
    if (body.trigger === 'manual' || body.trigger === 'schedule') data.trigger = body.trigger
    if (body.schedule !== undefined) data.schedule = body.schedule ?? null
    if (body.status === 'draft' || body.status === 'active' || body.status === 'paused') {
      data.status = body.status
    }
    if (body.steps && Array.isArray(body.steps.steps)) {
      data.stepsJson = serializeWorkflowJSON({ version: 1, steps: body.steps.steps })
    }
    if (typeof body.department === 'string' && body.department.trim()) {
      data.department = body.department.trim()
    }
    if (typeof body.title === 'string') {
      data.title = body.title.trim() || null
    }
    if (body.origin === 'agent' || body.origin === 'manual' || body.origin === 'chat') {
      data.origin = body.origin
    }
    if (typeof body.workspaceId === 'string' && body.workspaceId.trim()) {
      data.workspaceId = body.workspaceId.trim()
    } else if (body.workspaceId === null) {
      data.workspaceId = null
    }
    if (body.runtime === 'local' || body.runtime === 'hosted') {
      data.runtime = body.runtime
    }
    // Phase 3 config fields.
    if (body.modelPreference !== undefined) {
      data.modelPreference = typeof body.modelPreference === 'string' && body.modelPreference.trim()
        ? body.modelPreference.trim()
        : null
    }
    if (body.confidenceThreshold !== undefined) {
      const v = typeof body.confidenceThreshold === 'number' ? body.confidenceThreshold : null
      data.confidenceThreshold = v === null ? null : Math.max(0, Math.min(1, v))
    }
    if (body.autoHardenAfter !== undefined) {
      const v = typeof body.autoHardenAfter === 'number' ? body.autoHardenAfter : null
      data.autoHardenAfter = v === null ? null : Math.max(0, Math.floor(v))
    }
    if (body.allowedTools !== undefined) {
      data.allowedToolsJson = Array.isArray(body.allowedTools)
        ? JSON.stringify(body.allowedTools.filter((t): t is string => typeof t === 'string'))
        : null
    }
    if (body.allowedCredentials !== undefined) {
      data.allowedCredentialsJson = Array.isArray(body.allowedCredentials)
        ? JSON.stringify(body.allowedCredentials.filter((t): t is string => typeof t === 'string'))
        : null
    }

    const updated = await db.workflow.update({ where: { id }, data })
    return NextResponse.json(mapWorkflow(updated))
  } catch (err) {
    console.error('[api/workflows/[id]] PATCH failed:', err)
    return NextResponse.json(
      { error: 'Failed to update workflow' },
      { status: 500 },
    )
  }
}

// DELETE /api/workflows/[id] — remove an agent and cascade related rows.
export async function DELETE(req: Request, { params }: RouteCtx) {
  try {
    const user = await getCurrentUser(req)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const { id } = await params
    const existing = await db.workflow.findUnique({ where: { id } })
    if (!existing || existing.userId !== user.id) {
      return NextResponse.json(
        { error: 'Workflow not found' },
        { status: 404 },
      )
    }
    await db.workflow.delete({ where: { id } })
    return NextResponse.json({ ok: true, id })
  } catch (err) {
    console.error('[api/workflows/[id]] DELETE failed:', err)
    return NextResponse.json(
      { error: 'Failed to delete workflow' },
      { status: 500 },
    )
  }
}
