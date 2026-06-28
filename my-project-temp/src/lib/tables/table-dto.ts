import type { DataTable } from '@prisma/client'

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
