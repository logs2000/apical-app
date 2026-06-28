import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withUser } from '@/lib/auth-helpers'
import { mapTable, normalizeColumn, validateRow } from '@/lib/tables/table-dto'

// API routes for /api/tables/[id]/rows.
//
//   GET   — list rows (paginated). Optional ?where=<json> applies a simple
//           equality filter: { "column": "value", ... }.
//   POST  — insert a single row. Validates against the table's column schema.
//           Increments table.rowCount atomically.

interface RouteCtx {
  params: Promise<{ id: string }>
}

function parseLimit(v: string | null): number {
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0) return 50
  return Math.min(Math.floor(n), 500)
}
function parseOffset(v: string | null): number {
  const n = Number(v)
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.floor(n)
}

// GET /api/tables/[id]/rows
export const GET = withUser(async (req, { user, params }) => {
  const { id } = params
  const table = await db.dataTable.findUnique({ where: { id } })
  if (!table || table.userId !== user.id) {
    return NextResponse.json({ error: 'Table not found' }, { status: 404 })
  }

  const url = new URL(req.url)
  const limit = parseLimit(url.searchParams.get('limit'))
  const offset = parseOffset(url.searchParams.get('offset'))
  const whereRaw = url.searchParams.get('where')

  // Simple equality filter. Parse + validate it's a flat object.
  let where: Record<string, unknown> = {}
  if (whereRaw) {
    try {
      const parsed = JSON.parse(whereRaw) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        where = parsed as Record<string, unknown>
      } else {
        return NextResponse.json(
          { error: '?where must be a JSON object' },
          { status: 400 },
        )
      }
    } catch {
      return NextResponse.json(
        { error: '?where is not valid JSON' },
        { status: 400 },
      )
    }
  }

  // SQLite doesn't have JSON path operators in Prisma's API — we pull the
  // page of rows + filter in JS. For the small tables agents stash (leads,
  // inventories, calendars) this is plenty.
  const [rows, total] = await Promise.all([
    db.dataTableRow.findMany({
      where: { tableId: id },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    }),
    db.dataTableRow.count({ where: { tableId: id } }),
  ])

  const whereKeys = Object.keys(where)
  const filtered = rows
    .map((r) => {
      let data: Record<string, unknown> = {}
      try {
        const parsed = JSON.parse(r.rowJson) as unknown
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          data = parsed as Record<string, unknown>
        }
      } catch {
        /* ignore */
      }
      return {
        id: r.id,
        tableId: r.tableId,
        data,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      }
    })
    .filter((r) => {
      if (whereKeys.length === 0) return true
      return whereKeys.every((k) => {
        const want = where[k]
        const got = r.data[k]
        // Loose compare (string-coerce) so "?where={score:8}" matches a row
        // stored as {score: 8} or {score: "8"}.
        return String(got) === String(want)
      })
    })

  // Re-stitch columns onto the table for convenience.
  const columns = JSON.parse(table.columnsJson || '[]') as unknown[]
  const normColumns = columns
    .map((c) => normalizeColumn(c))
    .filter((c): c is NonNullable<typeof c> => c !== null)

  return NextResponse.json({
    table: mapTable(table),
    columns: normColumns,
    rows: filtered,
    total,
    limit,
    offset,
  })
})

interface InsertBody {
  row?: Record<string, unknown>
}

// POST /api/tables/[id]/rows
export const POST = withUser(async (req, { user, params }) => {
  const { id } = params
  const table = await db.dataTable.findUnique({ where: { id } })
  if (!table || table.userId !== user.id) {
    return NextResponse.json({ error: 'Table not found' }, { status: 404 })
  }

  let body: InsertBody = {}
  try {
    body = (await req.json()) as InsertBody
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  const row = body.row
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    return NextResponse.json(
      { error: 'row must be an object' },
      { status: 400 },
    )
  }

  const columns = JSON.parse(table.columnsJson || '[]') as unknown[]
  const normColumns = columns
    .map((c) => normalizeColumn(c))
    .filter((c): c is NonNullable<typeof c> => c !== null)

  const validationError = validateRow(normColumns, row)
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 })
  }

  const created = await db.dataTableRow.create({
    data: {
      tableId: id,
      rowJson: JSON.stringify(row),
    },
  })

  await db.dataTable.update({
    where: { id },
    data: { rowCount: { increment: 1 } },
  })

  return NextResponse.json(
    {
      id: created.id,
      tableId: created.tableId,
      data: row,
      createdAt: created.createdAt.toISOString(),
      updatedAt: created.updatedAt.toISOString(),
    },
    { status: 201 },
  )
})
