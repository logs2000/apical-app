import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth-helpers'

// DELETE /api/integrations/[id] — remove an integration.
//
// The Integration table is a global catalog (no userId column) but we still
// require auth so anonymous traffic can't delete entries. In the future we'll
// add ownership scoping once the schema has a userId field on Integration.

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

    const existing = await db.integration.findUnique({
      where: { id },
      select: { id: true, source: true },
    })
    if (!existing) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
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
