// Smoke: Playwright browser surface on the agent-worker. Boots the worker's
// browser session manager in-process (no HTTP), navigates, screenshots, and
// checks session teardown. Verifies Chromium launches under bun.
// Run: bun scripts/smoke/04-browser.ts

import { createSession, act, closeSession, sessionCount } from '../../mini-services/agent-worker/browser'

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error(`FAIL: ${msg}`)
    process.exit(1)
  }
}

const { sessionId } = await createSession('smoke-user')
assert(sessionId.startsWith('br_'), 'session id malformed')
assert(sessionCount() === 1, 'session not tracked')

// Navigate to a data: URL (no network needed) and read it back.
const html = 'data:text/html,' + encodeURIComponent('<h1>Bobsled Track</h1><p>Lake Placid</p><a href="https://example.com">more</a>')
const nav = await act(sessionId, { action: 'navigate', url: html })
assert(nav.domSummary.includes('Bobsled Track'), 'heading not in dom summary')
assert(nav.domSummary.includes('Lake Placid'), 'text not in dom summary')
assert(nav.screenshotB64 && nav.screenshotB64.length > 0, 'no screenshot returned')
assert(true, "ok")
console.log(`navigate: title="${nav.title}" screenshot=${nav.screenshotB64!.length} b64 chars`)

// A pure screenshot action re-summarizes the same page.
const shot = await act(sessionId, { action: 'screenshot' })
assert(shot.screenshotB64 && shot.screenshotB64.length > 0, 'screenshot action produced no image')

// Scroll works without throwing.
await act(sessionId, { action: 'scroll', deltaY: 300 })

// Teardown.
await closeSession(sessionId)
assert(sessionCount() === 0, 'session not cleaned up')

// Acting on a closed session errors clearly.
let threw = false
try {
  await act(sessionId, { action: 'screenshot' })
} catch (e) {
  threw = /not found|idled/.test((e as Error).message)
}
assert(threw, 'acting on a closed session should error')

console.log('OK: 04-browser')
process.exit(0)
