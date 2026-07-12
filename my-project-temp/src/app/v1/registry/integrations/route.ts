import { db } from '@/lib/db'
import { withAuth } from '@/lib/with-auth'
import { ok } from '@/lib/api/respond'

// GET /v1/registry/integrations — the connector registry visible to this
// workspace: curated catalog entries + global registry rows + the
// workspace's own installed instances. Query: q?, category?, kind?.
export const GET = withAuth(
  async (req, { workspace }) => {
    const url = new URL(req.url)
    const q = (url.searchParams.get('q') || '').trim().toLowerCase()
    const category = url.searchParams.get('category')
    const kind = url.searchParams.get('kind')

    const [catalog, integrations] = await Promise.all([
      db.connectorCatalogEntry.findMany({
        where: {
          status: { in: ['live', 'beta'] },
          ...(category ? { category } : {}),
          ...(kind ? { kind } : {}),
        },
        orderBy: { installCount: 'desc' },
      }),
      db.integration.findMany({
        where: {
          OR: [{ workspaceId: workspace.id }, { workspaceId: null }],
          ...(category ? { category } : {}),
          ...(kind ? { kind } : {}),
        },
        orderBy: { updatedAt: 'desc' },
      }),
    ])

    const match = (s: string) => !q || s.toLowerCase().includes(q)

    return ok({
      catalog: catalog
        .filter((c) => match(`${c.slug} ${c.name} ${c.description}`))
        .map((c) => ({
          slug: c.slug,
          name: c.name,
          kind: c.kind,
          category: c.category,
          description: c.shortDesc || c.description,
          status: c.status,
          tools: safeParse(c.toolsJson) ?? [],
        })),
      integrations: integrations
        .filter((i) => match(`${i.id} ${i.name} ${i.description}`))
        .map((i) => ({
          id: i.id,
          name: i.name,
          kind: i.kind,
          category: i.category,
          description: i.description,
          status: i.status,
          scope: i.workspaceId ? 'workspace' : 'registry',
          tools: safeParse(i.tools) ?? [],
        })),
    })
  },
  { scope: 'registry:read', rateLimit: { limit: 120, windowMs: 60_000 } },
)

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}
