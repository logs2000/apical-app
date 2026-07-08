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
// DNS rebinding is closed by connection pinning: fetchPublicUrl resolves the
// host, validates every address, and then connects to one of those exact
// validated IPs (node:http/https with a pinned `lookup`). The socket never does
// a second resolution, so a resolver that flips a public record to a private
// one between the check and the connect cannot reach an internal address.
//
// Dev/test escape hatch: APICAL_NET_GUARD_ALLOW="host1,host2" exempts exact
// hostnames (e.g. "127.0.0.1" for a local fixture server). Never set it in
// production.

import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import type { Readable } from 'node:stream'
import { createGunzip, createInflate, createBrotliDecompress } from 'node:zlib'

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
// tight tool loops don't hammer the resolver. Stores the verdict AND the
// validated addresses, so the connection can be pinned to exactly what we
// checked. 30s, capped.
const VERDICT_TTL_MS = 30_000
const VERDICT_MAX = 500
const verdicts = new Map<string, { error: string | null; addresses: string[]; at: number }>()

// Resolve + validate a hostname, returning the verdict and — when it passes —
// the exact addresses it resolved to (for connection pinning). Rejecting when
// ANY resolved address is blocked keeps a mixed public/private record from
// slipping a private IP through.
async function resolveValidated(hostname: string): Promise<{ error: string | null; addresses: string[] }> {
  const cached = verdicts.get(hostname)
  if (cached && Date.now() - cached.at < VERDICT_TTL_MS) {
    return { error: cached.error, addresses: cached.addresses }
  }

  let error: string | null = null
  let addresses: string[] = []
  if (isIP(hostname)) {
    if (isBlockedAddress(hostname)) error = `IP address ${hostname} is not publicly routable`
    else addresses = [hostname]
  } else if (BLOCKED_HOSTNAMES.has(hostname) || BLOCKED_HOST_SUFFIXES.some((s) => hostname.endsWith(s))) {
    error = `hostname ${hostname} is internal-only`
  } else {
    try {
      const addrs = await lookup(hostname, { all: true, verbatim: true })
      const bad = addrs.find((a) => isBlockedAddress(a.address))
      if (bad) error = `hostname ${hostname} resolves to a non-public address (${bad.address})`
      else addresses = addrs.map((a) => a.address)
    } catch {
      error = `hostname ${hostname} could not be resolved`
    }
  }

  if (verdicts.size >= VERDICT_MAX) verdicts.clear()
  verdicts.set(hostname, { error, addresses, at: Date.now() })
  return { error, addresses }
}

async function checkHostname(hostname: string): Promise<string | null> {
  return (await resolveValidated(hostname)).error
}

