import { describe, expect, test } from 'bun:test'
import { assertPublicUrl, isBlockedAddress } from './net-guard'

// The agent picks these URLs. Without the guard, http_request / web_read /
// doc_extract run from OUR network and can reach cloud metadata, the database,
// and anything on localhost. Each case below is a documented bypass.

describe('isBlockedAddress', () => {
  test.each([
    ['169.254.169.254', 'cloud metadata'],
    ['127.0.0.1', 'loopback'],
    ['0.0.0.0', 'unspecified'],
    ['10.1.2.3', 'RFC1918 10/8'],
    ['172.16.0.1', 'RFC1918 172.16/12'],
    ['192.168.0.5', 'RFC1918 192.168/16'],
    ['100.64.0.1', 'CGNAT'],
    ['198.18.0.1', 'benchmarking'],
    ['224.0.0.1', 'multicast'],
    ['::1', 'IPv6 loopback'],
    ['fc00::1', 'IPv6 ULA'],
    ['fe80::1', 'IPv6 link-local'],
    ['::ffff:127.0.0.1', 'IPv4-mapped IPv6 loopback'],
    ['::ffff:169.254.169.254', 'IPv4-mapped IPv6 metadata'],
  ])('blocks %s (%s)', (ip) => {
    expect(isBlockedAddress(ip)).toBe(true)
  })

  test.each([['8.8.8.8'], ['1.1.1.1'], ['93.184.216.34'], ['2606:4700:4700::1111']])(
    'allows public %s',
    (ip) => {
      expect(isBlockedAddress(ip)).toBe(false)
    },
  )
})

describe('assertPublicUrl', () => {
  test.each([
    ['http://169.254.169.254/latest/meta-data/', 'metadata IP'],
    ['http://127.0.0.1:3000/x', 'loopback'],
    ['http://localhost:3000/x', 'localhost hostname'],
    ['http://db.internal/x', '.internal suffix'],
    ['http://thing.local/x', '.local suffix'],
    ['https://metadata.google.internal/x', 'GCP metadata hostname'],
    // The WHATWG parser normalizes these to 127.0.0.1 before we check.
    ['http://0x7f000001/', 'hex IPv4'],
    ['http://2130706433/', 'decimal IPv4'],
    ['http://017700000001/', 'octal IPv4'],
  ])('rejects %s (%s)', async (url) => {
    await expect(assertPublicUrl(url)).rejects.toThrow()
  })

  test.each([['file:///etc/passwd'], ['gopher://x/'], ['ftp://x/']])(
    'rejects non-http scheme %s',
    async (url) => {
      await expect(assertPublicUrl(url)).rejects.toThrow('http(s)')
    },
  )

  test('allows a public https URL', async () => {
    await expect(assertPublicUrl('https://example.com/')).resolves.toBeDefined()
  })
})
