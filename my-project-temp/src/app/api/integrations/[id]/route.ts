import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser, isAdminUser } from '@/lib/auth-helpers'
import { workspaceIdForUser } from '@/lib/integration-scope'

// DELETE /api/integrations/[id] — remove an integration instance.
//
// Workspace instances can be deleted by their workspace. Global registry rows
// (workspaceId null) can only be deleted by a platform admin.

interface RouteCtx {
  params: Promise<{ id: string }>
}

export async function DELETE(_req: Request, { params }: RouteCtx) {
  try {
    const user = await getCurrentUser(_req)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params
    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 })
    }

    const wsId = await workspaceIdForUser(user)
    const existing = await db.integration.findUnique({
      where: { id },
      select: { id: true, source: true, workspaceId: true },
    })
    if (!existing || (existing.workspaceId !== null && existing.workspaceId !== wsId)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    if (existing.workspaceId === null && !isAdminUser(user)) {
      return NextResponse.json(
        { error: 'Registry entries can only be removed by an admin.' },
        { status: 403 },
      )
    }

    await db.integration.delete({ where: { id } })
    return NextResponse.json({ ok: true, id })
  } catch (err) {
    console.error('[api/integrations/[id]] DELETE failed:', err)
    return NextResponse.json(
      { error: 'Failed to delete integration' },
      { status: 500 },
    )
  }
}
