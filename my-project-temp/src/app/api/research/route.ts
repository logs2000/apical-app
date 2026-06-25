import { NextResponse } from 'next/server'
import { simpleComplete } from '@/lib/platform/llm-gateway'
import { searchWeb } from '@/lib/platform/web-search'
import type {
  ApiDiscoveryCandidate,
  IntegrationKind,
  ResearchResult,
} from '@/lib/types'

interface ResearchBody {
  query?: string
}

interface SearchResult {
  url: string
  name: string
  snippet?: string
  host_name?: string
  rank?: number
  date?: string
  favicon?: string
}

function stripFences(s: string): string {
  let out = s.trim()
  out = out.replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim()
  const first = out.indexOf('{')
  const last = out.lastIndexOf('}')
  if (first !== -1 && last !== -1 && last > first) {
    out = out.slice(first, last + 1)
  }
  return out
}

function coerceKind(raw: unknown): IntegrationKind {
  if (raw === 'mcp' || raw === 'http' || raw === 'api') return raw
  return 'api'
}

/** Defensive coercion of LLM-returned candidates into ApiDiscoveryCandidate[]. */
function coerceCandidates(raw: unknown): ApiDiscoveryCandidate[] {
  if (!Array.isArray(raw)) return []
  const out: ApiDiscoveryCandidate[] = []
  raw.forEach((c, i) => {
    if (!c || typeof c !== 'object') return
    const r = c as Record<string, unknown>
    const service =
      typeof r.service === 'string' && r.service.trim() ? r.service.trim() : ''
    if (!service) return
    const kind = coerceKind(r.kind)
    const toolsRaw = Array.isArray(r.tools) ? r.tools : []
    const tools = toolsRaw
      .filter((t): t is Record<string, unknown> => !!t && typeof t === 'object')
      .slice(0, 6)
      .map((t, j) => {
        const id =
          typeof t.id === 'string' && t.id
            ? t.id
            : `${service.toLowerCase().replace(/[^a-z0-9]+/g, '')}.tool${j + 1}`
        const name =
          typeof t.name === 'string' && t.name ? t.name : `Tool ${j + 1}`
        const description =
          typeof t.description === 'string' ? t.description : ''
        return { id, name, description }
      })
    const fieldsRaw = Array.isArray(r.credentialFields) ? r.credentialFields : []
    let credentialFields = fieldsRaw
      .filter((f): f is Record<string, unknown> => !!f && typeof f === 'object')
      .slice(0, 5)
      .map((f, j) => {
        const key =
          typeof f.key === 'string' && f.key ? f.key : `field_${j + 1}`
        const label =
          typeof f.label === 'string' && f.label ? f.label : `Field ${j + 1}`
        const type: 'apikey' | 'oauth' | 'mcp_token' =
          f.type === 'oauth' || f.type === 'mcp_token' || f.type === 'apikey'
            ? (f.type as 'apikey' | 'oauth' | 'mcp_token')
            : 'apikey'
        const placeholder =
          typeof f.placeholder === 'string' ? f.placeholder : undefined
        const required = f.required !== false
        return { key, label, type, placeholder, required }
      })
    if (credentialFields.length === 0) {
      credentialFields = [
        {
          key: 'api_key',
          label: 'API key',
          type: 'apikey',
          placeholder: 'Paste your API key here',
          required: true,
        },
      ]
    }
    out.push({
      id: typeof r.id === 'string' && r.id ? r.id : `cand_${i + 1}`,
      service,
      kind,
      specUrl: typeof r.specUrl === 'string' ? r.specUrl : undefined,
      url: typeof r.url === 'string' ? r.url : undefined,
      description:
        typeof r.description === 'string' && r.description
          ? r.description
          : `Connect ${service} so your agents can use it.`,
      tools,
      credentialFields,
    })
  })
  return out
}

