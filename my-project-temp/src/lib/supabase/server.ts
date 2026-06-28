// Server-side Supabase client (for Route Handlers and Server Components).
// Reads/writes the auth cookies via next/headers. Returns null when Supabase
// env vars are absent so server auth can fall through to PAT / dev bypass.

import { createServerClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

export async function createSupabaseServerClient(): Promise<SupabaseClient | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) return null

  const cookieStore = await cookies()

  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        // In Server Components the cookie store is read-only; the middleware
        // refreshes the session instead, so swallow the error here.
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          )
        } catch {
          /* called from a Server Component — safe to ignore */
        }
      },
    },
  })
}
