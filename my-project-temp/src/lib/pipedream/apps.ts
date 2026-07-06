// Apical — Pipedream app catalog search.
//
// We deliberately do NOT bulk-sync the ~3,000-app catalog: the UI and the
// agent's app_search tool query this live (with a short in-memory cache), and
// a ConnectorCatalogEntry row is only upserted lazily when an app is actually
// connected (see sync.ts).

import { pdFetch } from './client'

export interface PipedreamApp {
  slug: string
  name: string
  imgSrc: string | null
  authType: string | null
  description: string | null
  categories: string[]
  featuredWeight: number
}

export interface AppSearchResult {
  apps: PipedreamApp[]
  nextCursor: string | null
  error: string | null
}

interface RawApp {
  id?: string
  name_slug?: string
  name?: string
  img_src?: string
  auth_type?: string
  description?: string
  categories?: string[]
  featured_weight?: number
}

const CACHE_TTL_MS = 10 * 60 * 1000
const cache = new Map<string, { at: number; result: AppSearchResult }>()

/** Search Pipedream's app catalog. Empty query returns featured apps. */
export async function searchApps(q: string, cursor?: string): Promise<AppSearchResult> {
  const query = q.trim().toLowerCase()
  const cacheKey = `${query}::${cursor ?? ''}`
  const hit = cache.get(cacheKey)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.result

  const params = new URLSearchParams()
  if (query) params.set('q', query)
  if (cursor) params.set('after', cursor)
  const qs = params.toString()

  const res = await pdFetch<{
    data?: RawApp[]
    page_info?: { end_cursor?: string; count?: number; total_count?: number }
  }>(`/connect/apps${qs ? `?${qs}` : ''}`)

  if (!res.ok || !Array.isArray(res.data?.data)) {
    return { apps: [], nextCursor: null, error: res.error || 'App search failed' }
  }

  const apps: PipedreamApp[] = res.data.data
    .filter((a) => a.name_slug)
    .map((a) => ({
      slug: a.name_slug as string,
      name: a.name || (a.name_slug as string),
      imgSrc: a.img_src ?? null,
      authType: a.auth_type ?? null,
      description: a.description ?? null,
      categories: Array.isArray(a.categories) ? a.categories : [],
      featuredWeight: a.featured_weight ?? 0,
    }))

  const result: AppSearchResult = {
    apps,
    nextCursor: res.data.page_info?.end_cursor ?? null,
    error: null,
  }
  cache.set(cacheKey, { at: Date.now(), result })
  return result
}

/** Look up one app's metadata by slug (exact match on name_slug). */
export async function getApp(slug: string): Promise<PipedreamApp | null> {
  const clean = slug.trim().toLowerCase()
  if (!clean) return null
  const { apps } = await searchApps(clean)
  return apps.find((a) => a.slug === clean) ?? apps[0] ?? null
}