// POST /api/research — search the web for API/MCP docs and synthesize a
// ResearchResult (summary + sources + candidate APIs) via the LLM.
//
// Body: { query: string }
// Returns: ResearchResult
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as ResearchBody
    const query = (body.query || '').trim()
    if (!query) {
      return NextResponse.json(
        { error: 'query is required' },
        { status: 400 },
      )
    }

    // 1. Run the web search.
    let searchResults: SearchResult[] = []
    try {
      const raw = await searchWeb(`${query} API documentation`, 8)
      searchResults = raw.map((r) => ({
        url: r.url,
        name: r.title || r.url,
        snippet: r.snippet,
        host_name: r.host,
      }))
    } catch (err) {
      console.error('[api/research] web_search failed:', err)
      // Continue with empty results — the LLM can still say so honestly.
    }

    const sources = searchResults.slice(0, 8).map((r) => ({
      title: r.name || r.url,
      url: r.url,
      snippet: r.snippet || undefined,
    }))

    // 2. Ask the LLM to synthesize.
    const systemPrompt = `You are researching APIs for an automation platform. Given these search results about '${query}', identify any APIs or MCP servers found. For each, return: service name, kind (mcp/api/http), the doc URL, a description, 2-4 plausible tools (id + name + description), and what credentials are needed (as credentialFields). Respond with ONLY JSON: { summary, sources: [{title,url,snippet}], candidates: [ApiDiscoveryCandidate] }. If nothing real was found, return empty candidates with an honest summary. The \`candidates\` array shape is: [{ id, service, kind: 'mcp'|'api'|'http', specUrl?, url?, description, tools: [{id,name,description}], credentialFields: [{key,label,type:'apikey'|'oauth'|'mcp_token',placeholder?,required}] }]. Never invent tools for the user's existing connected tools — only for the discovered service. credentialFields should describe what the user must provide to connect (e.g. an API key or OAuth token).`

    const sourcesBlock = sources.length
      ? sources
          .map(
            (s, i) =>
              `${i + 1}. ${s.title}\n   URL: ${s.url}\n   ${s.snippet ? s.snippet : ''}`.trim(),
          )
          .join('\n')
      : '(The web search returned no results. Be honest about this in your summary.)'

    const userPrompt = `Web search results for "${query} API documentation":\n\n${sourcesBlock}\n\nSynthesize a ResearchResult. Reply with ONLY the JSON object.`

    let summary =
      sources.length > 0
        ? `I found ${sources.length} source(s) about "${query}" but couldn't fully synthesize them right now.`
        : `I couldn't find any web results about "${query}" right now.`
    let candidates: ApiDiscoveryCandidate[] = []

    try {
      const text = await simpleComplete({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        json: true,
      })
      const cleaned = stripFences(text)
      const parsed = JSON.parse(cleaned) as {
        summary?: unknown
        sources?: unknown
        candidates?: unknown
      }
      if (typeof parsed.summary === 'string' && parsed.summary.trim()) {
        summary = parsed.summary.trim()
      }
      // Prefer the LLM's sources if it surfaced real URLs we didn't find,
      // otherwise use the actual web_search results.
      if (Array.isArray(parsed.sources) && parsed.sources.length > 0) {
        const llmSources = parsed.sources
          .filter(
            (s): s is { title?: unknown; url?: unknown; snippet?: unknown } =>
              !!s && typeof s === 'object',
          )
          .map((s) => ({
            title:
              typeof s.title === 'string' && s.title
                ? s.title
                : typeof s.url === 'string'
                  ? s.url
                  : '',
            url: typeof s.url === 'string' ? s.url : '',
            snippet:
              typeof s.snippet === 'string' && s.snippet
                ? s.snippet
                : undefined,
          }))
          .filter((s) => s.url)
        if (llmSources.length > 0) {
          // Merge: prefer real web_search sources, append any new LLM URLs.
          const haveUrls = new Set(sources.map((s) => s.url))
          for (const ls of llmSources) {
            if (!haveUrls.has(ls.url)) sources.push(ls)
          }
        }
      }
      candidates = coerceCandidates(parsed.candidates)
    } catch (err) {
      console.error('[api/research] LLM synthesis failed:', err)
      // Fall through with empty candidates + the honest summary above.
    }

    const result: ResearchResult = {
      query,
      summary,
      sources: sources.slice(0, 10),
      candidates,
    }
    return NextResponse.json(result)
  } catch (err) {
    console.error('[api/research] failed:', err)
    return NextResponse.json(
      {
        query: '',
        summary: `Research failed: ${err instanceof Error ? err.message : String(err)}`,
        sources: [],
        candidates: [],
      },
      { status: 500 },
    )
  }
}