// The addresses to pin the connection to for an already-validated host. For an
// env-allowlisted host (dev fixtures) we resolve without the block check so a
// local fixture on 127.0.0.1 still connects.
async function pinnedAddressesFor(hostname: string): Promise<string[]> {
  if (allowedByEnv(hostname)) {
    if (isIP(hostname)) return [hostname]
    try {
      return (await lookup(hostname, { all: true, verbatim: true })).map((a) => a.address)
    } catch {
      return []
    }
  }
  return (await resolveValidated(hostname)).addresses
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
// Cap the buffered response so a hostile endpoint can't OOM the process. The
// agent tools read the whole body anyway and enforce their own tighter caps.
const MAX_RESPONSE_BYTES = 25 * 1024 * 1024

function hostnameOf(u: URL): string {
  return u.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase()
}

/**
 * A single request that CONNECTS to one of `addresses` (validated IPs) while
 * keeping the original hostname for the Host header and TLS SNI — so DNS is not
 * consulted again and the socket lands on exactly what we validated. The body
 * is buffered (and transparently decompressed) into a web Response; redirects
 * are NOT followed here (fetchPublicUrl re-validates + re-pins each hop).
 */
export function fetchPinned(target: URL, init: RequestInit, addresses: string[]): Promise<Response> {
  const isHttps = target.protocol === 'https:'
  const requestFn = isHttps ? httpsRequest : httpRequest

  const pinnedLookup = (
    _host: string,
    opts: { all?: boolean } | ((e: Error | null, a: string, f: number) => void),
    maybeCb?: (e: Error | null, a: unknown, f?: number) => void,
  ) => {
    // Node calls lookup(host, cb) or lookup(host, opts, cb) depending on version.
    const cb = (typeof opts === 'function' ? opts : maybeCb) as (
      e: Error | null,
      a: unknown,
      f?: number,
    ) => void
    const all = typeof opts === 'object' && opts?.all
    if (!addresses.length) return cb(new Error('no pinned address'), null)
    if (all) cb(null, addresses.map((a) => ({ address: a, family: isIP(a) || 4 })))
    else cb(null, addresses[0], isIP(addresses[0]) || 4)
  }

  const headers: Record<string, string> = {}
  new Headers(init.headers).forEach((v, k) => {
    // Host is derived from the connection target; never let a caller pin it.
    if (k.toLowerCase() !== 'host') headers[k] = v
  })

  let bodyBuf: Buffer | undefined
  const b = init.body as unknown
  if (b != null && init.method && init.method.toUpperCase() !== 'GET' && init.method.toUpperCase() !== 'HEAD') {
    if (typeof b === 'string') bodyBuf = Buffer.from(b)
    else if (b instanceof Uint8Array) bodyBuf = Buffer.from(b)
    else if (b instanceof ArrayBuffer) bodyBuf = Buffer.from(new Uint8Array(b))
    else bodyBuf = Buffer.from(String(b))
    headers['content-length'] = String(bodyBuf.length)
  }

  return new Promise<Response>((resolve, reject) => {
    const req = requestFn(
      {
        protocol: target.protocol,
        host: target.hostname,
        servername: isHttps ? hostnameOf(target) : undefined,
        port: target.port ? Number(target.port) : isHttps ? 443 : 80,
        path: target.pathname + target.search,
        method: (init.method || 'GET').toUpperCase(),
        headers,
        lookup: pinnedLookup as never,
        signal: init.signal ?? undefined,
      },
      (res) => {
        const enc = String(res.headers['content-encoding'] || '').toLowerCase()
        let stream: Readable = res
        if (enc === 'gzip') stream = res.pipe(createGunzip())
        else if (enc === 'deflate') stream = res.pipe(createInflate())
        else if (enc === 'br') stream = res.pipe(createBrotliDecompress())

        const chunks: Buffer[] = []
        let total = 0
        stream.on('data', (c: Buffer) => {
          total += c.length
          if (total > MAX_RESPONSE_BYTES) {
            req.destroy(new BlockedUrlError('response exceeded the size cap'))
            return
          }
          chunks.push(c)
        })
        stream.on('end', () => {
          const respHeaders = new Headers()
          for (const [k, v] of Object.entries(res.headers)) {
            if (v == null) continue
            // These describe the on-the-wire body; we return it decoded.
            if (k === 'content-encoding' || k === 'content-length') continue
            respHeaders.set(k, Array.isArray(v) ? v.join(', ') : String(v))
          }
          resolve(
            new Response(total === 0 ? null : Buffer.concat(chunks), {
              status: res.statusCode || 200,
              statusText: res.statusMessage || '',
              headers: respHeaders,
            }),
          )
        })
        stream.on('error', reject)
      },
    )
    req.on('error', reject)
    if (bodyBuf) req.write(bodyBuf)
    req.end()
  })
}

/**
 * fetch() with the SSRF guard applied to the original URL AND every redirect
 * hop — a public site 302ing to http://169.254.169.254/ is the classic
 * second-order SSRF. The connection is pinned to a validated IP (DNS-rebinding
 * defense). Follows up to 5 redirects; pass a signal in `init` for timeouts.
 */
export async function fetchPublicUrl(url: string | URL, init?: RequestInit): Promise<Response> {
  let current = await assertPublicUrl(url)
  let method = (init?.method || 'GET').toUpperCase()
  let body = init?.body

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const addresses = await pinnedAddressesFor(hostnameOf(current))
    if (!addresses.length) {
      throw new BlockedUrlError(`could not resolve ${hostnameOf(current)} to a pinned address`)
    }
    const res = await fetchPinned(current, { ...init, method, body }, addresses)
    if (!REDIRECT_STATUSES.has(res.status)) return res
    const location = res.headers.get('location')
    if (!location) return res
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
