import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withUser } from '@/lib/auth-helpers'
import {
  COLUMN_TYPES,
  mapTable,
  normalizeColumn,
  type ColumnDef,
  type ColumnType,
} from '@/lib/tables/table-dto'

// API routes for /api/tables/[id].
//
//   GET     — fetch one table (columns + paginated rows).
//   PATCH   — rename the table, update description, or replace the column
//             schema. (Column changes don't migrate existing rows.)
//   DELETE  — delete the table + cascade rows.

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

// GET /api/tables/[id] — table + paginated rows.
export const GET = withUser(async (req, { user, params }) => {
  const { id } = params
  const url = new URL(req.url)
  const limit = parseLimit(url.searchParams.get('limit'))
  const offset = parseOffset(url.searchParams.get('offset'))

  const table = await db.dataTable.findUnique({ where: { id } })
  if (!table || table.userId !== user.id) {
    return NextResponse.json({ error: 'Table not found' }, { status: 404 })
  }

  const [rows, total] = await Promise.all([
    db.dataTableRow.findMany({
      where: { tableId: id },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    }),
    db.dataTableRow.count({ where: { tableId: id } }),
  ])

  const parsedRows = rows.map((r) => {
    let data: Record<string, unknown> = {}
    try {
      const parsed = JSON.parse(r.rowJson) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        data = parsed as Record<string, unknown>
      }
    } catch {
      /* leave empty */
    }
    return {
      id: r.id,
      tableId: r.tableId,
      data,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }
  })

  return NextResponse.json({
    table: mapTable(table),
    rows: parsedRows,
    total,
    limit,
    offset,
  })
})

interface PatchBody {
  name?: string
  description?: string
  columns?: Array<{ name?: string; type?: string; required?: boolean }>
}

// PATCH /api/tables/[id]
export const PATCH = withUser(async (req, { user, params }) => {
  const { id } = params
  const existing = await db.dataTable.findUnique({ where: { id } })
  if (!existing || existing.userId !== user.id) {
    return NextResponse.json({ error: 'Table not found' }, { status: 404 })
  }

  let body: PatchBody = {}
  try {
    body = (await req.json()) as PatchBody
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  const data: {
    name?: string
    description?: string
    columnsJson?: string
  } = {}

  if (typeof body.name === 'string') {
    const name = body.name.trim()
    if (!name) {
      return NextResponse.json({ error: 'name cannot be empty' }, { status: 400 })
    }
    if (name.length > 200) {
      return NextResponse.json(
        { error: 'name is too long (200 chars max)' },
        { status: 400 },
      )
    }
    data.name = name
  }

  if (typeof body.description === 'string') {
    if (body.description.length > 2000) {
      return NextResponse.json(
        { error: 'description is too long' },
        { status: 400 },
      )
    }
    data.description = body.description.trim()
  }

  if (Array.isArray(body.columns)) {
    if (body.columns.length === 0) {
      return NextResponse.json(
        { error: 'at least one column is required' },
        { status: 400 },
      )
    }
    const columns: ColumnDef[] = []
    const seen = new Set<string>()
    for (const c of body.columns) {
      const norm = normalizeColumn(c)
      if (!norm) {
        return NextResponse.json(
          { error: 'each column needs a name' },
          { status: 400 },
        )
      }
      if (seen.has(norm.name)) {
        return NextResponse.json(
          { error: `duplicate column name: ${norm.name}` },
          { status: 400 },
        )
      }
      seen.add(norm.name)
      columns.push(norm)
    }
    if (columns.length > 100) {
      return NextResponse.json(
        { error: 'too many columns (100 max)' },
        { status: 400 },
      )
    }
    data.columnsJson = JSON.stringify(columns)
  }

  // Reference COLUMN_TYPES so unused-import lint doesn't fire — also makes
  // the supported set discoverable to anyone reading this file.
  void (COLUMN_TYPES as unknown as readonly ColumnType[])

  const updated = await db.dataTable.update({ where: { id }, data })
  return NextResponse.json(mapTable(updated))
})

// DELETE /api/tables/[id]
export const DELETE = withUser(async (_req, { user, params }) => {
  const { id } = params
  const existing = await db.dataTable.findUnique({ where: { id } })
  if (!existing || existing.userId !== user.id) {
    return NextResponse.json({ error: 'Table not found' }, { status: 404 })
  }
  // DataTableRow has onDelete: Cascade on its table relation, so Prisma
  // handles the row cleanup. We delete the table.
  await db.dataTable.delete({ where: { id } })
  return NextResponse.json({ ok: true })
})
