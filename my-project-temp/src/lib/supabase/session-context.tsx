'use client'

// Drop-in replacement for next-auth's <SessionProvider> + useSession().
// Backed by GET /api/auth/session (which resolves Supabase session, PAT, or
// the dev bypass on the server) and Supabase's onAuthStateChange so the client
// stays in sync after sign-in / sign-out.

import * as React from 'react'
import { createClient } from '@/lib/supabase/client'

export type SessionUser = {
  id?: string
  userId?: string
  email?: string | null
  name?: string | null
  image?: string | null
  agentNameStyle?: string
}

export type Session = { user?: SessionUser; expires?: string } | null
export type SessionStatus = 'loading' | 'authenticated' | 'unauthenticated'

type SessionContextValue = {
  data: Session
  status: SessionStatus
  refresh: () => Promise<void>
}

const SessionContext = React.createContext<SessionContextValue | null>(null)

export function SupabaseSessionProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const [data, setData] = React.useState<Session>(null)
  const [status, setStatus] = React.useState<SessionStatus>('loading')

  const refresh = React.useCallback(async () => {
    try {
      const res = await fetch('/api/auth/session', { cache: 'no-store' })
      const json = await res.json().catch(() => ({}))
      if (json?.user?.email) {
        setData(json)
        setStatus('authenticated')
      } else {
        setData(null)
        setStatus('unauthenticated')
      }
    } catch {
      setData(null)
      setStatus('unauthenticated')
    }
  }, [])

  React.useEffect(() => {
    void refresh()
    const supabase = createClient()
    if (!supabase) return
    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      void refresh()
    })
    return () => sub.subscription.unsubscribe()
  }, [refresh])

  const value = React.useMemo(
    () => ({ data, status, refresh }),
    [data, status, refresh],
  )

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  )
}

/** Same shape as next-auth's useSession(): { data, status }. */
export function useSession(): { data: Session; status: SessionStatus } {
  const ctx = React.useContext(SessionContext)
  if (!ctx) return { data: null, status: 'loading' }
  return { data: ctx.data, status: ctx.status }
}

/** Refresh the cached session (call after sign-in / sign-out). */
export function useSessionRefresh(): () => Promise<void> {
  const ctx = React.useContext(SessionContext)
  return ctx?.refresh ?? (async () => {})
}
