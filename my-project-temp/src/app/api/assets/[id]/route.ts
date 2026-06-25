import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth-helpers'
import { deleteUserAsset, getUserAsset, toAssetRecord } from '@/lib/platform/assets'

// GET /api/assets/[id] — asset metadata
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params
  const row = await getUserAsset(user.id, id)
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ asset: toAssetRecord(row) })
}

// DELETE /api/assets/[id]
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params
  const ok = await deleteUserAsset(user.id, id)
  if (!ok) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
