import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withUser } from '@/lib/auth-helpers'
import { workspaceIdForUser } from '@/lib/integration-scope'
import {
  checkPathsGranted,
  normalizeGrantedPath,
} from '@/lib/platform/granted-folders'

// /api/desktop/watches — watched-folder triggers ("new file in X runs Y").
//
//   GET  — list the user's watches.
//   POST — create: { workflowId, path, pattern? }. The path must be inside a
//          granted folder root. The first scan records a baseline, so files
//          already present never trigger.

function mapWatch(w: {
  id: string
  workflowId: string
  path: string
  pattern: string | null
  status: string
  lastScanAt: Date | null
  createdAt: Date
}) {
  return {
    id: w.id,
    workflowId: w.workflowId,
    path: w.path,
    pattern: w.pattern,
    status: w.status,
    lastScanAt: w.lastScanAt?.toISOString() ?? null,
    createdAt: w.createdAt.toISOString(),
  }
}

export const GET = withUser(async (_req, { user }) => {
  const watches = await db.watchedFolder.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
  })
  return NextResponse.json({ watches: watches.map(mapWatch) })
})

export const POST = withUser(async (req, { user }) => {
  let body: { workflowId?: string; path?: string; pattern?: string } = {}
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  const workflowId = String(body.workflowId ?? '').trim()
  const path = normalizeGrantedPath(String(body.path ?? ''))
  const pattern =
    typeof body.pattern === 'string' && body.pattern.trim()
      ? body.pattern.trim().slice(0, 200)
      : null

  if (!workflowId || !path) {
    return NextResponse.json(
      { error: 'workflowId and path are required' },
      { status: 400 },
    )
  }

  const workflow = await db.workflow.findUnique({ where: { id: workflowId } })
  if (!workflow || (workflow.userId && workflow.userId !== user.id)) {
    return NextResponse.json({ error: 'workflow_not_found' }, { status: 404 })
  }

  const granted = await checkPathsGranted(user.id, [path])
  if (!granted.ok) {
    return NextResponse.json({ error: granted.error }, { status: 403 })
  }

  const workspaceId = await workspaceIdForUser(user)
  const watch = await db.watchedFolder.create({
    data: { userId: user.id, workspaceId, workflowId, path, pattern },
  })

  return NextResponse.json(mapWatch(watch), { status: 201 })
})
