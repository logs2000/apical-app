// SSRF guard for every agent-reachable network fetch (audit finding: SSRF).
//
// Agents can request arbitrary URLs via http_request / web_read / image_read /
// the browser tool. Without a guard those fetches run from OUR network and can
// reach things the user never could: cloud metadata (169.254.169.254), the
// database, other mini-services, anything on localhost or the VPC. Every such
// fetch must go through assertPublicUrl() (validate before connect) or
// fetchPublicUrl() (validate + re-validate on every redirect hop).
//
// What is blocked:
//   - non-http(s) schemes (file:, gopher:, ftp:, ...)
//   - loopback (127.0.0.0/8, ::1), unspecified (0.0.0.0/8, ::)
//   - RFC1918 (10/8, 172.16/12, 192.168/16) and CGNAT (100.64/10)
//   - link-local v4 (169.254/16 — includes the cloud metadata IP) and
//     v6 (fe80::/10), IPv6 ULA (fc00::/7), multicast/reserved ranges
//   - IPv4-mapped IPv6 (::ffff:a.b.c.d) — unwrapped and checked as v4
//   - hostnames that only make sense inside a network: localhost,
//     *.localhost, *.local, *.internal, *.home.arpa
//   - hostnames whose DNS resolution includes ANY blocked address
//     (a public name pointed at a private IP is the classic bypass)
//
// The WHATWG URL parser normalizes exotic IPv4 spellings (0x7f000001,
// 2130706433, 017700000001) to dotted decimal before we ever see them, so
// those bypasses are covered by parsing first and checking u.hostname.
//
// Known limitation (roadmap, deliberate): DNS is checked via lookup() and the
// subsequent fetch() resolves again — a malicious resolver that flips records
// between the two lookups (DNS rebinding) can slip through. Closing that needs
// connection pinning (custom undici dispatcher). The short re-use of the
// process-wide DNS cache plus our own 30s verdict cache narrows the window.
//
// Dev/test escape hatch: APICAL_NET_GUARD_ALLOW="host1,host2" exempts exact
// hostnames (e.g. "127.0.0.1" for a local fixture server). Never set it in
// production.

import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

export class BlockedUrlError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BlockedUrlError'
  }
}

const BLOCKED_HOSTNAMES = new Set(['localhost', 'metadata.google.internal'])
const BLOCKED_HOST_SUFFIXES = ['.localhost', '.local', '.internal', '.home.arpa']

function allowedByEnv(hostname: string): boolean {
  const raw = process.env.APICAL_NET_GUARD_ALLOW
  if (!raw) return false
  return raw
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean)
    .includes(hostname)
}

function isBlockedIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number)
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true
  const [a, b] = parts
  if (a === 0) return true // 0.0.0.0/8 "this network"
  if (a === 10) return true // RFC1918
  if (a === 100 && b >= 64 && b <= 127) return true // CGNAT 100.64/10
  if (a === 127) return true // loopback
  if (a === 169 && b === 254) return true // link-local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true // RFC1918
  if (a === 192 && b === 168) return true // RFC1918
  if (a === 192 && b === 0 && parts[2] === 0) return true // 192.0.0/24 IETF
  if (a === 198 && (b === 18 || b === 19)) return true // 198.18/15 benchmarking
  if (a >= 224) return true // multicast 224/4 + reserved 240/4 + broadcast
  return false
}

function isBlockedIPv6(ip: string): boolean {
  // Strip zone id (fe80::1%eth0) and brackets if present.
  const bare = ip.replace(/^\[|\]$/g, '').split('%')[0].toLowerCase()
  // IPv4-mapped (::ffff:a.b.c.d) — judge by the embedded v4 address.
  const mapped = bare.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (mapped) return isBlockedIPv4(mapped[1])
  if (bare === '::' || bare === '::1') return true // unspecified + loopback
  const head = bare.split(':')[0]
  if (head.length === 4) {
    if (head.startsWith('fc') || head.startsWith('fd')) return true // ULA fc00::/7
    if (/^fe[89ab]/.test(head)) return true // link-local fe80::/10
    if (head.startsWith('ff')) return true // multicast ff00::/8
  }
  return false
}

