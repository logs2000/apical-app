// Brave Search API — used by agent web_search tools and research routes.

export interface BraveSearchResult {
  title: string
  url: string
  host: string
  snippet: string
}

export class WebSearchUnavailableError extends Error {
  constructor(message = 'Web search unavailable. Set BRAVE_API_KEY in your environment.') {
    super(message)
    this.name = 'WebSearchUnavailableError'
  }
}

/** Search the web via Brave Search API. Requires BRAVE_API_KEY. */
export async function braveSearch(
  query: string,
  num = 6,
): Promise<BraveSearchResult[]> {
  const apiKey = (process.env.BRAVE_API_KEY || '').trim()
  if (!apiKey) throw new WebSearchUnavailableError()

  const count = Math.min(10, Math.max(1, num))
  const url = new URL('https://api.search.brave.com/res/v1/web/search')
  url.searchParams.set('q', query)
  url.searchParams.set('count', String(count))

  const res = await fetch(url.toString(), {
    headers: {
      Accept: 'application/json',
      'X-Subscription-Token': apiKey,
    },
    signal: AbortSignal.timeout(12_000),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Brave Search ${res.status}: ${text.slice(0, 300)}`)
  }

  const json = (await res.json()) as {
    web?: {
      results?: Array<{
        title?: string
        url?: string
        description?: string
      }>
    }
  }

  return (json.web?.results ?? []).slice(0, count).map((r) => {
    let host = ''
    try {
      host = r.url ? new URL(r.url).hostname : ''
    } catch {
      host = ''
    }
    return {
      title: r.title || '',
      url: r.url || '',
      host,
      snippet: r.description || '',
    }
  })
}

// ---------------- Keyless fallback (DuckDuckGo HTML) ----------------

function stripTags(s: string): string {
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** DuckDuckGo wraps result links in a redirect like
 *  `//duckduckgo.com/l/?uddg=<encoded real url>` — unwrap it. */
function decodeDdgHref(href: string): string {
  let h = href
  if (h.startsWith('//')) h = `https:${h}`
  try {
    const u = new URL(h)
    const uddg = u.searchParams.get('uddg')
    if (uddg) return decodeURIComponent(uddg)
  } catch {
    /* not a URL we can parse — return as-is */
  }
  return h
}

/** Search the web via DuckDuckGo's HTML endpoint — no API key required.
 *  Best-effort HTML parsing; used as a fallback when Brave isn't configured. */
async function duckDuckGoSearch(
  query: string,
  num = 6,
): Promise<BraveSearchResult[]> {
  const res = await fetch(
    `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
    {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
      },
      signal: AbortSignal.timeout(12_000),
    },
  )
  if (!res.ok) throw new Error(`DuckDuckGo ${res.status}`)
  const html = await res.text()

  // Collect snippets in document order so we can pair them with links.
  const snippets: string[] = []
  const snippetRe = /<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/g
  let sm: RegExpExecArray | null
  while ((sm = snippetRe.exec(html))) snippets.push(stripTags(sm[1]))

  const out: BraveSearchResult[] = []
  const linkRe = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g
  let m: RegExpExecArray | null
  let i = 0
  while ((m = linkRe.exec(html)) && out.length < num) {
    const url = decodeDdgHref(m[1])
    const title = stripTags(m[2])
    if (!url || !/^https?:\/\//.test(url) || !title) {
      i += 1
      continue
    }
    let host = ''
    try {
      host = new URL(url).hostname
    } catch {
      host = ''
    }
    out.push({ title, url, host, snippet: snippets[i] || '' })
    i += 1
  }
  return out
}

/**
 * Resilient web search. Uses Brave when BRAVE_API_KEY is configured, and
 * otherwise (or on Brave failure) falls back to a keyless DuckDuckGo search.
 * This is the function agents + research routes should call so the model can
 * always research + discover tools online, even with no API key set.
 */
export async function searchWeb(
  query: string,
  num = 6,
): Promise<BraveSearchResult[]> {
  const hasBrave = !!(process.env.BRAVE_API_KEY || '').trim()
  if (hasBrave) {
    try {
      const r = await braveSearch(query, num)
      if (r.length > 0) return r
    } catch {
      // fall through to the keyless fallback
    }
  }
  try {
    return await duckDuckGoSearch(query, num)
  } catch (e) {
    if (!hasBrave) {
      throw new WebSearchUnavailableError(
        'Web search failed: no BRAVE_API_KEY set and the keyless fallback was blocked. Set BRAVE_API_KEY for reliable search.',
      )
    }
    throw e
  }
}
