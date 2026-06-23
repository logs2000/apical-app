# Task 8 — Supabase Plug-and-Play Integration

## Summary
Created a plug-and-play Supabase integration for the Apical project that makes it easy to add Supabase credentials and run migrations.

## Files Created

### 1. `/src/lib/supabase.ts`
- Supabase client configuration with plug-and-play setup
- Exports `supabase` client (null if not configured), `isSupabaseConfigured()` helper, and `getSupabaseAdmin()` for server-side admin operations
- Typed with `SupabaseClient | null` for proper TypeScript support

### 2. `/src/app/api/supabase/status/route.ts`
- GET endpoint returning `{ configured: boolean, connected: boolean, url: string | null }`
- Performs a lightweight health check against Supabase to verify connectivity
- Gracefully handles unconfigured state (returns `configured: false`)

### 3. `/src/app/api/supabase/migrate/route.ts`
- POST endpoint accepting `{ tables: string[] }` to create tables in Supabase
- Supports 8 core Apical tables: users, agents, connectors, credentials, integration_sessions, agent_registrations, agent_api_keys, api_providers
- Validates table names and returns per-table success/failure status
- Requires `SUPABASE_SERVICE_ROLE_KEY` for admin-level SQL execution

### 4. `/supabase/migrations/001_initial.sql`
- Idempotent SQL migration creating all 8 core Apical tables
- Uses `CREATE TABLE IF NOT EXISTS` for safe re-runs
- Includes indexes for common query patterns (user_id, workspace_id, status, etc.)
- Foreign keys with appropriate ON DELETE behaviors (CASCADE, SET NULL)

### 5. `.env` (updated)
- Added `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` with empty defaults
- Commented as plug-and-play — add keys to enable

## Package Installed
- `@supabase/supabase-js@2.108.2`

## Verification
- `bun run lint` passes (0 errors, 1 pre-existing warning)
- Dev server running without issues