/** True when connecting to this literal IP address must be refused. */
export function isBlockedAddress(ip: string): boolean {
  const version = isIP(ip)
  if (version === 4) return isBlockedIPv4(ip)
  if (version === 6) return isBlockedIPv6(ip)
  return true // not an IP at all — callers pass resolved addresses only
}

// Tiny TTL cache so the browser tool (one check per subresource request) and
// tight tool loops don't hammer the resolver. Verdicts only — 30s, capped.
const VERDICT_TTL_MS = 30_000
const VERDICT_MAX = 500
const verdicts = new Map<string, { error: string | null; at: number }>()

async function checkHostname(hostname: string): Promise<string | null> {
  const cached = verdicts.get(hostname)
  if (cached && Date.now() - cached.at < VERDICT_TTL_MS) return cached.error

  let error: string | null = null
  if (isIP(hostname)) {
    if (isBlockedAddress(hostname)) error = `IP address ${hostname} is not publicly routable`
  } else if (BLOCKED_HOSTNAMES.has(hostname) || BLOCKED_HOST_SUFFIXES.some((s) => hostname.endsWith(s))) {
    error = `hostname ${hostname} is internal-only`
  } else {
    try {
      const addrs = await lookup(hostname, { all: true, verbatim: true })
      const bad = addrs.find((a) => isBlockedAddress(a.address))
      if (bad) error = `hostname ${hostname} resolves to a non-public address (${bad.address})`
    } catch {
      error = `hostname ${hostname} could not be resolved`
    }
  }

  if (verdicts.size >= VERDICT_MAX) verdicts.clear()
  verdicts.set(hostname, { error, at: Date.now() })
  return error
}

/**
 * Throw BlockedUrlError unless `url` is an http(s) URL whose host is public.
 * Resolves DNS — a public-looking name pointed at a private IP is rejected.
 * Returns the parsed URL for convenience.
 */
export async function assertPublicUrl(url: string | URL): Promise<URL> {
  let u: URL
  try {
    u = typeof url === 'string' ? new URL(url) : url
  } catch {
    throw new BlockedUrlError(`invalid URL`)
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new BlockedUrlError(`only http(s) URLs are allowed (got ${u.protocol})`)
  }
  // URL.hostname keeps brackets around IPv6 literals; strip for checks.
  // A trailing dot ("example.com.") is the same name to DNS — normalize it
  // away so it can't dodge the suffix checks.
  const hostname = u.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase()
  if (!hostname) throw new BlockedUrlError('URL has no host')
  if (allowedByEnv(hostname)) return u
  const error = await checkHostname(hostname)
  if (error) throw new BlockedUrlError(`blocked for security: ${error}`)
  return u
}

const MAX_REDIRECTS = 5
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

/**
 * fetch() with the SSRF guard applied to the original URL AND every redirect
 * hop — a public site 302ing to http://169.254.169.254/ is the classic
 * second-order SSRF. Follows up to 5 redirects (mirroring fetch defaults'
 * spirit); pass a signal in `init` for timeouts as usual.
 */
export async function fetchPublicUrl(url: string | URL, init?: RequestInit): Promise<Response> {
  let current = await assertPublicUrl(url)
  let method = (init?.method || 'GET').toUpperCase()
  let body = init?.body

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await fetch(current, { ...init, method, body, redirect: 'manual' })
    if (!REDIRECT_STATUSES.has(res.status)) return res
    const location = res.headers.get('location')
    if (!location) return res
    await res.body?.cancel().catch(() => {})
    let next: URL
    try {
      next = new URL(location, current)
    } catch {
      throw new BlockedUrlError('redirect target is not a valid URL')
    }
    current = await assertPublicUrl(next)
    // Per fetch semantics: 303 (and 301/302 on POST) switch to GET, drop body.
    if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === 'POST')) {
      method = 'GET'
      body = undefined
    }
  }
  throw new BlockedUrlError(`too many redirects (>${MAX_REDIRECTS})`)
}
