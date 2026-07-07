// Zod-backed request validation. Replaces the hand-rolled `typeof body.x`
// ladders duplicated across ~50 routes. A failed parse throws an `ApiError`
// with code `validation_failed` (422) whose `details` carries Zod's issue
// list, so clients get a precise, machine-readable reason.
//
// `zod` was already a dependency (used only by the WorkflowJSON validator);
// this makes it the standard for HTTP inputs too.

import { z } from 'zod'
import { ApiError } from './respond'

/** Parse + validate a JSON request body against a schema. Throws ApiError. */
export async function parseBody<S extends z.ZodTypeAny>(
  req: Request,
  schema: S,
): Promise<z.infer<S>> {
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    throw new ApiError('validation_failed', 'Request body must be valid JSON.')
  }
  const result = schema.safeParse(raw)
  if (!result.success) {
    throw new ApiError('validation_failed', 'Request body failed validation.', {
      details: result.error.issues,
    })
  }
  return result.data
}

/** Parse + validate the query string against a schema. Throws ApiError.
 *  Query values are always strings — use `z.coerce.*` in the schema for
 *  numbers/booleans. */
export function parseQuery<S extends z.ZodTypeAny>(url: URL, schema: S): z.infer<S> {
  const obj = Object.fromEntries(url.searchParams.entries())
  const result = schema.safeParse(obj)
  if (!result.success) {
    throw new ApiError('validation_failed', 'Query parameters failed validation.', {
      details: result.error.issues,
    })
  }
  return result.data
}
