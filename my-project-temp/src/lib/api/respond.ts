// The one place API responses take shape. Every route on the canonical
// surface returns through `ok()` or throws an `ApiError` (converted by
// `toErrorResponse`, which the `route()` wrapper calls). This replaces the
// old grab-bag of hand-rolled `NextResponse.json({ error: 'string' })` calls
// with a single envelope:
//
//   success → { "data": <payload> }
//   error   → { "error": { "code": <ApiErrorCode>, "message": string,
//                          "details"?: unknown } }
//
// Success and error are disjoint top-level keys, so a client can branch on
// which key is present without inspecting the status code.

import { NextResponse } from 'next/server'
import { ERROR_STATUS, type ApiErrorCode } from './errors'

/** Success envelope. `data` is the payload; lists use `{ data, page }` via
 *  paginate.ts, which is still a superset of this shape. */
export function ok<T>(
  data: T,
  opts?: { status?: number; headers?: HeadersInit },
): NextResponse {
  return NextResponse.json({ data }, { status: opts?.status ?? 200, headers: opts?.headers })
}

/** A response body that already is the full envelope (e.g. from paginate()).
 *  Sends it as-is under the given status without re-wrapping in `data`. */
export function okEnvelope(
  envelope: Record<string, unknown>,
  opts?: { status?: number; headers?: HeadersInit },
): NextResponse {
  return NextResponse.json(envelope, { status: opts?.status ?? 200, headers: opts?.headers })
}

/**
 * A structured API error. Throw it from anywhere inside a `route()` handler
 * (or the wrapper's auth/validation stages) and it becomes the error envelope
 * with the right status. `headers` lets rate-limit attach `Retry-After`.
 */
export class ApiError extends Error {
  readonly code: ApiErrorCode
  readonly status: number
  readonly details?: unknown
  readonly headers?: HeadersInit
  constructor(
    code: ApiErrorCode,
    message: string,
    opts?: { status?: number; details?: unknown; headers?: HeadersInit },
  ) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = opts?.status ?? ERROR_STATUS[code]
    this.details = opts?.details
    this.headers = opts?.headers
  }
}

/** Build an error-envelope response directly (when you have a Response to
 *  return rather than a throw site). */
export function apiError(
  code: ApiErrorCode,
  message: string,
  opts?: { status?: number; details?: unknown; headers?: HeadersInit },
): NextResponse {
  const body: { error: { code: ApiErrorCode; message: string; details?: unknown } } = {
    error: { code, message },
  }
  if (opts?.details !== undefined) body.error.details = opts.details
  return NextResponse.json(body, {
    status: opts?.status ?? ERROR_STATUS[code],
    headers: opts?.headers,
  })
}

/**
 * Convert any thrown value into an error-envelope response. `ApiError` maps
 * faithfully; anything else is logged and returned as a generic 500 so we
 * never leak internal error text to clients.
 */
export function toErrorResponse(err: unknown): NextResponse {
  if (err instanceof ApiError) {
    return apiError(err.code, err.message, {
      status: err.status,
      details: err.details,
      headers: err.headers,
    })
  }
  console.error('[api] unhandled route error:', err)
  return apiError('internal', 'Internal server error.')
}
