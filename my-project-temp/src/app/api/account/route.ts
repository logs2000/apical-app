// DELETE /api/account — permanently delete the caller's account.
//
// Deletes the Prisma User row; every user-owned table (workflows, runs,
// memories, keys, subscriptions, …) cascades from it. If a Supabase service
// role key is configured, the Supabase auth user is deleted too (the Prisma
// user id mirrors the Supabase auth user id — see syncSupabaseUser). Without
// the service key the auth entry survives, but all app data is gone and a
// fresh sign-in starts from a blank account.
//
// The client is responsible for signing out after a 200.

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withUser } from '@/lib/auth-helpers'

export const DELETE = withUser(async (_req, { user }) => {
  try {
    // Several relations are onDelete: SetNull (workflows, credentials,
    // conversations, workspaces, profile) — orphaned userId=null rows would be
    // treated as shared/dev rows by ownership checks, so delete them explicitly
    // before removing the user. The rest of the user's data cascades.
    await db.$transaction([
      db.credential.deleteMany({ where: { userId: user.id } }),
      db.workflow.deleteMany({ where: { userId: user.id } }),
      db.conversation.deleteMany({ where: { userId: user.id } }),
      db.workspace.deleteMany({ where: { userId: user.id } }),
      db.userProfile.deleteMany({ where: { userId: user.id } }),
      db.user.delete({ where: { id: user.id } }),
    ])
  } catch (err) {
    console.error('[api/account] user delete failed:', err)
    return NextResponse.json(
      { error: 'Failed to delete account' },
      { status: 500 },
    )
  }

  // Best-effort: remove the Supabase auth user so the login itself is gone.
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (supabaseUrl && serviceKey) {
    try {
      const res = await fetch(
        `${supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(user.id)}`,
        {
          method: 'DELETE',
          headers: {
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
          },
        },
      )
      if (!res.ok && res.status !== 404) {
        console.warn(
          `[api/account] Supabase auth user delete returned ${res.status}`,
        )
      }
    } catch (err) {
      console.warn('[api/account] Supabase auth user delete failed:', err)
    }
  }

  return NextResponse.json({ ok: true })
})
