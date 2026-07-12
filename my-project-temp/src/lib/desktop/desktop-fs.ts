/**
 * Server-side directory listing on the user's desktop.
 *
 * Two transports, same result shape:
 *  - Local desktop runtime (Tauri prod server on the same host): direct fs.
 *  - Hosted web: proxied through the desktop-bridge mini-service to the
 *    user's online desktop session.
 *
 * Callers are responsible for granted-root checks BEFORE calling this.
 */

import { db } from '@/lib/db'
import {
  invokeLocalDesktopTool,
  isLocalDesktopRuntime,
} from '@/lib/platform/desktop-local-runtime'
import { BRIDGE_INVOKE_URL } from '@/lib/service-urls'

export interface DesktopDirEntry {
  name: string
  type: 'directory' | 'file' | 'other'
  size: number
}

export interface DesktopListResult {
  ok: boolean
  entries?: DesktopDirEntry[]
  error?: string
}

const BRIDGE_URL = BRIDGE_INVOKE_URL

export async function desktopListDir(
  userId: string,
  dirPath: string,
): Promise<DesktopListResult> {
  if (isLocalDesktopRuntime()) {
    const res = await invokeLocalDesktopTool('desktop.fs.list', { path: dirPath }, 15_000)
    if (!res.ok) return { ok: false, error: res.error || 'list_failed' }
    const entries = (res.result as { entries?: DesktopDirEntry[] })?.entries ?? []
    return { ok: true, entries }
  }

  const session = await db.desktopSession.findFirst({
    where: { userId, status: 'online' },
  })
  if (!session) {
    return { ok: false, error: 'desktop_offline' }
  }

  try {
    const r = await fetch(BRIDGE_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sessionId: session.id,
        tool: 'desktop.fs.list',
        args: { path: dirPath },
        timeoutMs: 15_000,
      }),
      signal: AbortSignal.timeout(20_000),
    })
    const data = (await r.json().catch(() => ({}))) as {
      ok?: boolean
      result?: { entries?: DesktopDirEntry[] }
      error?: string
    }
    if (!r.ok || !data.ok) {
      return { ok: false, error: data.error || `bridge_error_${r.status}` }
    }
    return { ok: true, entries: data.result?.entries ?? [] }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'bridge_unreachable' }
  }
}
