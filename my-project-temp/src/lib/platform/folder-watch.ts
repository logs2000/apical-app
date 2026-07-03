/**
 * Watched-folder triggers: "new file appears in X → start workflow Y".
 *
 * Poll-based scanner. Every interval, each active WatchedFolder's directory
 * is listed (locally on desktop, or via the desktop bridge for hosted users
 * with an online desktop session) and diffed against the filenames from the
 * last scan. New files matching the optional pattern start a run with
 * `{ trigger: { newFiles, path, watchId } }` as the run input.
 *
 * The first scan only records a baseline — pre-existing files never trigger.
 * Paths are re-checked against granted roots on every scan, so revoking a
 * folder grant also disables its watches.
 */

import { db } from '@/lib/db'
import { desktopListDir } from '@/lib/desktop/desktop-fs'
import { checkPathsGranted } from './granted-folders'
import { startWorkflowRun } from './start-run'

const SCAN_INTERVAL_MS = 30_000

/** Folder watching reads WatchedFolder rows — requires a Postgres DATABASE_URL. */
function isPostgresDatabaseUrl(): boolean {
  const url = process.env.DATABASE_URL?.trim()
  return !!url && /^postgres(ql)?:\/\//.test(url)
}

/** Compile a simple glob ("*.pdf", "invoice-*") into a RegExp. */
export function compileWatchPattern(pattern: string): RegExp {
  const escaped = pattern
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*')
  return new RegExp(`^${escaped}$`, 'i')
}

interface ScanOutcome {
  watchId: string
  newFiles: string[]
  triggered: boolean
  error?: string
}

/** Scan a single watch row. Exported for the manual "scan now" endpoint. */
export async function scanWatchedFolder(watch: {
  id: string
  userId: string
  path: string
  pattern: string | null
  workflowId: string
  lastScanAt: Date | null
  knownFilesJson: string
}): Promise<ScanOutcome> {
  const granted = await checkPathsGranted(watch.userId, [watch.path])
  if (!granted.ok) {
    return { watchId: watch.id, newFiles: [], triggered: false, error: granted.error }
  }

  const listing = await desktopListDir(watch.userId, watch.path)
  if (!listing.ok) {
    // desktop_offline etc. — not an error state for the watch, just skip.
    return { watchId: watch.id, newFiles: [], triggered: false, error: listing.error }
  }

  const current = (listing.entries ?? [])
    .filter((e) => e.type === 'file')
    .map((e) => e.name)

  let known: string[] = []
  try {
    const parsed = JSON.parse(watch.knownFilesJson)
    if (Array.isArray(parsed)) known = parsed.filter((v) => typeof v === 'string')
  } catch {
    known = []
  }

  const isBaseline = watch.lastScanAt === null
  const knownSet = new Set(known)
  const matcher = watch.pattern ? compileWatchPattern(watch.pattern) : null
  const newFiles = isBaseline
    ? []
    : current.filter((name) => !knownSet.has(name) && (!matcher || matcher.test(name)))

  await db.watchedFolder.update({
    where: { id: watch.id },
    data: { lastScanAt: new Date(), knownFilesJson: JSON.stringify(current) },
  })

  if (newFiles.length === 0) {
    return { watchId: watch.id, newFiles: [], triggered: false }
  }

  const workflow = await db.workflow.findUnique({ where: { id: watch.workflowId } })
  if (!workflow) {
    // Workflow was deleted out from under the watch — pause it.
    await db.watchedFolder.update({
      where: { id: watch.id },
      data: { status: 'paused' },
    })
    return { watchId: watch.id, newFiles, triggered: false, error: 'workflow_deleted' }
  }

  try {
    await startWorkflowRun(workflow, {
      trigger: 'watch',
      actingUserId: watch.userId,
      triggerPayload: {
        watchId: watch.id,
        path: watch.path,
        newFiles: newFiles.map((name) => `${watch.path}/${name}`),
      },
    })
    return { watchId: watch.id, newFiles, triggered: true }
  } catch (err) {
    return {
      watchId: watch.id,
      newFiles,
      triggered: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

export async function scanAllWatchedFolders(): Promise<ScanOutcome[]> {
  if (!isPostgresDatabaseUrl()) return []
  const watches = await db.watchedFolder.findMany({ where: { status: 'active' } })
  const outcomes: ScanOutcome[] = []
  for (const watch of watches) {
    try {
      outcomes.push(await scanWatchedFolder(watch))
    } catch (err) {
      outcomes.push({
        watchId: watch.id,
        newFiles: [],
        triggered: false,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
  return outcomes
}

// ── Background loop ─────────────────────────────────────────────────────────

// The interval survives Next.js hot reloads via globalThis (dev) and is a
// process singleton in prod.
const globalRef = globalThis as { __apicalFolderWatcher?: NodeJS.Timeout }

let scanning = false

export function ensureFolderWatcher(): void {
  if (!isPostgresDatabaseUrl()) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn(
        '[folder-watch] disabled: DATABASE_URL must be postgresql:// (or postgres://). ' +
          'Set a Supabase pooler URL in .env.local for folder triggers.',
      )
    }
    return
  }
  if (globalRef.__apicalFolderWatcher) return
  globalRef.__apicalFolderWatcher = setInterval(() => {
    if (scanning) return // overlap lock: skip a tick rather than pile up
    scanning = true
    scanAllWatchedFolders()
      .catch((err) => console.error('[folder-watch] scan crashed:', err))
      .finally(() => {
        scanning = false
      })
  }, SCAN_INTERVAL_MS)
  // Don't keep the process alive just for the watcher.
  globalRef.__apicalFolderWatcher.unref?.()
}
