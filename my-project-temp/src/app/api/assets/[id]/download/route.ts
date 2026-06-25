import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth-helpers'
import { getUserAsset, readAssetBytes } from '@/lib/platform/assets'

// GET /api/assets/[id]/download — stream file bytes
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params
  const row = await getUserAsset(user.id, id)
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (row.kind === 'folder') {
    return NextResponse.json(
      { error: 'Folder reference — use localPath', localPath: row.localPath },
      { status: 400 },
    )
  }

  const bytes = await readAssetBytes(user.id, id)
  if (!bytes) return NextResponse.json({ error: 'File missing on disk' }, { status: 404 })

  return new Response(bytes, {
    headers: {
      'Content-Type': row.mimeType,
      'Content-Disposition': `attachment; filename="${encodeURIComponent(row.name)}"`,
      'Content-Length': String(bytes.length),
      'Cache-Control': 'private, max-age=3600',
    },
  })
}
