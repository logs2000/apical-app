// Smoke: script-runner sandbox hardening (C1). Untrusted agent code runs under
// resource limits and in its own process group, so a runaway can't fork-bomb,
// write unbounded files, or orphan subprocesses past a timeout.
//   - a hardened run enforces a file-size rlimit (when prlimit is available)
//   - a timeout kills the WHOLE process group, not just the direct child
// Run: bun scripts/smoke/27-sandbox-hardening.ts

import { existsSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error(`FAIL: ${msg}`)
    process.exit(1)
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// Limits are read at module load, so set a tiny file-size cap BEFORE importing.
process.env.APICAL_SANDBOX_FSIZE_BYTES = String(1024 * 1024) // 1MB
const { runNodeScript } = await import('../../src/lib/platform/script-runner')

const havePrlimit = ['/usr/bin/prlimit', '/bin/prlimit', '/sbin/prlimit'].some((p) => existsSync(p))

// 1) File-size rlimit: writing 8MB under a 1MB cap must fail (SIGXFSZ).
if (havePrlimit) {
  const big = await runNodeScript(
    `require('fs').writeFileSync(require('path').join(process.cwd(),'big.bin'), Buffer.alloc(8*1024*1024)); console.log('WROTE')`,
  )
  assert(!big.ok, 'writing past the file-size rlimit should fail')
  assert(!/WROTE/.test(big.stdout), 'the oversized write must not complete')
  console.log('rlimit: an 8MB write is blocked by the 1MB file-size cap')
} else {
  console.log('rlimit: SKIPPED (prlimit not installed on this host)')
}

// 2) A hung script that spawns a subprocess: the timeout must kill the whole
// group, so the grandchild stops writing its heartbeat.
const marker = path.join(tmpdir(), `c1-gc-${process.pid}-${Date.now()}`)
// Parent spawns a grandchild that heartbeats to `marker` (passed as argv[1] to
// avoid nested-quote escaping), then the parent hangs until it's killed.
const grandchild =
  'const fs=require("fs");const m=process.argv[1];setInterval(()=>fs.writeFileSync(m,String(Date.now())),100);setTimeout(()=>{},1e9)'
const code =
  `const {spawn}=require('child_process');` +
  `const M=${JSON.stringify(marker)};` +
  `spawn(process.execPath,['-e',${JSON.stringify(grandchild)},M],{stdio:'ignore'});` +
  `setTimeout(()=>{},1e9);`
const res = await runNodeScript(code, [], { timeoutMs: 1500 })
assert(!res.ok && /Timed out/.test(res.error || ''), `hung script should time out, got ${JSON.stringify(res.error)}`)
await sleep(400)
const a = existsSync(marker) ? readFileSync(marker, 'utf8') : ''
await sleep(700)
const b = existsSync(marker) ? readFileSync(marker, 'utf8') : ''
assert(a === b, `grandchild kept writing after the timeout — process group not killed (a=${a} b=${b})`)
console.log('process-group: a timeout kills the whole tree, not just the direct child')

console.log('OK: 27-sandbox-hardening')
process.exit(0)
