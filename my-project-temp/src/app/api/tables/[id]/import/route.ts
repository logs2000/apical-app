import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withUser } from '@/lib/auth-helpers'
import { normalizeColumn, validateRow } from '@/lib/tables/table-dto'

// API route for /api/tables/[id]/import.
//
//   POST — bulk-insert rows. Capped at 1000 rows per request.
//          Each row is validated against the table's column schema; the
//          first invalid row aborts the whole batch with a 400 (so agents
//          don't end up with a half-loaded batch).

interface RouteCtx {
  params: Promise<{ id: string }>
}

const MAX_ROWS = 1000

interface ImportBody {
  rows?: Array<Record<string, unknown>>
}

export const POST = withUser(async (req, { user, params }) => {
  const { id } = params
  const table = await db.dataTable.findUnique({ where: { id } })
  if (!table || table.userId !== user.id) {
    return NextResponse.json({ error: 'Table not found' }, { status: 404 })
  }

  let body: ImportBody = {}
  try {
    body = (await req.json()) as ImportBody
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  if (!Array.isArray(body.rows)) {
    return NextResponse.json(
      { error: 'rows must be an array' },
      { status: 400 },
    )
  }
  if (body.rows.length === 0) {
    return NextResponse.json(
      { error: 'rows array is empty' },
      { status: 400 },
    )
  }
  if (body.rows.length > MAX_ROWS) {
    return NextResponse.json(
      { error: `too many rows (max ${MAX_ROWS} per import)` },
      { status: 400 },
    )
  }

  const columns = JSON.parse(table.columnsJson || '[]') as unknown[]
  const normColumns = columns
    .map((c) => normalizeColumn(c))
    .filter((c): c is NonNullable<typeof c> => c !== null)

  // Validate every row first; abort on the first bad one.
  for (let i = 0; i < body.rows.length; i++) {
    const row = body.rows[i]
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      return NextResponse.json(
        { error: `row ${i} must be an object` },
        { status: 400 },
      )
    }
    const err = validateRow(normColumns, row)
    if (err) {
      return NextResponse.json(
        { error: `row ${i}: ${err}` },
        { status: 400 },
      )
    }
  }

  // Bulk insert in a single createMany (no per-row triggers needed —
  // SQLite handles it fast).
  const created = await db.dataTableRow.createMany({
    data: body.rows.map((r) => ({
      tableId: id,
      rowJson: JSON.stringify(r),
    })),
  })

  await db.dataTable.update({
    where: { id },
    data: { rowCount: { increment: created.count } },
  })

  return NextResponse.json(
    { inserted: created.count, total: body.rows.length },
    { status: 201 },
  )
})
