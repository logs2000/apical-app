/// <reference types="bun-types" />
// Unit: net-guard address classification (the core SSRF decision). Exhaustive
// range table — the kind of edge-case coverage smoke tests don't enumerate.
import { test, expect, describe } from 'bun:test'
import { isBlockedAddress } from '../../src/lib/platform/net-guard'

describe('isBlockedAddress — IPv4', () => {
  const blocked = [
    '0.0.0.0', // this-network
    '10.0.0.1', // RFC1918
    '10.255.255.255',
    '100.64.0.1', // CGNAT
    '100.127.255.255',
    '127.0.0.1', // loopback
    '169.254.169.254', // cloud metadata / link-local
    '172.16.0.1', // RFC1918
    '172.31.255.255',
    '192.168.1.1', // RFC1918
    '192.0.0.1', // IETF protocol assignments
    '198.18.0.1', // benchmarking
    '224.0.0.1', // multicast
    '255.255.255.255', // broadcast
  ]
  for (const ip of blocked) {
    test(`blocks ${ip}`, () => expect(isBlockedAddress(ip)).toBe(true))
  }

  const allowed = ['1.1.1.1', '8.8.8.8', '93.184.216.34', '172.15.255.255', '172.32.0.1', '11.0.0.1', '100.63.255.255', '100.128.0.1']
  for (const ip of allowed) {
    test(`allows public ${ip}`, () => expect(isBlockedAddress(ip)).toBe(false))
  }
})

describe('isBlockedAddress — IPv6', () => {
  const blocked = [
    '::1', // loopback
    '::', // unspecified
    'fc00::1', // ULA
    'fd12:3456::1', // ULA
    'fe80::1', // link-local
    'ff02::1', // multicast
    '::ffff:169.254.169.254', // v4-mapped metadata
    '::ffff:10.0.0.1', // v4-mapped RFC1918
  ]
  for (const ip of blocked) {
    test(`blocks ${ip}`, () => expect(isBlockedAddress(ip)).toBe(true))
  }

  test('allows a public v6 address', () => expect(isBlockedAddress('2606:4700:4700::1111')).toBe(false))
  test('allows a v4-mapped public address', () => expect(isBlockedAddress('::ffff:8.8.8.8')).toBe(false))
})

describe('isBlockedAddress — non-addresses', () => {
  // A hostname is never a literal address; callers must resolve first.
  for (const v of ['example.com', 'not-an-ip', '', '999.999.999.999']) {
    test(`rejects non-IP ${JSON.stringify(v)}`, () => expect(isBlockedAddress(v)).toBe(true))
  }
})
