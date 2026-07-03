import { NextResponse } from 'next/server'
import { automationFileSchemaDoc } from '@/lib/workflow-schema'

// GET /schemas/automation-file/v1.json — the public JSON Schema for
// AutomationFile (portable workflow + inline integrations + credential
// placeholders). Generated from the Zod source of truth.
export const dynamic = 'force-static'

export function GET() {
  return NextResponse.json(automationFileSchemaDoc(), {
    headers: {
      'Cache-Control': 'public, max-age=3600',
      'Access-Control-Allow-Origin': '*',
    },
  })
}
