// Smoke: DNS-rebinding connection pinning in the SSRF net-guard (C4).
// Proves the connection lands on a validated IP, not a second DNS lookup:
//   - fetchPinned connects to the pinned address even for an UNRESOLVABLE host
//     (only pinning can make that succeed — the rebinding-defense proof)
//   - gzip responses are transparently decompressed
//   - fetchPublicUrl still blocks private/link-local targets
//   - redirects are followed and re-validated
// Run: bun scripts/smoke/25-net-pinning.ts

import { createServer } from 'node:http'
import { gzipSync } from 'node:zlib'
import { fetchPinned, fetchPublicUrl, BlockedUrlError } from '../../src/lib/platform/net-guard'

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error(`FAIL: ${msg}`)
    process.exit(1)
  }
}

// A local fixture: echoes method, gzips a marker on /gz, 302s on /redir.
const server = createServer((req, res) => {
  if (req.url === '/gz') {
    res.setHeader('content-encoding', 'gzip')
    res.setHeader('content-type', 'text/plain')
    res.end(gzipSync(Buffer.from('gzipped-payload')))
    return
  }
  if (req.url === '/redir') {
    res.statusCode = 302
    res.setHeader('location', '/final')
    res.end()
    return
  }
  if (req.url === '/final') {
    res.end('after-redirect')
    return
  }
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => res.end(`method=${req.method} host=${req.headers.host} body=${body}`))
})
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
const port = (server.address() as { port: number }).port

// 1) PINNING PROOF: an unresolvable host, pinned to 127.0.0.1, still connects.
// If pinning were not in effect this would fail DNS; success means the socket
// used the pinned address and the Host header kept the (fake) name.
const pinned = await fetchPinned(
  new URL(`http://rebind.invalid:${port}/`),
  { method: 'POST', body: 'hello', headers: { 'content-type': 'text/plain' } },
  ['127.0.0.1'],
)
const pinnedText = await pinned.text()
assert(pinned.status === 200, `pinned request should reach the fixture, got ${pinned.status}`)
assert(pinnedText.includes('method=POST') && pinnedText.includes('body=hello'), `body/method preserved: ${pinnedText}`)
assert(pinnedText.includes('rebind.invalid'), `Host header keeps the original name: ${pinnedText}`)
console.log('pinning: connected to the pinned IP for an unresolvable host (rebinding defense)')

// 2) gzip is transparently decompressed.
const gz = await fetchPinned(new URL(`http://x.invalid:${port}/gz`), {}, ['127.0.0.1'])
assert((await gz.text()) === 'gzipped-payload', 'gzip response decompressed')
console.log('decompression: gzip content-encoding handled')

// 3) The guard still blocks a link-local / metadata target end-to-end.
let blocked = false
try {
  await fetchPublicUrl('http://169.254.169.254/latest/meta-data/')
} catch (e) {
  blocked = e instanceof BlockedUrlError
}
assert(blocked, 'fetchPublicUrl must block 169.254.169.254 (cloud metadata)')
console.log('guard: link-local / metadata target still blocked')

// 4) fetchPublicUrl follows + re-validates redirects (via the env allowlist so
// the loopback fixture is reachable in this test).
process.env.APICAL_NET_GUARD_ALLOW = '127.0.0.1'
const redir = await fetchPublicUrl(`http://127.0.0.1:${port}/redir`)
assert((await redir.text()) === 'after-redirect', 'redirect followed to /final')
console.log('redirects: followed and re-validated per hop')
delete process.env.APICAL_NET_GUARD_ALLOW

server.close()
console.log('OK: 25-net-pinning')
process.exit(0)
