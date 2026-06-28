import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withUser } from '@/lib/auth-helpers'
import {
  mapTable,
  normalizeColumn,
  type ColumnDef,
} from '@/lib/tables/table-dto'

// API routes for /api/tables.
//
//   GET   — list the current user's DataTables (lightweight: no rows).
//   POST  — create a new DataTable with a column schema.
//
// Columns schema (columnsJson):
//   [{ name: string, type: "string"|"number"|"boolean"|"date"|"json", required?: boolean }]
//
// Row data is stored on DataTableRow.rowJson keyed by column name. Changing
// columns on a table (via PATCH /api/tables/[id]) does NOT migrate existing
// rows — agents should re-shape rows themselves if needed.

// GET /api/tables — list the user's tables.
export const GET = withUser(async (_req, { user }) => {
  const rows = await db.dataTable.findMany({
    where: { userId: user.id },
    orderBy: { updatedAt: 'desc' },
  })
  return NextResponse.json(rows.map(mapTable))
})

interface CreateBody {
  name?: string
  description?: string
  columns?: Array<{ name?: string; type?: string; required?: boolean }>
  sourceWorkflowId?: string
}

// POST /api/tables — create a new table.
export const POST = withUser(async (req, { user }) => {
  let body: CreateBody = {}
  try {
    body = (await req.json()) as CreateBody
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  const name = (body.name || '').trim()
  if (!name) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }
  if (name.length > 200) {
    return NextResponse.json({ error: 'name is too long (200 chars max)' }, { status: 400 })
  }
  const description = (body.description || '').trim()
  if (description.length > 2000) {
    return NextResponse.json({ error: 'description is too long' }, { status: 400 })
  }

  const rawColumns = Array.isArray(body.columns) ? body.columns : []
  if (rawColumns.length === 0) {
    return NextResponse.json(
      { error: 'at least one column is required' },
      { status: 400 },
    )
  }
  const columns: ColumnDef[] = []
  const seenNames = new Set<string>()
  for (const c of rawColumns) {
    const norm = normalizeColumn(c)
    if (!norm) {
      return NextResponse.json(
        { error: 'each column needs a name' },
        { status: 400 },
      )
    }
    if (seenNames.has(norm.name)) {
      return NextResponse.json(
        { error: `duplicate column name: ${norm.name}` },
        { status: 400 },
      )
    }
    seenNames.add(norm.name)
    columns.push(norm)
  }
  if (columns.length > 100) {
    return NextResponse.json(
      { error: 'too many columns (100 max)' },
      { status: 400 },
    )
  }

  // Optional: verify the source workflow belongs to the user.
  let sourceWorkflowId: string | null = null
  if (body.sourceWorkflowId && typeof body.sourceWorkflowId === 'string') {
    const wf = await db.workflow.findUnique({
      where: { id: body.sourceWorkflowId },
      select: { id: true, userId: true },
    })
    if (!wf) {
      return NextResponse.json(
        { error: 'sourceWorkflowId not found' },
        { status: 400 },
      )
    }
    if (wf.userId && wf.userId !== user.id) {
      return NextResponse.json(
        { error: 'sourceWorkflowId not found' },
        { status: 400 },
      )
    }
    sourceWorkflowId = wf.id
  }

  const created = await db.dataTable.create({
    data: {
      userId: user.id,
      name,
      description,
      columnsJson: JSON.stringify(columns),
      sourceWorkflowId,
      rowCount: 0,
    },
  })

  return NextResponse.json(mapTable(created), { status: 201 })
})
