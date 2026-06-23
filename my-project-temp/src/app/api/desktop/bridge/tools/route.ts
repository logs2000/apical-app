import { NextResponse } from 'next/server'
import { withUser } from '@/lib/auth-helpers'
import { MCP_TOOLS } from '@/lib/platform/desktop-tools'

// GET /api/desktop/bridge/tools — the 9-tool MCP catalog the desktop bridge
// exposes to hosted agents. Same shape as `GET http://localhost:3005/tools`
// from the mini-service.

export const GET = withUser(async () => {
  return NextResponse.json({ tools: MCP_TOOLS })
})
