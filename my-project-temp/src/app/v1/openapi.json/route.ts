import { NextResponse } from 'next/server'
import { buildOpenApiSpec } from '@/lib/api/openapi'

// GET /v1/openapi.json — the machine-readable API description (public). Import
// into Postman/Insomnia/an SDK generator, or point an LLM at it. Generated
// from the endpoint manifest in src/lib/api/openapi.ts, which is drift-checked
// against the actual route files by scripts/smoke/18-openapi-drift.ts.
export function GET(req: Request) {
  const origin = new URL(req.url).origin
  return NextResponse.json(buildOpenApiSpec(origin))
}
