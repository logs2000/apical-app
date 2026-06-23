import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth-helpers'
import { integrationFromRow } from '@/lib/apical-server'
import { ingestOpenApiSpec } from '@/lib/openapi-parser'
import type {
  Integration,
  IntegrationSource,
  IntegrationVisibility,
  ToolDef,
} from '@/lib/types'

// GET /api/integrations — list all integrations (sorted by category then name).
// Integrations are a global catalog (no userId column) — auth is still required
// so anonymous traffic can't enumerate them.
export async function GET(req: Request) {
  try {
    const user = await getCurrentUser(req)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const rows = await db.integration.findMany({
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    })
    const integrations: Integration[] = rows.map((r) => integrationFromRow(r))
    return NextResponse.json(integrations)
  } catch (err) {
    console.error('[api/integrations] GET failed:', err)
    return NextResponse.json(
      { error: 'Failed to load integrations' },
      { status: 500 },
    )
  }
}

interface CreateBody {
  name?: string
  kind?: 'mcp' | 'api' | 'http'
  url?: string
  specUrl?: string
  category?: string
  /** Where this integration came from. */
  source?: IntegrationSource
  /** User's choice for their own custom integrations. */
  visibility?: IntegrationVisibility
  /** Who contributed a public one (e.g. "@hannah", "community"). */
  authorLabel?: string
  description?: string
}

function coerceSource(raw: unknown): IntegrationSource {
  if (raw === 'builtin' || raw === 'private' || raw === 'public') return raw
  return 'private'
}

function coerceVisibility(raw: unknown): IntegrationVisibility {
  return raw === 'public' ? 'public' : 'private'
}

// Map a category to a plausible set of tools the agent would discover.
function toolsForCategory(
  integrationId: string,
  name: string,
  category: string,
): ToolDef[] {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 16)
  switch (category) {
    case 'files':
      return [
        { id: `${slug}.list`, name: 'List folder', description: 'List files in a folder.', integrationId },
        { id: `${slug}.read`, name: 'Read file', description: 'Read the contents of a file.', integrationId },
        { id: `${slug}.move`, name: 'Move file', description: 'Move a file to a destination folder.', integrationId },
      ]
    case 'email':
      return [
        { id: `${slug}.send`, name: 'Send email', description: 'Send an email to recipients.', integrationId },
        { id: `${slug}.search`, name: 'Search mail', description: 'Search messages with a query.', integrationId },
        { id: `${slug}.draft`, name: 'Create draft', description: 'Create a draft email for review.', integrationId },
      ]
    case 'messaging':
      return [
        { id: `${slug}.notify`, name: 'Notify channel', description: 'Send a notification to a channel.', integrationId },
        { id: `${slug}.postMessage`, name: 'Post message', description: 'Post a message to a channel.', integrationId },
      ]
    case 'finance':
      return [
        { id: `${slug}.listInvoices`, name: 'List invoices', description: 'List invoices with an optional filter.', integrationId },
        { id: `${slug}.createExpense`, name: 'Create expense', description: 'Record an expense entry.', integrationId },
      ]
    case 'documents':
      return [
        { id: `${slug}.extract`, name: 'Extract text', description: 'Extract text content from a document.', integrationId },
        { id: `${slug}.classify`, name: 'Classify document', description: 'Classify a document by type.', integrationId },
      ]
    case 'database':
      return [
        { id: `${slug}.query`, name: 'Run query', description: 'Run a read-only query.', integrationId },
        { id: `${slug}.upsert`, name: 'Upsert row', description: 'Insert or update a row by key.', integrationId },
      ]
    default:
      return [
        { id: `${slug}.action`, name: 'Run action', description: `Run an action on ${name}.`, integrationId },
        { id: `${slug}.query`, name: 'Query', description: `Query ${name} for records.`, integrationId },
      ]
  }
}

// Category → tailwind-friendly color token used in the UI.
const COLOR_BY_CATEGORY: Record<string, string> = {
  files: 'emerald',
  email: 'rose',
  messaging: 'violet',
  finance: 'emerald',
  documents: 'amber',
  database: 'sky',
  general: 'violet',
}

