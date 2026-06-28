import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withUser } from '@/lib/auth-helpers'
import { normalizeColumn, validateRow } from '@/lib/tables/table-dto'

// API routes for /api/tables/[id]/rows/[rowId].
//
//   PATCH   — update a row's data (full replacement of rowJson). Re-validates
//             against the table's column schema. Partial updates are merged.
//   DELETE  — delete the row + decrement table.rowCount.

interface RouteCtx {
  params: Promise<{ id: string; rowId: string }>
}

interface PatchBody {
  row?: Record<string, unknown>
}

// PATCH /api/tables/[id]/rows/[rowId]
export const PATCH = withUser(async (req, { user, params }) => {
  const { id, rowId } = params

  const table = await db.dataTable.findUnique({ where: { id } })
  if (!table || table.userId !== user.id) {
    return NextResponse.json({ error: 'Table not found' }, { status: 404 })
  }

  const existing = await db.dataTableRow.findUnique({ where: { id: rowId } })
  if (!existing || existing.tableId !== id) {
    return NextResponse.json({ error: 'Row not found' }, { status: 404 })
  }

  let body: PatchBody = {}
  try {
    body = (await req.json()) as PatchBody
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  if (!body.row || typeof body.row !== 'object' || Array.isArray(body.row)) {
    return NextResponse.json(
      { error: 'row must be an object' },
      { status: 400 },
    )
  }

  // Merge: existing row data is the base, body.row overrides.
  let current: Record<string, unknown> = {}
  try {
    const parsed = JSON.parse(existing.rowJson) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      current = parsed as Record<string, unknown>
    }
  } catch {
    /* ignore */
  }
  const merged: Record<string, unknown> = { ...current, ...body.row }

  const columns = JSON.parse(table.columnsJson || '[]') as unknown[]
  const normColumns = columns
    .map((c) => normalizeColumn(c))
    .filter((c): c is NonNullable<typeof c> => c !== null)

  const validationError = validateRow(normColumns, merged)
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 })
  }

  const updated = await db.dataTableRow.update({
    where: { id: rowId },
    data: { rowJson: JSON.stringify(merged) },
  })

  return NextResponse.json({
    id: updated.id,
    tableId: updated.tableId,
    data: merged,
    createdAt: updated.createdAt.toISOString(),
    updatedAt: updated.updatedAt.toISOString(),
  })
})

// DELETE /api/tables/[id]/rows/[rowId]
export const DELETE = withUser(async (_req, { user, params }) => {
  const { id, rowId } = params
  const table = await db.dataTable.findUnique({ where: { id } })
  if (!table || table.userId !== user.id) {
    return NextResponse.json({ error: 'Table not found' }, { status: 404 })
  }
  const existing = await db.dataTableRow.findUnique({ where: { id: rowId } })
  if (!existing || existing.tableId !== id) {
    return NextResponse.json({ error: 'Row not found' }, { status: 404 })
  }
  await db.dataTableRow.delete({ where: { id: rowId } })
  await db.dataTable.update({
    where: { id },
    data: { rowCount: { decrement: 1 } },
  })
  return NextResponse.json({ ok: true })
})
