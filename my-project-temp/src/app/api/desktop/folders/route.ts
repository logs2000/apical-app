import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withUser, isDesktopClientRequest } from '@/lib/auth-helpers'
import { workspaceIdForUser } from '@/lib/integration-scope'
import { normalizeGrantedPath } from '@/lib/platform/granted-folders'

// /api/desktop/folders — the user's granted folder roots (desktop sandbox).
//
//   GET  — list granted roots.
//   POST — grant a new root: { path, label? }. The desktop app calls this
//          after the user picks a directory in the native dialog. Idempotent
//          per (user, path).

export const GET = withUser(async (_req, { user }) => {
  const folders = await db.grantedFolder.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'asc' },
  })
  return NextResponse.json({
    folders: folders.map((f) => ({
      id: f.id,
      path: f.path,
      label: f.label,
      createdAt: f.createdAt.toISOString(),
    })),
  })
})

export const POST = withUser(async (req, { user }) => {
  if (!(await isDesktopClientRequest(req))) {
    return NextResponse.json(
      {
        error:
          'Folder grants must be created from the Apical desktop app (Settings → Desktop → Grant folder). Web sessions cannot grant filesystem access.',
      },
      { status: 403 },
    )
  }

  let body: { path?: string; label?: string } = {}
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  const path = normalizeGrantedPath(String(body.path ?? ''))
  if (!path) {
    return NextResponse.json({ error: 'path is required' }, { status: 400 })
  }
  const label =
    typeof body.label === 'string' && body.label.trim()
      ? body.label.trim().slice(0, 200)
      : path.split(/[/\\]/).pop() || path

  const workspaceId = await workspaceIdForUser(user)
  const folder = await db.grantedFolder.upsert({
    where: { userId_path: { userId: user.id, path } },
    update: { label },
    create: { userId: user.id, workspaceId, path, label },
  })

  return NextResponse.json(
    { id: folder.id, path: folder.path, label: folder.label },
    { status: 201 },
  )
})
