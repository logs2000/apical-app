// Apical — Integration tenancy rules (registry vs. instance).
//
// The Integration table serves two roles after the tenancy split:
//   - REGISTRY rows: workspaceId === null. Builtin + community-published
//     templates (plus the ConnectorCatalogEntry table for the curated
//     catalog). Readable by every workspace; writable only by admins/publish.
//   - INSTANCE rows: workspaceId === <ws>. A workspace's private, configured
//     copy (own config, credential bindings, frozen artifacts).

import { getWorkspaceForUser } from './api-key-auth'
import type { User } from '@prisma/client'

/** Where-clause: integrations visible to a workspace (own + global registry). */
export function integrationVisibleWhere(workspaceId: string): {
  OR: Array<{ workspaceId: string | null }>
} {
  return { OR: [{ workspaceId }, { workspaceId: null }] }
}

/** Resolve the acting user's primary workspace id. */
export async function workspaceIdForUser(user: User): Promise<string> {
  const ws = await getWorkspaceForUser(user)
  return ws.id
}
