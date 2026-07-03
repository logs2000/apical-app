import { NextResponse } from 'next/server'
import { withUser } from '@/lib/auth-helpers'
import {
  checkPathsGranted,
  listGrantedRoots,
  normalizeGrantedPath,
} from '@/lib/platform/granted-folders'
import { desktopListDir } from '@/lib/desktop/desktop-fs'

// GET /api/desktop/fs?path=... — list a directory on the user's desktop,
// constrained to granted folder roots. Powers the file-browser pane.
//
// Without ?path, returns the granted roots themselves (the browser's top
// level). With ?path, returns entries of that directory if — and only if —
// it lives inside a granted root.
export const GET = withUser(async (req, { user }) => {
  const url = new URL(req.url)
  const rawPath = url.searchParams.get('path')

  const roots = await listGrantedRoots(user.id)

  if (!rawPath) {
    return NextResponse.json({
      roots: roots.map((r) => ({ id: r.id, path: r.path, label: r.label })),
    })
  }

  const dirPath = normalizeGrantedPath(rawPath)
  const check = await checkPathsGranted(user.id, [dirPath])
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: 403 })
  }

  const result = await desktopListDir(user.id, dirPath)
  if (!result.ok) {
    const status = result.error === 'desktop_offline' ? 503 : 502
    return NextResponse.json({ error: result.error }, { status })
  }

  return NextResponse.json({ path: dirPath, entries: result.entries })
})