// POST /api/integrations — create a new integration.
//
// If `specUrl` is provided, we fetch + parse the OpenAPI spec at that URL
// and emit REAL tools from the spec's operations (one tool per HTTP operation
// per path). This is how Apical supports "thousands of integrations" without
// writing each one — the user pastes an OpenAPI URL, we auto-generate the
// tool surface. The agent can then call those tools through the runtime.
//
// If `specUrl` is NOT provided, we fall back to the legacy behavior: generate
// plausible stub tools based on the integration's category. This keeps
// existing flows working.
export async function POST(req: Request) {
  try {
    const user = await getCurrentUser(req)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const body = (await req.json()) as CreateBody
    const name = (body.name || '').trim()
    const kind = body.kind || 'http'
    const category = body.category || 'general'
    if (!name) {
      return NextResponse.json(
        { error: 'name is required' },
        { status: 400 },
      )
    }

    const config = {
      url: body.url || undefined,
      specUrl: body.specUrl || undefined,
      auth: {
        type:
          kind === 'mcp' ? 'mcp_token' : kind === 'api' ? 'oauth' : 'apikey',
      },
    }

    const source = coerceSource(body.source)
    const visibility = coerceVisibility(body.visibility)
    const authorLabel =
      typeof body.authorLabel === 'string' && body.authorLabel.trim()
        ? body.authorLabel.trim()
        : null

    // ─── OpenAPI spec ingestion ────────────────────────────────────────────
    // If a specUrl is provided, fetch + parse it and use the real tools. On
    // failure, fall through to category-derived stubs so the integration is
    // still created (with a warning in the description).
    let specTools: ToolDef[] = []
    let specDescriptionSuffix = ''
    let specBaseUrl: string | undefined
    if (body.specUrl && body.specUrl.trim()) {
      const result = await ingestOpenApiSpec(body.specUrl.trim())
      if (result.error) {
        specDescriptionSuffix = ` (OpenAPI spec ingest failed: ${result.error}; using category-derived stub tools.)`
      } else if (result.tools.length > 0) {
        specTools = result.tools
        specBaseUrl = result.baseUrl
        specDescriptionSuffix = ` — ${result.totalOperations} operations from OpenAPI ${result.specVersion} spec (${result.tools.length} tools emitted).`
        if (result.title && result.title !== 'Untitled API') {
          // Prepend the spec title to the description for traceability.
          specDescriptionSuffix = ` [${result.title} v${result.version}]${specDescriptionSuffix}`
        }
      } else {
        specDescriptionSuffix = ' (OpenAPI spec parsed but no operations found; using category-derived stub tools.)'
      }
    }

    // Use the spec's base URL if the caller didn't provide one.
    const finalConfig = {
      ...config,
      url: config.url || specBaseUrl,
    }

    // We need the integration id first to stamp tools with it.
    const created = await db.integration.create({
      data: {
        name,
        kind,
        description:
          (body.description ||
            `${source === 'public' ? 'Community-maintained' : source === 'private' ? 'Private' : 'Connected'} ${kind.toUpperCase()} integration for ${name}.`) +
          specDescriptionSuffix,
        category,
        color: COLOR_BY_CATEGORY[category] || 'violet',
        status: 'connected',
        config: JSON.stringify(finalConfig),
        tools: '[]',
        source,
        visibility,
        authorLabel,
        installs: 0,
      },
    })

    // If we have spec-derived tools, use them; otherwise fall back to category stubs.
    const tools =
      specTools.length > 0
        ? specTools.map((t) => ({ ...t, integrationId: created.id }))
        : toolsForCategory(created.id, name, category)
    const updated = await db.integration.update({
      where: { id: created.id },
      data: { tools: JSON.stringify(tools) },
    })

    return NextResponse.json(integrationFromRow(updated))
  } catch (err) {
    console.error('[api/integrations] POST failed:', err)
    return NextResponse.json(
      { error: 'Failed to create integration' },
      { status: 500 },
    )
  }
}
