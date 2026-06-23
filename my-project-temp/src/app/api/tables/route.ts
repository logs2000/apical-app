import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withUser } from '@/lib/auth-helpers'
import type { DataTable } from '@prisma/client'

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

export type ColumnType = 'string' | 'number' | 'boolean' | 'date' | 'json'

export interface ColumnDef {
  name: string
  type: ColumnType
  required?: boolean
}

export const COLUMN_TYPES: ColumnType[] = [
  'string',
  'number',
  'boolean',
  'date',
  'json',
]

export interface TableDto {
  id: string
  userId: string
  name: string
  description: string
  columns: ColumnDef[]
  sourceWorkflowId: string | null
  rowCount: number
  createdAt: string
  updatedAt: string
}

export function mapTable(row: DataTable): TableDto {
  let columns: ColumnDef[] = []
  try {
    const parsed = JSON.parse(row.columnsJson) as unknown
    if (Array.isArray(parsed)) {
      columns = parsed
        .map((c) => normalizeColumn(c))
        .filter((c): c is ColumnDef => c !== null)
    }
  } catch {
    columns = []
  }
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    description: row.description,
    columns,
    sourceWorkflowId: row.sourceWorkflowId,
    rowCount: row.rowCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

/** Coerce a raw column object into a valid ColumnDef, or null. */
export function normalizeColumn(raw: unknown): ColumnDef | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  const name = String(obj.name ?? '').trim()
  if (!name) return null
  const type = COLUMN_TYPES.includes(obj.type as ColumnType)
    ? (obj.type as ColumnType)
    : 'string'
  const required = obj.required === true
  return { name, type, required }
}

/** Validate a row against a column schema (returns human error or null). */
export function validateRow(
  columns: ColumnDef[],
  row: Record<string, unknown>,
): string | null {
  const colNames = new Set(columns.map((c) => c.name))
  for (const col of columns) {
    const v = row[col.name]
    if (v === undefined || v === null || v === '') {
      if (col.required) return `Missing required field: ${col.name}`
      continue
    }
    const err = checkColumnType(col, v)
    if (err) return `Field "${col.name}": ${err}`
  }
  // Unknown columns are allowed (forward-compat) but flagged when there are
  // no matching schema columns at all — that's almost certainly a bug.
  if (columns.length > 0) {
    const knownKeys = Object.keys(row).filter((k) => colNames.has(k))
    if (knownKeys.length === 0) {
      return `Row has no fields matching the table schema (expected: ${Array.from(
        colNames,
      ).join(', ')})`
    }
  }
  return null
}

function checkColumnType(col: ColumnDef, v: unknown): string | null {
  switch (col.type) {
    case 'string':
      if (typeof v !== 'string') return 'expected string'
      return null
    case 'number':
      if (typeof v === 'number') return null
      if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)))
        return null
      return 'expected number'
    case 'boolean':
      if (typeof v === 'boolean') return null
      if (v === 'true' || v === 'false') return null
      return 'expected boolean'
    case 'date':
      if (typeof v !== 'string') return 'expected ISO date string'
      if (Number.isNaN(Date.parse(v))) return 'expected a valid date'
      return null
    case 'json':
      if (typeof v === 'object') return null
      if (typeof v === 'string') {
        try {
          JSON.parse(v)
          return null
        } catch {
          return 'expected JSON'
        }
      }
      return 'expected JSON object or string'
    default:
      return null
  }
}

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
