import { NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { db } from '@/lib/db'
import { withAuth } from '@/lib/with-auth'
import { findScopedWorkflow } from '@/lib/v1/mappers'

function hookUrl(req: Request, workflowId: string, secret: string): string {
  const origin = new URL(req.url).origin
  return `${origin}/v1/hooks/w/${workflowId}/${secret}`
}

// GET /v1/workflows/{id}/trigger-url — current inbound trigger URL (if enabled).
export const GET = withAuth(
  async (req, ctx) => {
    const workflow = await findScopedWorkflow(ctx.params.id, ctx)
    if (!workflow) {
      return NextResponse.json({ error: 'Workflow not found.' }, { status: 404 })
    }
    return NextResponse.json({
      enabled: Boolean(workflow.triggerSecret),
      url: workflow.triggerSecret
        ? hookUrl(req, workflow.id, workflow.triggerSecret)
        : null,
    })
  },
  { scope: 'workflows:read' },
)

// POST /v1/workflows/{id}/trigger-url — mint (or rotate) the inbound trigger
// URL. POSTing to the returned URL starts a run with the request body exposed
// to steps as {{trigger.*}}.
export const POST = withAuth(
  async (req, ctx) => {
    const workflow = await findScopedWorkflow(ctx.params.id, ctx)
    if (!workflow) {
      return NextResponse.json({ error: 'Workflow not found.' }, { status: 404 })
    }
    const secret = randomBytes(24).toString('hex')
    await db.workflow.update({
      where: { id: workflow.id },
      data: { triggerSecret: secret },
    })
    return NextResponse.json(
      { enabled: true, url: hookUrl(req, workflow.id, secret) },
      { status: 201 },
    )
  },
  { scope: 'workflows:write' },
)

// DELETE /v1/workflows/{id}/trigger-url — disable the inbound trigger URL.
export const DELETE = withAuth(
  async (_req, ctx) => {
    const workflow = await findScopedWorkflow(ctx.params.id, ctx)
    if (!workflow) {
      return NextResponse.json({ error: 'Workflow not found.' }, { status: 404 })
    }
    await db.workflow.update({
      where: { id: workflow.id },
      data: { triggerSecret: null },
    })
    return NextResponse.json({ enabled: false })
  },
  { scope: 'workflows:write' },
)
