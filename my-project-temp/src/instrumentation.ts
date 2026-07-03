// Next.js instrumentation hook — runs once per server boot.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  // Watched-folder triggers: poll granted folders and start workflow runs
  // when new files appear. No-ops per tick when the desktop is offline.
  const { ensureFolderWatcher } = await import('@/lib/platform/folder-watch')
  ensureFolderWatcher()
}
