// Smoke: SSRF guard. Proves agent-reachable fetch paths (web_read,
// http_request, image_read, browser navigate) refuse loopback/RFC1918/
// link-local/ULA/cloud-metadata targets, and that redirects to blocked
// hosts are caught mid-flight.
// Run: bun scripts/smoke/09-net-guard.ts

import { assertPublicUrl, fetchPublicUrl, isBlockedAddress, BlockedUrlError } from '../../src/lib/platform/net-guard'
import { AGENT_TOOLS, type ToolContext } from '../../src/lib/platform/agent-tools'
import { normalizeImage } from '../../src/lib/platform/images'

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error(`FAIL: ${msg}`)
    process.exit(1)
  }
}

async function rejects(url: string): Promise<string> {
  try {
    await assertPublicUrl(url)
  } catch (e) {
    if (e instanceof BlockedUrlError) return e.message
    throw e
  }
  console.error(`FAIL: assertPublicUrl allowed ${url}`)
  process.exit(1)
}

// 1. Blocked address classifier — v4, v6, mapped, exotic.
for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.0.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '255.255.255.255', '224.0.0.1', '::1', '::', 'fd12::1', 'fc00::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1'])
  assert(isBlockedAddress(ip), `${ip} should be blocked`)
for (const ip of ['1.1.1.1', '8.8.8.8', '93.184.216.34', '172.32.0.1', '2606:4700:4700::1111'])
  assert(!isBlockedAddress(ip), `${ip} should be allowed`)
console.log('address classifier: private/link-local/ULA/metadata blocked, public allowed')

// 2. assertPublicUrl — literal IPs, hostnames, schemes.
await rejects('http://127.0.0.1/admin')
await rejects('http://localhost:3000/')
await rejects('http://sub.localhost/')
await rejects('http://169.254.169.254/latest/meta-data/')
await rejects('http://[::1]:8080/')
await rejects('http://[fd00::1]/')
await rejects('http://10.0.0.5:5432/')
await rejects('http://metadata.google.internal/computeMetadata/v1/')
await rejects('http://foo.internal/')
await rejects('http://printer.local/')
await rejects('file:///etc/passwd')
await rejects('gopher://example.com/')
// WHATWG URL normalizes exotic IPv4 spellings before our checks see them.
await rejects('http://0x7f000001/')
await rejects('http://2130706433/')
await rejects('http://017700000001/')
// Trailing dot must not dodge suffix checks.
await rejects('http://metadata.google.internal./')
// Unresolvable host fails closed.
const unresolvable = await rejects('http://definitely-not-a-real-host-zq9x8.example/')
assert(/resolved/.test(unresolvable), `unresolvable host error unexpected: ${unresolvable}`)
console.log('assertPublicUrl: loopback/private/metadata/schemes/exotic-IPv4 all rejected')

// 3. Redirect revalidation. A local fixture server (allowlisted via
// APICAL_NET_GUARD_ALLOW) redirects to the metadata IP — the hop must throw.
process.env.APICAL_NET_GUARD_ALLOW = '127.0.0.1'
const { createServer } = await import('node:http')
const fixture = createServer((req, res) => {
  const p = new URL(req.url ?? '/', 'http://127.0.0.1').pathname
  if (p === '/to-metadata') {
    res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' }).end()
  } else if (p === '/to-ok') {
    res.writeHead(302, { location: `http://127.0.0.1:${fixturePort()}/ok` }).end()
  } else if (p === '/ok') {
    res.writeHead(200).end('made it')
  } else {
    res.writeHead(404).end('nope')
  }
})
await new Promise<void>((resolve) => fixture.listen(0, '127.0.0.1', resolve))
const fixturePort = () => (fixture.address() as { port: number }).port
const base = `http://127.0.0.1:${fixturePort()}`

let redirectBlocked = false
try {
  await fetchPublicUrl(`${base}/to-metadata`)
} catch (e) {
  redirectBlocked = e instanceof BlockedUrlError
}
assert(redirectBlocked, 'redirect to metadata IP should be blocked')

const followed = await fetchPublicUrl(`${base}/to-ok`)
assert(followed.ok && (await followed.text()) === 'made it', 'allowed redirect should be followed')
console.log('fetchPublicUrl: blocked-host redirect rejected, allowed redirect followed')

// Allowlist off again — the fixture host itself must now be refused.
delete process.env.APICAL_NET_GUARD_ALLOW
let fixtureBlocked = false
try {
  await fetchPublicUrl(`${base}/ok`)
} catch (e) {
  fixtureBlocked = e instanceof BlockedUrlError
}
assert(fixtureBlocked, 'without allowlist, 127.0.0.1 fixture must be blocked')
fixture.close()

// 4. Tool level: web_read + http_request refuse internal targets.
const ctx: ToolContext = { userId: 'smoke-net-guard', allowCli: false, maxFetchBytes: 100_000 }
const webRead = AGENT_TOOLS.find((t) => t.name === 'web_read')!
const httpRequest = AGENT_TOOLS.find((t) => t.name === 'http_request')!
const wr = await webRead.run({ url: 'http://169.254.169.254/latest/meta-data/' }, ctx)
assert(!wr.ok && /blocked|not publicly/i.test(wr.error ?? ''), `web_read should refuse metadata IP: ${wr.error}`)
const hr = await httpRequest.run({ url: 'http://127.0.0.1:5433/' }, ctx)
assert(!hr.ok && /blocked|not publicly/i.test(hr.error ?? ''), `http_request should refuse loopback: ${hr.error}`)
console.log('tools: web_read + http_request refuse internal targets')

// 5. image_read path: normalizeImage(url) refuses internal hosts, data: still fine.
let imgBlocked = false
try {
  await normalizeImage({ url: 'http://192.168.1.1/logo.png' })
} catch (e) {
  imgBlocked = e instanceof BlockedUrlError
}
assert(imgBlocked, 'normalizeImage should refuse RFC1918 url')
console.log('images: fetchUrlBytes refuses internal hosts')

// 6. Browser tool: navigate to an internal host throws; data: URLs unaffected.
const { createSession, act, closeSession } = await import('../../mini-services/agent-worker/browser')
const { sessionId } = await createSession('smoke-net-guard')
let navBlocked = false
try {
  await act(sessionId, { action: 'navigate', url: 'http://169.254.169.254/latest/meta-data/' })
} catch (e) {
  navBlocked = /blocked/i.test((e as Error).message)
}
assert(navBlocked, 'browser navigate to metadata IP should be blocked')
const dataNav = await act(sessionId, {
  action: 'navigate',
  url: 'data:text/html,' + encodeURIComponent('<h1>guard smoke</h1>'),
})
assert(dataNav.domSummary.includes('guard smoke'), 'data: navigation should still work')
await closeSession(sessionId)
console.log('browser: internal navigate blocked, data: URLs unaffected')

console.log('OK: 09-net-guard')
process.exit(0)
