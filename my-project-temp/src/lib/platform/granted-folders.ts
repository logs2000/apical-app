/**
 * Granted folder roots — the desktop sandbox boundary.
 *
 * Like Cursor workspace folders: the user explicitly grants directories, and
 * every fs tool call (agent or file browser) must resolve inside one of them.
 * Paths are stored absolute, per user; the desktop app manages the list.
 */

import path from 'path'
import os from 'os'
import { db } from '@/lib/db'

/** Expand ~ and normalize to an absolute path (POSIX or Windows). */
export function normalizeGrantedPath(p: string): string {
  const trimmed = p.trim()
  if (!trimmed) return ''
  const expanded = trimmed.startsWith('~')
    ? path.join(os.homedir(), trimmed.slice(1).replace(/^[/\\]/, ''))
    : trimmed
  return path.resolve(expanded)
}

export interface GrantedRoot {
  id: string
  path: string
  label: string | null
}

export async function listGrantedRoots(userId: string): Promise<GrantedRoot[]> {
  const rows = await db.grantedFolder.findMany({
    where: { userId },
    orderBy: { createdAt: 'asc' },
    select: { id: true, path: true, label: true },
  })
  return rows
}

/** True if `target` is inside (or equal to) `root` after normalization. */
export function isPathInsideRoot(target: string, root: string): boolean {
  const t = normalizeGrantedPath(target)
  const r = normalizeGrantedPath(root)
  if (!t || !r) return false
  if (t === r) return true
  const rel = path.relative(r, t)
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)
}

export interface PathCheckResult {
  ok: boolean
  error?: string
}

/**
 * Verify every path in `paths` is inside one of the user's granted roots.
 * Fails closed: with no roots granted, all fs access is denied with a
 * message telling the agent/user how to grant access.
 */
export async function checkPathsGranted(
  userId: string,
  paths: string[],
): Promise<PathCheckResult> {
  const real = paths.map((p) => String(p ?? '').trim()).filter(Boolean)
  if (real.length === 0) return { ok: true }

  const roots = await listGrantedRoots(userId)
  if (roots.length === 0) {
    return {
      ok: false,
      error:
        'no_granted_folders: the user has not granted any folder access. ' +
        'Ask them to grant a folder from the file browser (attach menu → Browse files → Grant folder) before using filesystem tools.',
    }
  }
  for (const p of real) {
    const inside = roots.some((r) => isPathInsideRoot(p, r.path))
    if (!inside) {
      return {
        ok: false,
        error:
          `path_not_granted: "${p}" is outside the granted folders (${roots
            .map((r) => r.path)
            .join(', ')}). ` +
          'Ask the user to grant access to that folder if it is needed.',
      }
    }
  }
  return { ok: true }
}

/** Which args of each desktop fs tool contain filesystem paths. */
const FS_TOOL_PATH_ARGS: Record<string, string[]> = {
  'desktop.fs.list': ['path'],
  'desktop.fs.read': ['path'],
  'desktop.fs.write': ['path'],
  'desktop.fs.move': ['from', 'to'],
  'desktop.fs.watch': ['path'],
}

/**
 * Enforce granted roots for a desktop tool invocation. Returns null when the
 * call is allowed, or an error string when it must be blocked.
 * Non-fs tools (cli, net, notify, secrets) are not path-constrained here.
 */
export async function enforceGrantedRoots(
  userId: string,
  tool: string,
  args: Record<string, unknown>,
): Promise<string | null> {
  const pathArgs = FS_TOOL_PATH_ARGS[tool]
  if (!pathArgs) return null
  const paths = pathArgs
    .map((k) => args[k])
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
  const check = await checkPathsGranted(userId, paths)
  return check.ok ? null : check.error ?? 'path_not_granted'
}
