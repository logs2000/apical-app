// Smoke: the shared API primitives (src/lib/api/*). Pure-function + wrapper
// level — no DB/auth needed. The /v1 integration (real key, scopes, envelope
// over live routes) is covered by 16-api-scopes.
// Run: bun scripts/smoke/15-api-primitives.ts

import { z } from 'zod'
import { ok, apiError, ApiError, toErrorResponse } from '../../src/lib/api/respond'
import { parseBody, parseQuery } from '../../src/lib/api/validate'
import {
  encodeCursor,
  decodeCursor,
  parsePagination,
  cursorFilter,
  paginate,
} from '../../src/lib/api/paginate'
import { route } from '../../src/lib/api/route'

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error(`FAIL: ${msg}`)
    process.exit(1)
  }
}
const json = (r: Response) => r.json() as Promise<Record<string, unknown>>

// 1. Success + error envelopes.
{
  const r = ok({ hello: 'world' }, { status: 201 })
  assert(r.status === 201, 'ok() honors status')
  const b = (await json(r)) as { data?: { hello: string } }
  assert(b.data?.hello === 'world', 'ok() wraps payload under data')
  assert(!('error' in b), 'success envelope has no error key')

  const e = apiError('not_found', 'Nope.', { details: { id: 'x' } })
  assert(e.status === 404, 'apiError maps code→status')
  const eb = (await json(e)) as { error?: { code: string; message: string; details?: unknown } }
  assert(eb.error?.code === 'not_found' && eb.error.message === 'Nope.', 'error envelope shape')
  assert((eb.error?.details as { id: string }).id === 'x', 'error details passthrough')
  assert(!('data' in eb), 'error envelope has no data key')
}

// 2. toErrorResponse: ApiError faithful, unknown → generic 500 (no leak).
{
  const mapped = toErrorResponse(new ApiError('conflict', 'Dup.', { headers: { 'X-T': '1' } }))
  assert(mapped.status === 409 && mapped.headers.get('x-t') === '1', 'ApiError headers preserved')
  const boom = toErrorResponse(new Error('secret internal detail'))
  assert(boom.status === 500, 'unknown error → 500')
  const bb = (await json(boom)) as { error: { code: string; message: string } }
  assert(bb.error.code === 'internal' && !/secret internal/.test(bb.error.message), 'no internal leak')
}

// 3. Validation.
{
  const schema = z.object({ name: z.string().min(1), count: z.number().int() })
  const good = await parseBody(
    new Request('http://x', { method: 'POST', body: JSON.stringify({ name: 'a', count: 3 }) }),
    schema,
  )
  assert(good.name === 'a' && good.count === 3, 'parseBody returns typed data')

  let threw: ApiError | null = null
  try {
    await parseBody(
      new Request('http://x', { method: 'POST', body: JSON.stringify({ name: '', count: 1.5 }) }),
      schema,
    )
  } catch (e) {
    threw = e as ApiError
  }
  assert(threw?.code === 'validation_failed' && Array.isArray(threw.details), 'bad body → validation_failed w/ issues')

  let badJson: ApiError | null = null
  try {
    await parseBody(new Request('http://x', { method: 'POST', body: '{not json' }), schema)
  } catch (e) {
    badJson = e as ApiError
  }
  assert(badJson?.code === 'validation_failed', 'invalid JSON → validation_failed')

  const q = parseQuery(new URL('http://x/?limit=5&on=true'), z.object({ limit: z.coerce.number(), on: z.coerce.boolean() }))
  assert(q.limit === 5 && q.on === true, 'parseQuery coerces')
}

// 4. Pagination + cursor round-trip.
{
  const p = parsePagination(new URL('http://x/?limit=999'), { maxLimit: 200 })
  assert(p.limit === 200, 'limit clamped to max')
  assert(parsePagination(new URL('http://x/')).limit === 50, 'default limit')

  const cur = encodeCursor({ createdAt: new Date('2026-01-02T03:04:05.000Z'), id: 'abc' })
  const decoded = decodeCursor(cur)
  assert(decoded?.id === 'abc' && decoded.createdAt === '2026-01-02T03:04:05.000Z', 'cursor round-trips')
  assert(decodeCursor('garbage!!') === null, 'malformed cursor → null')

  const filter = cursorFilter(decoded) as { OR: unknown[] }
  assert(Array.isArray(filter.OR) && filter.OR.length === 2, 'cursorFilter keyset OR')
  assert(Object.keys(cursorFilter(null)).length === 0, 'no cursor → empty filter')

  const rows = Array.from({ length: 4 }, (_, i) => ({ id: `id${i}`, createdAt: new Date(2026, 0, 4 - i) }))
  const page = paginate(rows, 3)
  assert(page.data.length === 3 && page.page.hasMore === true && page.page.nextCursor, 'paginate trims + nextCursor when extra row')
  const last = paginate(rows.slice(0, 2), 3)
  assert(last.page.hasMore === false && last.page.nextCursor === null, 'no extra row → hasMore false')
}

// 5. route() wrapper — public path: validation + rate limit + envelope.
{
  const handler = route(
    async (_req, { body }) => ok({ echoed: body.msg }),
    { public: true, body: z.object({ msg: z.string() }), rateLimit: { limit: 1, windowMs: 60_000 } },
  )
  const call = (msg: unknown) =>
    handler(
      new Request('http://x/echo', { method: 'POST', body: JSON.stringify({ msg }) }),
      { params: Promise.resolve({}) },
    )

  const good = await call('hi')
  assert(good.status === 200 && (await json(good)).data !== undefined, 'route handler runs, envelope applied')

  // Second call same key → rate limited (429 + Retry-After).
  const limited = await call('again')
  assert(limited.status === 429, 'second call rate-limited')
  assert(Number(limited.headers.get('retry-after')) > 0, 'Retry-After header present')
  const lb = (await json(limited)) as { error: { code: string } }
  assert(lb.error.code === 'rate_limited', 'rate_limited code')

  // Bad body → 422 envelope (fresh path to avoid the rate-limit bucket).
  const badHandler = route(async (_req, { body }) => ok(body), {
    public: true,
    body: z.object({ msg: z.string() }),
  })
  const bad = await badHandler(
    new Request('http://x/echo2', { method: 'POST', body: JSON.stringify({ msg: 123 }) }),
    { params: Promise.resolve({}) },
  )
  assert(bad.status === 422, 'bad body → 422')
  assert((await json(bad)).error !== undefined, '422 uses error envelope')
}

console.log('OK: 15-api-primitives')
process.exit(0)
