'use client'

import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SessionProvider } from 'next-auth/react'
import { IS_TAURI, installTauriKeychain } from '@/lib/desktop/tauri-bridge'

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
    if (IS_TAURI) {
      installTauriKeychain()
    }
  }, [])

  return (
    <SessionProvider>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </SessionProvider>
  )
}
