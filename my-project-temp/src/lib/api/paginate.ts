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

/** Encode a row's keyset position into an opaque cursor string. */
export function encodeCursor(row: { createdAt: Date | string; id: string }): string {
  const createdAt = row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt
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
 * `createdAt DESC, id DESC` ordering. Spread into your `where`. Empty when
 * there is no cursor (first page).
 */
export function cursorFilter(cursor: Cursor | null): Record<string, unknown> {
  if (!cursor) return {}
  const createdAt = new Date(cursor.createdAt)
  return {
    OR: [
      { createdAt: { lt: createdAt } },
      { createdAt, id: { lt: cursor.id } },
    ],
  }
}

/** The matching Prisma orderBy — always pair it with cursorFilter(). */
export const CURSOR_ORDER_BY = [{ createdAt: 'desc' as const }, { id: 'desc' as const }]

/**
 * Shape a page response. Fetch `limit + 1` rows; pass them here with the
 * requested `limit`. Returns the trimmed page plus `nextCursor`/`hasMore`.
 */
export function paginate<T extends { createdAt: Date | string; id: string }>(
  rows: T[],
  limit: number,
): { data: T[]; page: { nextCursor: string | null; hasMore: boolean } } {
  const hasMore = rows.length > limit
  const data = hasMore ? rows.slice(0, limit) : rows
  const last = data[data.length - 1]
  return {
    data,
    page: { nextCursor: hasMore && last ? encodeCursor(last) : null, hasMore },
  }
}
