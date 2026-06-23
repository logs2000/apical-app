import { NextRequest, NextResponse } from 'next/server'
import { isSupabaseConfigured, getSupabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

interface MigrateRequest {
  tables: string[]
}

// Map of table names to their CREATE TABLE SQL (idempotent)
const TABLE_SQL: Record<string, string> = {
  users: `
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      name TEXT,
      email_verified TIMESTAMPTZ,
      image TEXT,
      password_hash TEXT,
      provider TEXT DEFAULT 'credentials',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );`,

  agents: `
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      steps_json TEXT DEFAULT '[]',
      trigger TEXT DEFAULT 'manual',
      schedule TEXT,
      status TEXT DEFAULT 'active',
      department TEXT DEFAULT 'General',
      title TEXT,
      workspace_id TEXT,
      runtime TEXT DEFAULT 'hosted',
      parent_agent_id TEXT,
      runs_count INT DEFAULT 0,
      items_processed INT DEFAULT 0,
      automatic_count INT DEFAULT 0,
      flagged_count INT DEFAULT 0,
      ai_calls_saved INT DEFAULT 0,
      est_cost_saved_cents INT DEFAULT 0,
      origin TEXT DEFAULT 'agent',
      model_preference TEXT,
      confidence_threshold REAL,
      auto_harden_after INT,
      allowed_tools_json TEXT,
      allowed_credentials_json TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );`,

  connectors: `
    CREATE TABLE IF NOT EXISTS connectors (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      description TEXT DEFAULT '',
      config TEXT DEFAULT '{}',
      tools TEXT DEFAULT '[]',
      status TEXT DEFAULT 'connected',
      category TEXT DEFAULT 'general',
      color TEXT DEFAULT 'emerald',
      source TEXT DEFAULT 'builtin',
      visibility TEXT DEFAULT 'private',
      author_label TEXT,
      installs INT DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );`,

  credentials: `
    CREATE TABLE IF NOT EXISTS credentials (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      label TEXT NOT NULL,
      service TEXT NOT NULL,
      encrypted_data TEXT NOT NULL,
      iv TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );`,

  integration_sessions: `
    CREATE TABLE IF NOT EXISTS integration_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      access_token TEXT,
      refresh_token TEXT,
      expires_at TIMESTAMPTZ,
      scope TEXT,
      metadata_json TEXT DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );`,

  agent_registrations: `
    CREATE TABLE IF NOT EXISTS agent_registrations (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      agent_id TEXT REFERENCES agents(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      capabilities_json TEXT DEFAULT '[]',
      status TEXT DEFAULT 'active',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );`,

  agent_api_keys: `
    CREATE TABLE IF NOT EXISTS agent_api_keys (
      id TEXT PRIMARY KEY,
      agent_registration_id TEXT REFERENCES agent_registrations(id) ON DELETE CASCADE,
      key_hash TEXT NOT NULL UNIQUE,
      key_prefix TEXT NOT NULL,
      label TEXT DEFAULT 'Default',
      status TEXT DEFAULT 'active',
      last_used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );`,

  api_providers: `
    CREATE TABLE IF NOT EXISTS api_providers (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      base_url TEXT NOT NULL,
      auth_type TEXT DEFAULT 'bearer',
      auth_config_json TEXT DEFAULT '{}',
      rate_limit_per_minute INT,
      status TEXT DEFAULT 'active',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );`,
}

export async function POST(request: NextRequest) {
  // Check if Supabase is configured
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: 'Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env' },
      { status: 400 }
    )
  }

  const admin = getSupabaseAdmin()
  if (!admin) {
    return NextResponse.json(
      { error: 'Supabase admin client unavailable. Set SUPABASE_SERVICE_ROLE_KEY in .env' },
      { status: 400 }
    )
  }

  let body: MigrateRequest
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body' },
      { status: 400 }
    )
  }

  const { tables } = body

  if (!Array.isArray(tables) || tables.length === 0) {
    return NextResponse.json(
      { error: 'Provide a non-empty "tables" array in the request body' },
      { status: 400 }
    )
  }

  // Validate table names
  const invalidTables = tables.filter((t) => !TABLE_SQL[t])
  if (invalidTables.length > 0) {
    return NextResponse.json(
      { error: `Unknown table(s): ${invalidTables.join(', ')}. Available: ${Object.keys(TABLE_SQL).join(', ')}` },
      { status: 400 }
    )
  }

  // Run migrations for each requested table
  const results: Record<string, { success: boolean; error?: string }> = {}

  for (const tableName of tables) {
    const sql = TABLE_SQL[tableName]
    const { error } = await admin.rpc('exec_sql', { query: sql }).catch(() => {
      // If RPC doesn't exist, fall back to direct SQL via from
      return { error: { message: 'Direct SQL execution requires the exec_sql RPC function in Supabase. Alternatively, run the migration SQL manually from /supabase/migrations/' } }
    })

    if (error) {
      results[tableName] = { success: false, error: error.message || String(error) }
    } else {
      results[tableName] = { success: true }
    }
  }

  const allSucceeded = Object.values(results).every((r) => r.success)

  return NextResponse.json({
    success: allSucceeded,
    tables: results,
    message: allSucceeded
      ? 'All migrations applied successfully'
      : 'Some migrations failed — check the "tables" field for details',
  }, { status: allSucceeded ? 200 : 207 })
}
