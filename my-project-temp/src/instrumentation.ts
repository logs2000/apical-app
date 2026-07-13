// Next.js instrumentation hook — runs once per server boot.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  // Cloud plane: plans/allowances, hosted LLM relay, run-event fan-out.
  // APICAL_EDITION=core skips this, leaving the open-core defaults
  // (unlimited local use, BYOK, no relay). See OPEN-CORE-SPLIT.md.
  if (process.env.APICAL_EDITION !== 'core') {
    const { registerCloudServices } = await import('@/lib/platform/cloud-registration')
    registerCloudServices()
  }

  // Watched-folder triggers: poll granted folders and start workflow runs
  // when new files appear. No-ops per tick when the desktop is offline.
  const { ensureFolderWatcher } = await import('@/lib/platform/folder-watch')
  ensureFolderWatcher()

  // Bundled desktop: reconnect the bridge client if cloud-link.json exists
  // (so scheduled runs can reach this machine before the webview loads) and
  // start the in-process local scheduler so recurring workflows fire while the
  // app runs in the background — and resume after a reboot via autostart.
  if (process.env.DESKTOP_LOCAL === 'true') {
    const { readCloudLink } = await import('@/lib/desktop/desktop-paths')
    const { currentDeploymentMode } = await import('@/lib/desktop/desktop-policy')
    const { startBridgeClient } = await import('@/lib/desktop/bridge-client')
    const link = readCloudLink()
    if (link && currentDeploymentMode() !== 'local_only') {
      void startBridgeClient(link).catch((err) => {
        console.error('[instrumentation] bridge client start failed:', err)
      })
    }

    const { ensureLocalScheduler } = await import('@/lib/platform/local-scheduler')
    ensureLocalScheduler()
  }
}
