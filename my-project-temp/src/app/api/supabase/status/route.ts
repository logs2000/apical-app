import { NextResponse } from 'next/server'
import { isSupabaseConfigured, supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET() {
  const configured = isSupabaseConfigured()
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || null

  let connected = false

  if (configured && supabase) {
    try {
      // Quick health check — query a lightweight RPC or just check auth
      const { error } = await supabase.from('_supabase_health_check').select('*').limit(1)
      // If the table doesn't exist, that's still a successful connection
      // (error code 42P01 = undefined_table in Postgres, which means we ARE connected)
      connected = !error || error.code === '42P01' || error.code === '42P01' || error.message?.includes('does not exist')
    } catch {
      // If we get a network error, we're not connected
      connected = false
    }
  }

  return NextResponse.json({
    configured,
    connected,
    url,
  })
}
