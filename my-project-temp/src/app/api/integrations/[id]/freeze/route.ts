import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth-helpers'
import { integrationFromRow } from '@/lib/apical-server'
import { freezeArtifact, type FrozenArtifact } from '@/lib/auth/freeze-artifact'

// POST /api/integrations/[id]/freeze
//
// Freeze an integration into a deterministic artifact (per the execution model:
// figure-out-once-supervised → freeze). Production runs execute the frozen
// artifact verbatim — they do NOT re-derive integrations live on every run.
//
// Body: FrozenArtifact (see src/lib/auth/freeze-artifact.ts)
//   {
//     schemaVersion: 1,
//     frozenAt: string (ISO),
//     baseUrl: string,
//     auth: {
//       type: 'none' | 'apikey' | 'bearer' | 'basic' | 'oauth2' | 'mcp_static_token',
//       credentialId?: string,         // BY REFERENCE — never the secret itself
//       headerName?: string,
//       headerIn?: 'header' | 'query' | 'cookie',
//       headerPrefix?: string,
//     },
//     tools: [{
//       id: string,
//       method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD',
//       path: string,                  // with {param} placeholders
//       queryParameters: string[],
//       headerParameters: string[],
//       hasBody: boolean,
//       bodySchema?: object,
//     }],
//     liveCallConfirmation?: {         // optional but recommended
//       toolId: string,
//       status: number,                // 2xx
//       durationMs: number,
//       confirmedAt: string (ISO),
//     },
//   }
//
// The artifact is validated (credentials by reference, no secret inlining)
// and stashed in `Integration.config.frozenArtifact`. Future tool calls
// execute the frozen artifact deterministically.
//
// Returns the updated integration.

interface RouteCtx {
  params: Promise<{ id: string }>
}

export async function POST(req: Request, { params }: RouteCtx) {
  try {
    const user = await getCurrentUser(req)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params
    const row = await db.integration.findUnique({ where: { id } })
    if (!row) {
      return NextResponse.json({ error: 'Integration not found' }, { status: 404 })
    }

    const body = (await req.json().catch(() => ({}))) as FrozenArtifact
    let frozenJson: string
    try {
      frozenJson = freezeArtifact(body)
    } catch (err) {
      return NextResponse.json(
        { error: `Invalid frozen artifact: ${err instanceof Error ? err.message : String(err)}` },
        { status: 400 },
      )
    }

    // Merge the frozen artifact into the existing config.
    let existingConfig: Record<string, unknown> = {}
    try {
      existingConfig = JSON.parse(row.config) as Record<string, unknown>
    } catch {
      // ignore
    }
    const newConfig = {
      ...existingConfig,
      frozenArtifact: JSON.parse(frozenJson) as FrozenArtifact,
      frozenAt: new Date().toISOString(),
    }

    const updated = await db.integration.update({
      where: { id },
      data: { config: JSON.stringify(newConfig) },
    })

    return NextResponse.json({
      integration: integrationFromRow(updated),
      frozenArtifact: newConfig.frozenArtifact,
    })
  } catch (err) {
    console.error('[api/integrations/[id]/freeze] failed:', err)
    return NextResponse.json(
      { error: 'Failed to freeze integration' },
      { status: 500 },
    )
  }
}

// GET /api/integrations/[id]/freeze — fetch the frozen artifact (if any).
export async function GET(req: Request, { params }: RouteCtx) {
  try {
    const user = await getCurrentUser(req)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params
    const row = await db.integration.findUnique({ where: { id } })
    if (!row) {
      return NextResponse.json({ error: 'Integration not found' }, { status: 404 })
    }

    let config: Record<string, unknown> = {}
    try {
      config = JSON.parse(row.config) as Record<string, unknown>
    } catch {
      // ignore
    }

    const frozen = config.frozenArtifact
    if (!frozen) {
      return NextResponse.json(
        { frozen: false, message: 'Integration is not frozen. Call POST to freeze it.' },
        { status: 200 },
      )
    }
    return NextResponse.json({ frozen: true, artifact: frozen })
  } catch (err) {
    console.error('[api/integrations/[id]/freeze] GET failed:', err)
    return NextResponse.json(
      { error: 'Failed to fetch frozen artifact' },
      { status: 500 },
    )
  }
}
