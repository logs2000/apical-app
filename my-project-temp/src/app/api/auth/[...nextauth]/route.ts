// NextAuth route handler — exposes GET + POST on /api/auth/[...nextauth].
//
// Re-uses `authOptions` from src/lib/auth.ts (single source of truth for the
// NextAuth config — providers, callbacks, pages, dev bypass).

import NextAuth from 'next-auth'
import { authOptions } from '@/lib/auth'

const handler = NextAuth(authOptions)

export { handler as GET, handler as POST }
