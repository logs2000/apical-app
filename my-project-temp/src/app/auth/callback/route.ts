// OAuth / magic-link callback. Supabase redirects here with a `code` that we
// exchange for a session cookie, then forward the user to `next` (default /app).

import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/app'

  if (code) {
    const supabase = await createSupabaseServerClient()
    if (supabase) {
      const { error } = await supabase.auth.exchangeCodeForSession(code)
      if (error) {
        return NextResponse.redirect(
          `${origin}/login?error=${encodeURIComponent(error.message)}`,
        )
      }
    }
  }

  return NextResponse.redirect(`${origin}${next}`)
}
