// Canonical API error codes — the machine-readable `code` in every error
// envelope (see respond.ts). Clients branch on these; the human `message` is
// for logs/humans and may change. Keep this list small and stable.

export const API_ERROR_CODES = [
  'unauthorized', // 401 — no/invalid credentials
  'forbidden', // 403 — authenticated but missing scope/permission
  'not_found', // 404
  'validation_failed', // 422 — body/query failed schema validation
  'rate_limited', // 429
  'conflict', // 409 — idempotency / state conflict
  'payment_required', // 402 — spend limit / allowance
  'internal', // 500 — unexpected
] as const

export type ApiErrorCode = (typeof API_ERROR_CODES)[number]

/** Default HTTP status for each error code. Callers may override. */
export const ERROR_STATUS: Record<ApiErrorCode, number> = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  validation_failed: 422,
  rate_limited: 429,
  conflict: 409,
  payment_required: 402,
  internal: 500,
}
