import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth-helpers'
import { integrationFromRow } from '@/lib/apical-server'
import { ingestOpenApiSpec, filterTools, type ToolFilter } from '@/lib/openapi-parser'
import type { ToolDef } from '@/lib/types'

// POST /api/integrations/ingest-spec
//
// On-demand OpenAPI spec ingestion. Used by the research agent mid-flight:
// while the agent is researching a user's job, it may discover that a target
// service publishes an OpenAPI spec. Instead of waiting for the user to
// manually create an integration, the agent calls this endpoint with the
// spec URL + a name, and Apical fetches, parses, and persists the integration
// with real tools.
//
// PER A2 (corrected scoping):
//   - OpenAPI ingestion is a DISCOVERY mechanism, ORTHOGONAL to auth.
//   - We ingest the spec to generate the tool surface REGARDLESS of declared
//     auth type.
//   - Auth is resolved from the spec's securitySchemes (not from a separate
//     `authType` request field — that was the mis-scoped v1 behavior).
//   - The resolved auth schemes are surfaced on the response; the
//     integration-freeze step (POST /api/integrations/[id]/freeze) picks one
//     and routes through F1 (oauth2 → BYOC + OAuth engine) or F2
//     (apikey/bearer/basic → vault static injection).
//
// TOOL FILTERING (per A2):
//   - A 400-endpoint spec must NOT dump 400 tools into the agent's context.
//   - The caller may pass a `filter` to select a subset:
//       { mode: 'all' | 'by_id' | 'by_tag' | 'by_path',
//         selectedIds?: string[], selectedTags?: string[],
//         selectedPathPrefixes?: string[] }
//   - The selected subset is what gets persisted. The full tool list is
//     returned on the response (as `availableTools`) so the UI can show
//     what was filtered out.
//
// Body:
//   {
//     specUrl: string,
//     name?: string,
//     category?: string,
//     description?: string,
//     baseUrl?: string,
//     filter?: ToolFilter,
//   }
//
// Returns:
//   {
//     integration: Integration,
//     tools: ToolDef[],            // the selected subset (what's persisted)
//     availableTools: ToolDef[],   // the full list (for UI reference)
//     authSchemes: ResolvedAuthScheme[], // what the spec declares
//     spec: { title, version, specVersion, totalOperations, baseUrl },
//   }

interface IngestBody {
  specUrl?: string
  name?: string
  category?: string
  description?: string
  baseUrl?: string
  filter?: ToolFilter
}

const COLOR_BY_CATEGORY: Record<string, string> = {
  files: 'emerald',
  email: 'rose',
  messaging: 'violet',
  finance: 'emerald',
  documents: 'amber',
  database: 'sky',
  general: 'violet',
}

export async function POST(req: Request) {
  try {
    const user = await getCurrentUser(req)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = (await req.json().catch(() => ({}))) as IngestBody
    const specUrl = (body.specUrl || '').trim()
    if (!specUrl) {
      return NextResponse.json(
        { error: 'specUrl is required' },
        { status: 400 },
      )
    }

    // Fetch + parse the spec.
    const result = await ingestOpenApiSpec(specUrl)
    if (result.error) {
      return NextResponse.json(
        { error: `Spec ingest failed: ${result.error}` },
        { status: 400 },
      )
    }
    if (result.tools.length === 0) {
      return NextResponse.json(
        { error: `Spec parsed but no operations found. Spec version: ${result.specVersion}.` },
        { status: 400 },
      )
    }

    // Apply tool filtering. Default = 'all' (preserves v1 behavior for callers
    // that don't pass a filter).
    const filter: ToolFilter = body.filter || { mode: 'all' }
    const { tools: selectedTools, dropped } = filterTools(result.tools, filter)

    if (selectedTools.length === 0) {
      return NextResponse.json(
        {
          error: `Tool filter selected 0 tools (out of ${result.tools.length}). Adjust the filter or use mode: 'all'.`,
          availableTools: result.tools,
        },
        { status: 400 },
      )
    }

    const name = (body.name || result.title || 'Untitled API').trim()
    const category = body.category || 'general'
    const description =
      body.description ||
      [
        result.description?.trim() || '',
        `Auto-ingested from OpenAPI ${result.specVersion} spec on ${new Date().toISOString().slice(0, 10)}.`,
        `${result.totalOperations} operations → ${selectedTools.length} tools selected (${dropped} filtered out).`,
      ]
        .filter(Boolean)
        .join(' ')

    // Auth resolution: surface what the spec declares. The freeze step picks one.
    // For backward compat with the runtime, if there's exactly one scheme, use it
    // as the default; otherwise leave auth.type as 'none' and let the freeze step decide.
    const defaultScheme = result.authSchemes.length === 1 ? result.authSchemes[0] : null
    const baseUrl = body.baseUrl || result.baseUrl

    const config = {
      url: baseUrl,
      specUrl,
      // The declared auth schemes (full detail). The freeze step will pick one
      // and replace `auth` with the resolved form.
      auth: defaultScheme
        ? {
            type: defaultScheme.type,
            schemeName: defaultScheme.schemeName,
            headerName: defaultScheme.headerName,
            headerIn: defaultScheme.headerIn,
            authorizationUrl: defaultScheme.authorizationUrl,
            tokenUrl: defaultScheme.tokenUrl,
            scopes: defaultScheme.scopes,
          }
        : { type: 'none' },
      authSchemes: result.authSchemes,
      spec: {
        title: result.title,
        version: result.version,
        specVersion: result.specVersion,
        totalOperations: result.totalOperations,
        toolsEmitted: selectedTools.length,
        toolsFilteredOut: dropped,
        ingestedAt: new Date().toISOString(),
      },
    }

    // Create the integration with empty tools first (we need the id).
    const created = await db.integration.create({
      data: {
        name,
        kind: 'api',
        description,
        category,
        color: COLOR_BY_CATEGORY[category] || 'violet',
        status: 'connected',
        config: JSON.stringify(config),
        tools: '[]',
        source: 'private',
        visibility: 'private',
        authorLabel: null,
        installs: 0,
      },
    })

    // Stamp each selected tool with the integration id and persist.
    const tools: ToolDef[] = selectedTools.map((t) => ({
      ...t,
      integrationId: created.id,
    }))
    const updated = await db.integration.update({
      where: { id: created.id },
      data: { tools: JSON.stringify(tools) },
    })

    return NextResponse.json({
      integration: integrationFromRow(updated),
      tools,
      // Surface the full available list + dropped count so the UI can show
      // what was filtered out and let the user adjust.
      availableTools: result.tools,
      droppedCount: dropped,
      authSchemes: result.authSchemes,
      spec: {
        title: result.title,
        version: result.version,
        specVersion: result.specVersion,
        totalOperations: result.totalOperations,
        baseUrl: result.baseUrl,
      },
    })
  } catch (err) {
    console.error('[api/integrations/ingest-spec] failed:', err)
    return NextResponse.json(
      {
        error: `Failed to ingest spec: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 500 },
    )
  }
}
