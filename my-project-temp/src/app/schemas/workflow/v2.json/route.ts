import { NextResponse } from 'next/server'
import { workflowJsonSchemaDoc } from '@/lib/workflow-schema'

// GET /schemas/workflow/v2.json — the public JSON Schema for WorkflowJSON v2.
// Generated from the Zod source of truth (src/lib/workflow-schema.ts) so the
// published contract can never drift from what the validator enforces.
export const dynamic = 'force-static'

export function GET() {
  return NextResponse.json(workflowJsonSchemaDoc(), {
    headers: {
      'Cache-Control': 'public, max-age=3600',
      'Access-Control-Allow-Origin': '*',
    },
  })
}
