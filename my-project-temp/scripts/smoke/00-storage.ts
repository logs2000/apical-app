// Smoke: storage round-trip (Supabase when configured, local fallback otherwise).
// Run: bun scripts/smoke/00-storage.ts

import { putObject, getObject, getSignedUrl, deleteObject, objectStoreEnabled } from '../../src/lib/platform/storage'

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error(`FAIL: ${msg}`)
    process.exit(1)
  }
}

const key = `smoke/${Date.now()}/hello.txt`
const payload = Buffer.from(`storage smoke ${new Date().toISOString()}`)

const storageKey = await putObject(key, payload, 'text/plain')
console.log(`backend=${objectStoreEnabled() ? 'supabase' : 'local'} storageKey=${storageKey}`)

const back = await getObject(storageKey)
assert(back && back.equals(payload), 'round-trip bytes mismatch')

if (storageKey.startsWith('sb:')) {
  const url = await getSignedUrl(storageKey, 60)
  assert(url && url.startsWith('http'), 'signed url missing for sb: key')
} else {
  assert((await getSignedUrl(storageKey)) === null, 'local keys must not return signed urls')
}

await deleteObject(storageKey)
assert((await getObject(storageKey)) === null, 'object still readable after delete')

console.log('OK: 00-storage')
