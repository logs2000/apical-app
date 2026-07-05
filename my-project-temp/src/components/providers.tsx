'use client'

import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SupabaseSessionProvider } from '@/lib/supabase/session-context'
import { IS_TAURI, installTauriKeychain } from '@/lib/desktop/tauri-bridge'
import { TauriShellMarker } from '@/components/desktop/tauri-shell-marker'
import { DesktopTraySync } from '@/components/desktop/desktop-tray-sync'

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = React.useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      }),
  )

  // When running inside the Tauri desktop shell, install the OS-keychain
  // backend so F2 (the vault) prefers the OS keychain over AES-256-GCM
  // local storage. In hosted mode this is a no-op.
  React.useEffect(() => {
    if (!IS_TAURI) return
    installTauriKeychain()
    // Launch-at-login on by default (first run only) so scheduled workflows
    // keep running across reboots. Respects a later manual opt-out.
    void (async () => {
      try {
        const { ensureAutostartDefault } = await import('@/lib/desktop/tauri-bridge')
        await ensureAutostartDefault()
      } catch {
        /* ignore */
      }
    })()
    // Re-sync the stored cloud token to the local server so the desktop
    // bridge reconnects after an app restart (the Node process cannot read
    // the OS keychain — only the webview can). No-op when not linked.
    void (async () => {
      try {
        const { resyncCloudLinkAtBoot } = await import('@/lib/desktop/device-flow')
        const cloudUrl =
          process.env.NEXT_PUBLIC_APICAL_CLOUD_URL?.trim() || 'https://api.apic.al'
        await resyncCloudLinkAtBoot(cloudUrl)
      } catch {
        /* ignore */
      }
    })()
  }, [])

  return (
    <SupabaseSessionProvider>
      <QueryClientProvider client={client}>
        <TauriShellMarker />
        <DesktopTraySync />
        {children}
      </QueryClientProvider>
    </SupabaseSessionProvider>
  )
}
