// Smoke: Cursor-style remote CLI policy. RemoteAccessPolicy.cli went from an
// all-or-nothing boolean to { mode: 'off'|'allowlist'|'always', allow[] }.
// Proves: legacy settings files still parse (true→always, false→off), the
// allowlist matches the invoked program (basename, case-insensitive) and
// denies script jobs, and the on-disk chokepoint (evaluateRemoteInvoke via
// APICAL_DESKTOP_DATA_DIR) enforces all of it end-to-end.
// Run: bun scripts/smoke/14-cli-policy.ts

import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  mergeDesktopSettings,
  checkRemoteToolAllowed,
  effectiveRemoteCapabilities,
  DEFAULT_DESKTOP_SETTINGS,
  type RemoteAccessPolicy,
} from '../../src/lib/desktop/desktop-settings'

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error(`FAIL: ${msg}`)
    process.exit(1)
  }
}

// 1) Merge back-compat + validation.
assert(DEFAULT_DESKTOP_SETTINGS.remote.cli.mode === 'off', 'default cli mode must be off')
const legacyOn = mergeDesktopSettings({ remote: { cli: true } })
assert(legacyOn.remote.cli.mode === 'always', 'legacy cli:true must merge to always')
const legacyOff = mergeDesktopSettings({ remote: { cli: false } })
assert(legacyOff.remote.cli.mode === 'off', 'legacy cli:false must merge to off')
const modern = mergeDesktopSettings({ remote: { cli: { mode: 'allowlist', allow: ['git', ' npm ', 7, ''] } } })
assert(modern.remote.cli.mode === 'allowlist', 'object cli policy must merge')
assert(JSON.stringify(modern.remote.cli.allow) === JSON.stringify(['git', 'npm']), `allow list not sanitized: ${JSON.stringify(modern.remote.cli.allow)}`)
const garbage = mergeDesktopSettings({ remote: { cli: { mode: 'sudo-everything', allow: 'git' } } })
assert(garbage.remote.cli.mode === 'off' && garbage.remote.cli.allow.length === 0, 'garbage cli policy must fail closed to off')
console.log('merge: legacy boolean + object forms coerce correctly, garbage fails closed')

// 2) Capability advertisement.
assert(!effectiveRemoteCapabilities(legacyOff.remote).includes('cli'), 'off must not advertise cli')
assert(effectiveRemoteCapabilities(modern.remote).includes('cli'), 'allowlist must advertise cli')
assert(effectiveRemoteCapabilities(legacyOn.remote).includes('cli'), 'always must advertise cli')

// 3) checkRemoteToolAllowed matrix.
const off: RemoteAccessPolicy = { fs: 'off', cli: { mode: 'off', allow: [] }, net: false, notify: true }
const always: RemoteAccessPolicy = { fs: 'off', cli: { mode: 'always', allow: [] }, net: false, notify: true }
const allowlist: RemoteAccessPolicy = { fs: 'off', cli: { mode: 'allowlist', allow: ['git', '/usr/bin/Python3'] }, net: false, notify: true }

assert(checkRemoteToolAllowed('desktop.cli.run', off, { cmd: 'git status' }) === 'remote_access_denied:cli', 'off must deny')
assert(checkRemoteToolAllowed('desktop.cli.run', always, { cmd: 'rm -rf /' }) === null, 'always must allow')
assert(checkRemoteToolAllowed('desktop.cli.run', allowlist, { cmd: 'git status' }) === null, 'allowlisted program must be allowed')
assert(checkRemoteToolAllowed('desktop.cli.run', allowlist, { cmd: '/usr/local/bin/GIT pull' }) === null, 'path + case-insensitive match must be allowed')
assert(checkRemoteToolAllowed('desktop.cli.run', allowlist, { cmd: 'python3 -c "print(1)"' }) === null, 'allow entries with paths must match by basename')
assert(checkRemoteToolAllowed('desktop.cli.run', allowlist, { cmd: 'curl http://evil' }) === 'remote_access_denied:cli_allowlist', 'unlisted program must be denied')
assert(checkRemoteToolAllowed('desktop.cli.run', allowlist, {}) === 'remote_access_denied:cli_allowlist', 'no matchable command (script job) must be denied in allowlist mode')
// Secrets stay hard-denied regardless of cli policy.
assert(checkRemoteToolAllowed('desktop.secrets.get', always, {}) === 'remote_access_denied:secrets', 'secrets must never be allowed remotely')
console.log('policy: off/always/allowlist matrix + script-job denial + secrets hard-deny')

// 3b) 'ask' tier: the bridge lets the invoke through (the engine's enforced
// destructive-action gate secures approval upstream), and it coerces + maps
// to the engine's 'ask' approval tier.
const ask = mergeDesktopSettings({ remote: { cli: { mode: 'ask', allow: [] } } })
assert(ask.remote.cli.mode === 'ask', "'ask' mode must coerce")
const askPolicy: RemoteAccessPolicy = { fs: 'off', cli: { mode: 'ask', allow: [] }, net: false, notify: true }
assert(checkRemoteToolAllowed('desktop.cli.run', askPolicy, { cmd: 'rm -rf /' }) === null, "'ask' lets the invoke reach the desktop (engine already gated)")
const { approvalTierFromCli } = await import('../../src/lib/desktop/desktop-settings')
assert(approvalTierFromCli('ask') === 'ask' && approvalTierFromCli('allowlist') === 'allowlist' && approvalTierFromCli('always') === 'always' && approvalTierFromCli('off') === 'ask', 'cli mode maps to the engine approval tier')
console.log("policy: 'ask' tier coerces, passes the bridge, and maps to the engine approval tier")

// 4) End-to-end through the on-disk chokepoint the bridge-client uses.
const dir = mkdtempSync(join(tmpdir(), 'apical-cli-policy-'))
writeFileSync(
  join(dir, 'desktop-settings.json'),
  JSON.stringify({ remote: { fs: 'off', cli: { mode: 'allowlist', allow: ['git'] }, net: false, notify: true } }),
)
process.env.APICAL_DESKTOP_DATA_DIR = dir
const { evaluateRemoteInvoke } = await import('../../src/lib/desktop/desktop-policy')

const gitOk = evaluateRemoteInvoke('desktop.cli.run', { cmd: 'git log -1' })
assert(gitOk.allowed, `git should be allowed via disk policy: ${gitOk.error}`)
const curlNo = evaluateRemoteInvoke('desktop.cli.run', { cmd: 'curl http://evil' })
assert(!curlNo.allowed && curlNo.error === 'remote_access_denied:cli_allowlist', `curl should be denied: ${curlNo.error}`)
const jobNo = evaluateRemoteInvoke('desktop.cli.run', { jobId: 'j1', language: 'shell', source: 'echo hi' })
assert(!jobNo.allowed && jobNo.error === 'remote_access_denied:cli_allowlist', `script job should be denied in allowlist mode: ${jobNo.error}`)

// Legacy boolean file on disk: cli:true still behaves as 'always'.
writeFileSync(
  join(dir, 'desktop-settings.json'),
  JSON.stringify({ remote: { fs: 'off', cli: true, net: false, notify: true } }),
)
const legacyDisk = evaluateRemoteInvoke('desktop.cli.run', { cmd: 'anything at-all' })
assert(legacyDisk.allowed, `legacy cli:true on disk should still allow: ${legacyDisk.error}`)
console.log('disk: evaluateRemoteInvoke enforces allowlist + legacy files keep working')

console.log('OK: 14-cli-policy')
process.exit(0)
