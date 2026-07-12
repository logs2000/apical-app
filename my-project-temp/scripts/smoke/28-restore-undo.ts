// Smoke: restore/undo (Protection 2). Proves the mechanism end-to-end against
// real files + the real DB + object store, without needing an LLM:
//   - overwrite a file, then restore → prior content byte-identical
//   - the agent creates a new file, then restore → it's removed again
//   - move a file, then restore → back at the original path
//   - snapshot a directory (the gate-shell + snapshot path), delete files,
//     restore → deleted files come back
//   - a soft-deleted UserAsset is recovered by restore
// Run: bun scripts/smoke/28-restore-undo.ts

import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { db } from '../../src/lib/db'
import { openCheckpoint, captureBeforeWrite, captureBeforeMove, captureDirectory, restoreCheckpoint } from '../../src/lib/platform/restore'

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error(`FAIL: ${msg}`)
    process.exit(1)
  }
}

const now = Date.now()
const user = await db.user.upsert({
  where: { email: 'smoke-restore@apical.test' },
  create: { email: 'smoke-restore@apical.test', name: 'Smoke Restore' },
  update: {},
})
const dir = mkdtempSync(join(tmpdir(), 'apical-restore-'))

// 1) Overwrite → restore prior content.
const f1 = join(dir, 'report.txt')
writeFileSync(f1, 'ORIGINAL')
const cp1 = await openCheckpoint({ userId: user.id, now })
await captureBeforeWrite(cp1, f1) // agent is about to overwrite
writeFileSync(f1, 'CLOBBERED BY AGENT')
assert(readFileSync(f1, 'utf8') === 'CLOBBERED BY AGENT', 'precondition: file overwritten')
await restoreCheckpoint(cp1)
assert(readFileSync(f1, 'utf8') === 'ORIGINAL', `overwrite not undone: got ${readFileSync(f1, 'utf8')}`)
console.log('overwrite: restore brought back the original content')

// 2) Agent creates a new file → restore removes it.
const f2 = join(dir, 'new-by-agent.txt')
const cp2 = await openCheckpoint({ userId: user.id, now })
await captureBeforeWrite(cp2, f2) // did not exist before
writeFileSync(f2, 'created by agent')
assert(existsSync(f2), 'precondition: agent created the file')
await restoreCheckpoint(cp2)
assert(!existsSync(f2), 'restore should remove a file the agent created')
console.log('create: restore removed the agent-created file')

// 3) Move → restore back to origin.
const from = join(dir, 'src.txt')
const to = join(dir, 'moved.txt')
writeFileSync(from, 'MOVE ME')
const cp3 = await openCheckpoint({ userId: user.id, now })
await captureBeforeMove(cp3, from, to)
writeFileSync(to, readFileSync(from))
rmSync(from)
assert(existsSync(to) && !existsSync(from), 'precondition: moved')
await restoreCheckpoint(cp3)
assert(existsSync(from) && readFileSync(from, 'utf8') === 'MOVE ME', 'move not undone')
console.log('move: restore returned the file to its original path')

// 4) Directory snapshot (approved destructive shell) → restore deleted files.
const proj = join(dir, 'project')
mkdirSync(proj)
writeFileSync(join(proj, 'a.txt'), 'AAA')
writeFileSync(join(proj, 'b.txt'), 'BBB')
const cp4 = await openCheckpoint({ userId: user.id, now })
const captured = await captureDirectory(cp4, proj)
assert(captured, 'directory snapshot should fit the budget')
rmSync(join(proj, 'a.txt'))
rmSync(join(proj, 'b.txt'))
assert(!existsSync(join(proj, 'a.txt')), 'precondition: files deleted')
await restoreCheckpoint(cp4)
assert(readFileSync(join(proj, 'a.txt'), 'utf8') === 'AAA' && readFileSync(join(proj, 'b.txt'), 'utf8') === 'BBB', 'directory restore did not bring files back')
console.log('directory: restore recovered shell-deleted files from the snapshot')

// 5) Soft-deleted asset → restore recovers it.
const asset = await db.userAsset.create({
  data: { userId: user.id, name: 'r.bin', storageKey: 'x/r.bin', source: 'agent' },
})
const cp5 = await openCheckpoint({ userId: user.id, now: Date.now() })
await db.userAsset.update({ where: { id: asset.id }, data: { deletedAt: new Date() } })
const res = await restoreCheckpoint(cp5)
const after = await db.userAsset.findUnique({ where: { id: asset.id } })
assert(after?.deletedAt === null && res.assetsRecovered >= 1, 'soft-deleted asset not recovered')
console.log('asset: restore un-soft-deleted the agent-removed asset')

console.log('OK: 28-restore-undo')
process.exit(0)
