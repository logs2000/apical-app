// Cursor pagination — one convention for every list endpoint. Replaces the
// `limit`-only, no-total, no-cursor patterns that varied per route and could
// not page past the first N.
//
// Contract:
//   Request:  ?limit=<1..max>&cursor=<opaque>
//   Response: { data: T[], page: { nextCursor: string | null, hasMore: bool } }
//
// The cursor is an opaque base64 of (createdAt, id) — a keyset cursor, stable
// under inserts (unlike offset). Rows MUST be ordered by `createdAt DESC, id
// DESC` for the cursor to be correct; `cursorFilter()` produces the matching
// Prisma where-fragment.

export interface Cursor {
  createdAt: string // ISO
  id: string
}

export interface PageParams {
  limit: number
  cursor: Cursor | null
}

/** Encode a row's keyset position into an opaque cursor string. `field` is
 *  the timestamp column the list is ordered by (default createdAt; runs use
 *  startedAt). The cursor's internal key is always "createdAt" — it's opaque. */
export function encodeCursor(
  row: Record<string, unknown> & { id: string },
  field = 'createdAt',
): string {
  const raw = row[field]
  const createdAt = raw instanceof Date ? raw.toISOString() : String(raw)
  return Buffer.from(JSON.stringify({ createdAt, id: row.id }), 'utf8').toString('base64url')
}

/** Decode a cursor string, or null when absent/malformed (treated as "start"). */
export function decodeCursor(raw: string | null | undefined): Cursor | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as unknown
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof (parsed as Cursor).createdAt === 'string' &&
      typeof (parsed as Cursor).id === 'string'
    ) {
      return parsed as Cursor
    }
  } catch {
    /* fall through */
  }
  return null
}

/** Read + clamp pagination params from the query string. */
export function parsePagination(
  url: URL,
  opts: { defaultLimit?: number; maxLimit?: number } = {},
): PageParams {
  const defaultLimit = opts.defaultLimit ?? 50
  const maxLimit = opts.maxLimit ?? 200
  const rawLimit = Number(url.searchParams.get('limit'))
  const limit =
    Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(Math.floor(rawLimit), maxLimit)
      : defaultLimit
  return { limit, cursor: decodeCursor(url.searchParams.get('cursor')) }
}

/**
 * Prisma where-fragment that selects rows strictly after `cursor` under
 * `<field> DESC, id DESC` ordering. Spread into your `where`. Empty when there
 * is no cursor (first page).
 */
export function cursorFilter(cursor: Cursor | null, field = 'createdAt'): Record<string, unknown> {
  if (!cursor) return {}
  const ts = new Date(cursor.createdAt)
  return {
    OR: [{ [field]: { lt: ts } }, { [field]: ts, id: { lt: cursor.id } }],
  }
}

/** The matching Prisma orderBy — always pair it with cursorFilter(). */
export function cursorOrderBy(field = 'createdAt'): Array<Record<string, 'desc'>> {
  return [{ [field]: 'desc' }, { id: 'desc' }]
}

/**
 * Shape a page response. Fetch `limit + 1` rows; pass them here with the
 * requested `limit` (and the same `field` used for ordering). Returns the
 * trimmed page plus `nextCursor`/`hasMore`.
 */
export function paginate<T extends { id: string }>(
  rows: T[],
  limit: number,
  field = 'createdAt',
): { data: T[]; page: { nextCursor: string | null; hasMore: boolean } } {
  const hasMore = rows.length > limit
  const data = hasMore ? rows.slice(0, limit) : rows
  const last = data[data.length - 1]
  return {
    data,
    page: {
      nextCursor: hasMore && last ? encodeCursor(last as Record<string, unknown> & { id: string }, field) : null,
      hasMore,
    },
  }
}
