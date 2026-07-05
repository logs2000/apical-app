/**
 * Server-side access to the desktop app's data directory (the bundled Next.js
 * process only). The Tauri shell passes `APICAL_DESKTOP_DATA_DIR` when it
 * spawns the sidecar (see src-tauri/src/lib.rs). This is where the desktop
 * settings JSON and the cloud-link file live.
 *
 * NEVER import this from client components — it uses Node `fs`.
 */

import fs from 'fs'
import path from 'path'
import {
  DEFAULT_DESKTOP_SETTINGS,
  mergeDesktopSettings,
  type DesktopSettings,
} from './desktop-settings'

const SETTINGS_FILE = 'desktop-settings.json'
const CLOUD_LINK_FILE = 'cloud-link.json'

export interface CachedAgentMessages {
  agentId: string
  messages: Array<{
    id: string
    role: string
    content: string
    createdAt: string
    events?: unknown[]
  }>
  updatedAt: string
}

/** Stable fallback when DESKTOP_LOCAL runs outside the Tauri sidecar (dev prod server). */
function devDesktopDataDir(): string {
  const fromEnv = process.env.APICAL_DESKTOP_DATA_DIR?.trim()
  if (fromEnv) return fromEnv
  // ensure-prod-server.sh / local dev: keep chat cache + settings beside the app.
  return path.join(process.cwd(), '.apical-desktop-data')
}

/** The desktop data dir, or null when not running in the bundled desktop. */
export function desktopDataDir(): string | null {
  const dir = process.env.APICAL_DESKTOP_DATA_DIR?.trim()
  if (dir) return dir
  if (process.env.DESKTOP_LOCAL === 'true') return devDesktopDataDir()
  return null
}

/** JSON-safe message rows for the on-disk chat cache (events can be huge). */
export function sanitizeChatCacheMessages(
  messages: CachedAgentMessages['messages'],
): CachedAgentMessages['messages'] {
  return messages.map((m) => {
    let events: unknown[] | undefined
    if (m.events?.length) {
      try {
        events = JSON.parse(JSON.stringify(m.events)) as unknown[]
      } catch {
        events = undefined
      }
    }
    return {
      id: String(m.id),
      role: m.role === 'user' ? 'user' : 'agent',
      content: String(m.content ?? '').slice(0, 500_000),
      createdAt: m.createdAt || new Date().toISOString(),
      ...(events?.length ? { events } : {}),
    }
  })
}

/** True when this process is the desktop's bundled local server. */
export function isBundledDesktopServer(): boolean {
  return process.env.DESKTOP_LOCAL === 'true'
}

/** Read + merge the desktop settings from disk (defaults when unavailable). */
export function readDesktopSettingsFromDisk(): DesktopSettings {
  const dir = desktopDataDir()
  if (!dir) return { ...DEFAULT_DESKTOP_SETTINGS }
  try {
    const raw = fs.readFileSync(path.join(dir, SETTINGS_FILE), 'utf8')
    return mergeDesktopSettings(JSON.parse(raw))
  } catch {
    return { ...DEFAULT_DESKTOP_SETTINGS }
  }
}

export interface CloudLink {
  cloudUrl: string
  sessionToken: string
}

/** Path to the cloud-link file (null when not in the bundled desktop). */
export function cloudLinkPath(): string | null {
  const dir = desktopDataDir()
  return dir ? path.join(dir, CLOUD_LINK_FILE) : null
}

/** Read the persisted cloud link (bridge connection details), or null. */
export function readCloudLink(): CloudLink | null {
  const p = cloudLinkPath()
  if (!p) return null
  try {
    const raw = fs.readFileSync(p, 'utf8')
    const parsed = JSON.parse(raw) as Partial<CloudLink>
    if (
      parsed &&
      typeof parsed.cloudUrl === 'string' &&
      typeof parsed.sessionToken === 'string' &&
      parsed.cloudUrl &&
      parsed.sessionToken
    ) {
      return { cloudUrl: parsed.cloudUrl, sessionToken: parsed.sessionToken }
    }
    return null
  } catch {
    return null
  }
}

/** Persist the cloud link. Returns success. */
export function writeCloudLink(link: CloudLink): boolean {
  const p = cloudLinkPath()
  if (!p) return false
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, JSON.stringify(link, null, 2), 'utf8')
    return true
  } catch {
    return false
  }
}

/** Remove the cloud link (unlink this desktop from the cloud bridge). */
export function deleteCloudLink(): boolean {
  const p = cloudLinkPath()
  if (!p) return false
  try {
    if (fs.existsSync(p)) fs.rmSync(p)
    return true
  } catch {
    return false
  }
}

// ─── Chat message cache (bundled desktop disk store) ────────────────────────

const CHAT_CACHE_DIR = 'chat-cache'

function chatCacheDir(): string | null {
  const dir = desktopDataDir()
  return dir ? path.join(dir, CHAT_CACHE_DIR) : null
}

function chatCacheFile(agentId: string): string | null {
  const dir = chatCacheDir()
  if (!dir) return null
  const safe = agentId.replace(/[^a-zA-Z0-9_-]/g, '_')
  return path.join(dir, `${safe}.json`)
}

/** Read cached messages for one agent from disk (bundled desktop only). */
export function readChatCacheFromDisk(agentId: string): CachedAgentMessages | null {
  const file = chatCacheFile(agentId)
  if (!file) return null
  try {
    const raw = fs.readFileSync(file, 'utf8')
    const parsed = JSON.parse(raw) as CachedAgentMessages
    if (parsed && parsed.agentId === agentId && Array.isArray(parsed.messages)) {
      return parsed
    }
    return null
  } catch {
    return null
  }
}

/** Persist cached messages for one agent to disk (bundled desktop only). */
export function writeChatCacheToDisk(
  agentId: string,
  messages: CachedAgentMessages['messages'],
): boolean {
  const file = chatCacheFile(agentId)
  if (!file) return false
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const payload: CachedAgentMessages = {
      agentId,
      messages: sanitizeChatCacheMessages(messages),
      updatedAt: new Date().toISOString(),
    }
    fs.writeFileSync(file, JSON.stringify(payload), 'utf8')
    return true
  } catch (err) {
    console.warn('[desktop-paths] writeChatCacheToDisk failed:', err)
    return false
  }
}

/** List agent ids that have a disk cache entry (for boot warm-up). */
export function listChatCacheAgentIds(): string[] {
  const dir = chatCacheDir()
  if (!dir) return []
  try {
    if (!fs.existsSync(dir)) return []
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => {
        try {
          const raw = fs.readFileSync(path.join(dir, f), 'utf8')
          const parsed = JSON.parse(raw) as Partial<CachedAgentMessages>
          return typeof parsed.agentId === 'string' ? parsed.agentId : null
        } catch {
          return null
        }
      })
      .filter((id): id is string => !!id)
  } catch {
    return []
  }
}
