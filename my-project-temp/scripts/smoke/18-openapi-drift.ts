// Smoke: OpenAPI ↔ routes drift guard. The generated /v1 spec is only useful
// if it stays in sync with the code. This scans every src/app/v1/**/route.ts,
// derives its (method, path) operations, and asserts they exactly match the
// V1_ENDPOINTS manifest that buildOpenApiSpec() serves — so a route added or
// removed without updating the manifest fails the suite. Also sanity-checks
// the assembled document.
// Run: bun scripts/smoke/18-openapi-drift.ts

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { V1_ENDPOINTS, buildOpenApiSpec, type HttpMethod } from '../../src/lib/api/openapi'

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error(`FAIL: ${msg}`)
    process.exit(1)
  }
}

const V1_DIR = new URL('../../src/app/v1', import.meta.url).pathname
const METHODS: HttpMethod[] = ['GET', 'POST', 'PATCH', 'DELETE']

function walk(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (name === 'route.ts') out.push(full)
  }
  return out
}

// Derive the URL path from a route file path: strip to /v1/..., drop
// /route.ts, turn [x] into {x}.
function urlPathFor(file: string): string {
  const rel = file.slice(file.indexOf('/src/app/') + '/src/app'.length).replace(/\/route\.ts$/, '')
  return rel.replace(/\[([^\]]+)\]/g, '{$1}')
}

// Which HTTP methods a route file exports (const or function form).
function methodsIn(file: string): HttpMethod[] {
  const src = readFileSync(file, 'utf8')
  return METHODS.filter((m) =>
    new RegExp(`export\\s+(const|async\\s+function|function)\\s+${m}\\b`).test(src),
  )
}

// Build the set of operations that actually exist on disk.
const onDisk = new Set<string>()
for (const file of walk(V1_DIR)) {
  const path = urlPathFor(file)
  if (path === '/v1/openapi.json') continue // the spec endpoint documents itself, not listed
  for (const m of methodsIn(file)) onDisk.add(`${m} ${path}`)
}

const inManifest = new Set(V1_ENDPOINTS.map((e) => `${e.method} ${e.path}`))

// Every real operation must be documented...
const undocumented = [...onDisk].filter((op) => !inManifest.has(op))
assert(undocumented.length === 0, `undocumented /v1 operations (add to V1_ENDPOINTS): ${undocumented.join(', ')}`)
// ...and every documented operation must exist.
const phantom = [...inManifest].filter((op) => !onDisk.has(op))
assert(phantom.length === 0, `manifest lists operations with no route: ${phantom.join(', ')}`)
console.log(`drift: ${onDisk.size} /v1 operations on disk all documented, no phantoms`)

// Manifest hygiene: no duplicate entries.
assert(inManifest.size === V1_ENDPOINTS.length, 'duplicate entries in V1_ENDPOINTS')

// Assembled document sanity.
const spec = buildOpenApiSpec('https://api.example.com') as {
  openapi: string
  servers: Array<{ url: string }>
  paths: Record<string, Record<string, unknown>>
  components: { securitySchemes: Record<string, unknown>; schemas: Record<string, unknown> }
}
assert(spec.openapi === '3.1.0', 'openapi version')
assert(spec.servers[0].url === 'https://api.example.com', 'server url seeded from origin')
assert(Object.keys(spec.paths).length > 0, 'paths present')
assert(spec.components.securitySchemes.bearerAuth !== undefined, 'bearerAuth security scheme')
for (const s of ['Success', 'Error', 'Page']) assert(spec.components.schemas[s], `schema ${s} present`)
// A scoped operation advertises its scope; the public hook has empty security.
const runOp = spec.paths['/v1/workflows/{id}/run'].post as { security: Array<Record<string, string[]>> }
assert(runOp.security[0].bearerAuth[0] === 'runs:execute', 'run op advertises runs:execute scope')
const hookOp = spec.paths['/v1/hooks/w/{id}/{secret}'].post as { security: unknown[] }
assert(Array.isArray(hookOp.security) && hookOp.security.length === 0, 'public hook has empty security')
console.log('spec: OpenAPI 3.1 assembles with envelope schemas + per-op scopes')

console.log('OK: 18-openapi-drift')
process.exit(0)
